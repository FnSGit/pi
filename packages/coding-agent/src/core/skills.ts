import { existsSync, readdirSync, readFileSync, statSync } from "fs";
import ignore from "ignore";
import { basename, dirname, join, relative, resolve, sep } from "path";
import { CONFIG_DIR_NAME, getAgentDir } from "../config.ts";
import { parseFrontmatter, stripFrontmatter } from "../utils/frontmatter.ts";
import { canonicalizePath, resolvePath } from "../utils/paths.ts";
import type { ResourceDiagnostic } from "./diagnostics.ts";
import { createSyntheticSourceInfo, type SourceInfo } from "./source-info.ts";

/** Max name length per spec */
const MAX_NAME_LENGTH = 64;

/** Max description length per spec */
const MAX_DESCRIPTION_LENGTH = 1024;

const IGNORE_FILE_NAMES = [".gitignore", ".ignore", ".fdignore"];

type IgnoreMatcher = ReturnType<typeof ignore>;

function toPosixPath(p: string): string {
	return p.split(sep).join("/");
}

function prefixIgnorePattern(line: string, prefix: string): string | null {
	const trimmed = line.trim();
	if (!trimmed) return null;
	if (trimmed.startsWith("#") && !trimmed.startsWith("\\#")) return null;

	let pattern = line;
	let negated = false;

	if (pattern.startsWith("!")) {
		negated = true;
		pattern = pattern.slice(1);
	} else if (pattern.startsWith("\\!")) {
		pattern = pattern.slice(1);
	}

	if (pattern.startsWith("/")) {
		pattern = pattern.slice(1);
	}

	const prefixed = prefix ? `${prefix}${pattern}` : pattern;
	return negated ? `!${prefixed}` : prefixed;
}

function addIgnoreRules(ig: IgnoreMatcher, dir: string, rootDir: string): void {
	const relativeDir = relative(rootDir, dir);
	const prefix = relativeDir ? `${toPosixPath(relativeDir)}/` : "";

	for (const filename of IGNORE_FILE_NAMES) {
		const ignorePath = join(dir, filename);
		if (!existsSync(ignorePath)) continue;
		try {
			const content = readFileSync(ignorePath, "utf-8");
			const patterns = content
				.split(/\r?\n/)
				.map((line) => prefixIgnorePattern(line, prefix))
				.filter((line): line is string => Boolean(line));
			if (patterns.length > 0) {
				ig.add(patterns);
			}
		} catch {}
	}
}

export interface SkillFrontmatter {
	name?: string;
	description?: string;
	"disable-model-invocation"?: boolean;
	[key: string]: unknown;
}

export interface Skill {
	name: string;
	description: string;
	filePath: string;
	baseDir: string;
	sourceInfo: SourceInfo;
	disableModelInvocation: boolean;
}

export interface LoadSkillsResult {
	skills: Skill[];
	diagnostics: ResourceDiagnostic[];
}

/**
 * Validate skill name per Agent Skills spec.
 * Returns array of validation error messages (empty if valid).
 */
function validateName(name: string): string[] {
	const errors: string[] = [];

	if (name.length > MAX_NAME_LENGTH) {
		errors.push(`name exceeds ${MAX_NAME_LENGTH} characters (${name.length})`);
	}

	if (!/^[a-z0-9-]+$/.test(name)) {
		errors.push(`name contains invalid characters (must be lowercase a-z, 0-9, hyphens only)`);
	}

	if (name.startsWith("-") || name.endsWith("-")) {
		errors.push(`name must not start or end with a hyphen`);
	}

	if (name.includes("--")) {
		errors.push(`name must not contain consecutive hyphens`);
	}

	return errors;
}

/**
 * Validate description per Agent Skills spec.
 */
function validateDescription(description: unknown): string[] {
	const errors: string[] = [];

	if (typeof description !== "string" || description.trim() === "") {
		errors.push("description is required");
	} else if (description.length > MAX_DESCRIPTION_LENGTH) {
		errors.push(`description exceeds ${MAX_DESCRIPTION_LENGTH} characters (${description.length})`);
	}

	return errors;
}

export interface LoadSkillsFromDirOptions {
	/** Directory to scan for skills */
	dir: string;
	/** Source identifier for these skills */
	source: string;
}

function createSkillSourceInfo(filePath: string, baseDir: string, source: string): SourceInfo {
	switch (source) {
		case "user":
			return createSyntheticSourceInfo(filePath, {
				source: "local",
				scope: "user",
				baseDir,
			});
		case "project":
			return createSyntheticSourceInfo(filePath, {
				source: "local",
				scope: "project",
				baseDir,
			});
		case "path":
			return createSyntheticSourceInfo(filePath, {
				source: "local",
				baseDir,
			});
		default:
			return createSyntheticSourceInfo(filePath, { source, baseDir });
	}
}

/**
 * Load skills from a directory.
 *
 * Discovery rules:
 * - if a directory contains SKILL.md, treat it as a skill root and do not recurse further
 * - otherwise, load direct .md children in the root
 * - recurse into subdirectories to find SKILL.md
 */
export function loadSkillsFromDir(options: LoadSkillsFromDirOptions): LoadSkillsResult {
	const { dir, source } = options;
	return loadSkillsFromDirInternal(dir, source, true);
}

function loadSkillsFromDirInternal(
	dir: string,
	source: string,
	includeRootFiles: boolean,
	ignoreMatcher?: IgnoreMatcher,
	rootDir?: string,
): LoadSkillsResult {
	const skills: Skill[] = [];
	const diagnostics: ResourceDiagnostic[] = [];

	if (!existsSync(dir)) {
		return { skills, diagnostics };
	}

	const root = rootDir ?? dir;
	const ig = ignoreMatcher ?? ignore();
	addIgnoreRules(ig, dir, root);

	try {
		const entries = readdirSync(dir, { withFileTypes: true });

		for (const entry of entries) {
			if (entry.name !== "SKILL.md") {
				continue;
			}

			const fullPath = join(dir, entry.name);

			let isFile = entry.isFile();
			if (entry.isSymbolicLink()) {
				try {
					isFile = statSync(fullPath).isFile();
				} catch {
					continue;
				}
			}

			const relPath = toPosixPath(relative(root, fullPath));
			if (!isFile || ig.ignores(relPath)) {
				continue;
			}

			const result = loadSkillFromFile(fullPath, source);
			if (result.skill) {
				skills.push(result.skill);
			}
			diagnostics.push(...result.diagnostics);
			return { skills, diagnostics };
		}

		for (const entry of entries) {
			if (entry.name.startsWith(".")) {
				continue;
			}

			// Skip node_modules to avoid scanning dependencies
			if (entry.name === "node_modules") {
				continue;
			}

			const fullPath = join(dir, entry.name);

			// For symlinks, check if they point to a directory and follow them
			let isDirectory = entry.isDirectory();
			let isFile = entry.isFile();
			if (entry.isSymbolicLink()) {
				try {
					const stats = statSync(fullPath);
					isDirectory = stats.isDirectory();
					isFile = stats.isFile();
				} catch {
					// Broken symlink, skip it
					continue;
				}
			}

			const relPath = toPosixPath(relative(root, fullPath));
			const ignorePath = isDirectory ? `${relPath}/` : relPath;
			if (ig.ignores(ignorePath)) {
				continue;
			}

			if (isDirectory) {
				const subResult = loadSkillsFromDirInternal(fullPath, source, false, ig, root);
				skills.push(...subResult.skills);
				diagnostics.push(...subResult.diagnostics);
				continue;
			}

			if (!isFile || !includeRootFiles || !entry.name.endsWith(".md")) {
				continue;
			}

			const result = loadSkillFromFile(fullPath, source);
			if (result.skill) {
				skills.push(result.skill);
			}
			diagnostics.push(...result.diagnostics);
		}
	} catch {}

	return { skills, diagnostics };
}

function loadSkillFromFile(
	filePath: string,
	source: string,
): { skill: Skill | null; diagnostics: ResourceDiagnostic[] } {
	const diagnostics: ResourceDiagnostic[] = [];
	const isDeclaredSkill = basename(filePath) === "SKILL.md";

	let rawContent: string;
	try {
		rawContent = readFileSync(filePath, "utf-8");
	} catch (error) {
		const message = error instanceof Error ? error.message : "failed to read skill file";
		diagnostics.push({ type: "warning", message, path: filePath });
		return { skill: null, diagnostics };
	}

	let frontmatter: SkillFrontmatter;
	try {
		({ frontmatter } = parseFrontmatter<SkillFrontmatter>(rawContent));
	} catch (error) {
		if (isDeclaredSkill) {
			const message = error instanceof Error ? error.message : "failed to parse skill file";
			diagnostics.push({ type: "warning", message, path: filePath });
		}
		return { skill: null, diagnostics };
	}

	const description = frontmatter.description;
	const hasDescription = typeof description === "string" && description.trim() !== "";
	if (!isDeclaredSkill && !hasDescription) {
		return { skill: null, diagnostics };
	}

	const skillDir = dirname(filePath);
	const parentDirName = basename(skillDir);

	// Validate description
	const descErrors = validateDescription(description);
	for (const error of descErrors) {
		diagnostics.push({ type: "warning", message: error, path: filePath });
	}

	// Use name from frontmatter, or fall back to parent directory name
	const frontmatterName = typeof frontmatter.name === "string" ? frontmatter.name : undefined;
	const name = frontmatterName || parentDirName;

	// Validate name
	const nameErrors = validateName(name);
	for (const error of nameErrors) {
		diagnostics.push({ type: "warning", message: error, path: filePath });
	}

	// Still load the skill even with warnings, unless description is missing or empty.
	if (!hasDescription) {
		return { skill: null, diagnostics };
	}

	return {
		skill: {
			name,
			description,
			filePath,
			baseDir: skillDir,
			sourceInfo: createSkillSourceInfo(filePath, skillDir, source),
			disableModelInvocation: frontmatter["disable-model-invocation"] === true,
		},
		diagnostics,
	};
}

/** Max characters for a skill description shown in the system prompt. */
const SKILL_DESCRIPTION_PREVIEW_MAX_CHARS = 300;
/** Shortest cut we accept at a sentence or word boundary before falling back to a hard cut. */
const SKILL_DESCRIPTION_PREVIEW_MIN_CUT = 40;

/**
 * Collapse whitespace and truncate a skill description for the system-prompt preview. Prefers the
 * longest sentence boundary, then the last word boundary, then a hard cut; any cut ends with an
 * ellipsis. Descriptions without ASCII sentence punctuation or spaces (for example CJK) degrade to
 * the hard cut rather than throwing.
 */
export function previewSkillDescription(description: string, maxLength = SKILL_DESCRIPTION_PREVIEW_MAX_CHARS): string {
	const collapsed = description.replace(/\s+/g, " ").trim();
	if (collapsed.length <= maxLength) {
		return collapsed;
	}

	const sentenceEnd = longestSentenceEnd(collapsed, maxLength);
	if (sentenceEnd >= SKILL_DESCRIPTION_PREVIEW_MIN_CUT) {
		return `${collapsed.slice(0, sentenceEnd)}\u2026`;
	}

	const wordEnd = collapsed.lastIndexOf(" ", maxLength);
	if (wordEnd >= SKILL_DESCRIPTION_PREVIEW_MIN_CUT) {
		return `${collapsed.slice(0, wordEnd)}\u2026`;
	}

	return `${collapsed.slice(0, maxLength)}\u2026`;
}

/** Length of the longest prefix of `text` (up to `maxLength`) that ends at a sentence boundary. */
function longestSentenceEnd(text: string, maxLength: number): number {
	let end = -1;
	for (let i = 0; i < maxLength && i < text.length; i++) {
		const char = text[i];
		if ((char === "." || char === "!" || char === "?") && (i + 1 === text.length || /\s/.test(text[i + 1]))) {
			end = i + 1;
		}
	}
	return end;
}

/**
 * Format skills for inclusion in a system prompt.
 * Uses XML format per Agent Skills standard.
 * See: https://agentskills.io/integrate-skills
 *
 * Skills with disableModelInvocation=true are excluded from the prompt
 * (they can only be invoked explicitly via /skill:name commands).
 *
 * `fileReadTool` names the tool that loads skill files; `indirect` names none, for a reader that
 * is reachable only through another tool.
 */
export function formatSkillsForPrompt(skills: Skill[], fileReadTool: "read" | "bash" | "indirect" = "read"): string {
	const visibleSkills = skills.filter((s) => !s.disableModelInvocation);

	if (visibleSkills.length === 0) {
		return "";
	}

	const lines = ["\n\nThe following skills provide specialized instructions for specific tasks."];

	if (fileReadTool === "read") {
		lines.push(
			"When a task matches a skill's description, load that skill's file with the read tool before acting on the task. Do not claim to follow a skill whose file you have not loaded.",
			"Load a skill with the read tool using its `skill://<name>` URI (for example `skill://pdf-tools`); files bundled with a skill use `skill://<name>/<relative-path>`. The absolute path in <location> also works.",
		);
	} else if (fileReadTool === "bash") {
		lines.push("Use bash to load a skill's file when the task matches its description.");
	} else {
		lines.push("Load a skill's file when the task matches its description.");
	}

	lines.push(
		"When a skill file references a relative path, resolve it against the skill directory (parent of SKILL.md / dirname of the path) and use that absolute path in tool commands.",
		"",
		"<available_skills>",
	);

	for (const skill of visibleSkills) {
		lines.push("  <skill>");
		lines.push(`    <name>${escapeXml(skill.name)}</name>`);
		lines.push(`    <description>${escapeXml(previewSkillDescription(skill.description))}</description>`);
		lines.push(`    <location>${escapeXml(skill.filePath)}</location>`);
		lines.push("  </skill>");
	}

	lines.push("</available_skills>");

	return lines.join("\n");
}

function escapeXml(str: string): string {
	return str
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;")
		.replace(/'/g, "&apos;");
}

/** Collision label for a skill: its scope for local sources, otherwise its source. */
function skillCollisionLabel(skill: Skill): string {
	const info = skill.sourceInfo;
	return info.source === "local" ? info.scope : info.source;
}

/** URI prefix that addresses a loaded skill by name, for example `skill://pdf-tools`. */
export const SKILL_URI_PREFIX = "skill://";

export interface SkillUriReference {
	name: string;
	relativePath?: string;
}

/**
 * Parse a `skill://<name>` or `skill://<name>/<relative-path>` URI. Returns null for a non-skill URI,
 * an empty name, a malformed percent-escape, an absolute relative path, or a relative path that
 * escapes the skill directory through a `..` segment.
 */
export function parseSkillUri(uri: string): SkillUriReference | null {
	if (!uri.startsWith(SKILL_URI_PREFIX)) return null;

	const remainder = uri.slice(SKILL_URI_PREFIX.length);
	const slashIndex = remainder.indexOf("/");
	const rawName = slashIndex === -1 ? remainder : remainder.slice(0, slashIndex);
	const rawRelative = slashIndex === -1 ? undefined : remainder.slice(slashIndex + 1);

	let name: string;
	try {
		name = decodeURIComponent(rawName);
	} catch {
		return null;
	}
	if (!name) return null;

	let relativePath: string | undefined;
	if (rawRelative !== undefined) {
		try {
			relativePath = decodeURIComponent(rawRelative);
		} catch {
			return null;
		}
		if (relativePath) {
			if (relativePath.startsWith("/") || /^[A-Za-z]:/.test(relativePath)) return null;
			if (relativePath.split(/[/\\]/).includes("..")) return null;
		}
	}

	return { name, relativePath };
}

/**
 * Resolve a `skill://` URI to an absolute path within a loaded skill. Returns null when the URI is
 * malformed, names an unknown skill, or points outside the skill directory.
 */
export function resolveSkillUriPath(uri: string, skills: readonly Skill[]): string | null {
	const ref = parseSkillUri(uri);
	if (!ref) return null;

	const skill = skills.find((s) => s.name === ref.name);
	if (!skill) return null;

	const target = ref.relativePath ? join(skill.baseDir, ref.relativePath) : skill.filePath;
	if (target === skill.filePath || target === skill.baseDir || target.startsWith(`${skill.baseDir}${sep}`)) {
		return target;
	}
	return null;
}

export interface SkillCommandExpansion {
	/** Expanded text, or an `<error>` block for an unknown leading skill command. */
	text: string;
	/** Names expanded into `<skill>` blocks. */
	loadedSkills: string[];
	/** Leading-form names that matched no skill. */
	unknownSkills: string[];
	/** File read failures, keyed by skill name. */
	readErrors: Array<{ name: string; message: string }>;
}

const EMBEDDED_SKILL_TOKEN = /(^|\s)\/skill:([a-z0-9-]+(?:\/[a-z0-9-]+)?)(?=\s|$)/g;

/**
 * Expand `/skill:` commands in user input into `<skill>` instruction blocks.
 *
 * A leading `/skill:name` expands to that skill's block with any trailing text appended as arguments;
 * an unknown name yields an `<error>` block. When the text does not start with `/`, every embedded
 * `/skill:name` token naming a known skill is replaced by its block and the surrounding prose becomes
 * the arguments. A leading `/` that is not `/skill:` (an extension command or prompt template) is left
 * untouched.
 */
export function expandSkillCommandText(text: string, skills: readonly Skill[]): SkillCommandExpansion {
	const expansion: SkillCommandExpansion = { text, loadedSkills: [], unknownSkills: [], readErrors: [] };

	if (text.startsWith("/skill:")) {
		const spaceIndex = text.indexOf(" ");
		const name = spaceIndex === -1 ? text.slice(7) : text.slice(7, spaceIndex);
		const args = spaceIndex === -1 ? "" : text.slice(spaceIndex + 1).trim();
		const skill = skills.find((s) => s.name === name);
		if (!skill) {
			expansion.text = `<error>Unknown skill "${name}". Available skills: ${formatAvailableSkills(skills)}. Run /reload after adding a skill.</error>`;
			expansion.unknownSkills.push(name);
			return expansion;
		}
		const block = loadSkillBlock(skill, expansion);
		if (block === null) return expansion;
		expansion.text = args ? `${block}\n\n${args}` : block;
		return expansion;
	}

	if (text.startsWith("/")) {
		// A leading slash that is not a skill command is an extension command or prompt template.
		return expansion;
	}

	const blocks: string[] = [];
	const removals: Array<{ start: number; end: number }> = [];
	for (const match of text.matchAll(EMBEDDED_SKILL_TOKEN)) {
		const skill = skills.find((s) => s.name === match[2]);
		if (!skill) continue;
		const block = loadSkillBlock(skill, expansion);
		if (block === null) continue;
		const start = match.index ?? 0;
		blocks.push(block);
		removals.push({ start, end: start + match[0].length });
	}

	if (blocks.length === 0) {
		return expansion;
	}

	let prose = "";
	let cursor = 0;
	for (const removal of removals) {
		prose = appendProseSegment(prose, text.slice(cursor, removal.start));
		cursor = removal.end;
	}
	prose = appendProseSegment(prose, text.slice(cursor));
	const trimmedProse = prose.trim();
	expansion.text = trimmedProse ? `${blocks.join("\n\n")}\n\n${trimmedProse}` : blocks.join("\n\n");
	return expansion;
}

/** Append a prose segment, collapsing whitespace only across the junction with what precedes it. */
function appendProseSegment(prose: string, segment: string): string {
	if (prose === "" || segment === "") return prose + segment;
	if (/\s$/.test(prose)) return `${prose}${segment.replace(/^\s+/, "")}`;
	return prose + segment;
}

function formatAvailableSkills(skills: readonly Skill[]): string {
	return skills.length > 0 ? skills.map((skill) => skill.name).join(", ") : "(none)";
}

/** Read a skill file into a `<skill>` block, recording its name and any read error in `expansion`. */
function loadSkillBlock(skill: Skill, expansion: SkillCommandExpansion): string | null {
	try {
		const content = readFileSync(skill.filePath, "utf-8");
		const body = stripFrontmatter(content).trim();
		expansion.loadedSkills.push(skill.name);
		return `<skill name="${skill.name}" location="${skill.filePath}">\nReferences are relative to ${skill.baseDir}.\n\n${body}\n</skill>`;
	} catch (error) {
		expansion.readErrors.push({
			name: skill.name,
			message: error instanceof Error ? error.message : String(error),
		});
		return null;
	}
}

export interface LoadSkillsOptions {
	/** Working directory for project-local skills. */
	cwd: string;
	/** Agent config directory for global skills. */
	agentDir: string;
	/** Explicit skill paths (files or directories) */
	skillPaths: string[];
	/** Include default skills directories. */
	includeDefaults: boolean;
}

/**
 * Load skills from all configured locations.
 * Returns skills and any validation diagnostics.
 */
export function loadSkills(options: LoadSkillsOptions): LoadSkillsResult {
	const { agentDir, skillPaths, includeDefaults } = options;

	// Resolve agentDir - if not provided, use default from config
	const resolvedCwd = resolvePath(options.cwd);
	const resolvedAgentDir = resolvePath(agentDir ?? getAgentDir());

	const skillMap = new Map<string, Skill>();
	const realPathSet = new Set<string>();
	const allDiagnostics: ResourceDiagnostic[] = [];
	const collisionDiagnostics: ResourceDiagnostic[] = [];

	function addSkills(result: LoadSkillsResult) {
		allDiagnostics.push(...result.diagnostics);
		for (const skill of result.skills) {
			// Resolve symlinks to detect duplicate files
			const realPath = canonicalizePath(skill.filePath);

			// Skip silently if we've already loaded this exact file (via symlink)
			if (realPathSet.has(realPath)) {
				continue;
			}

			const existing = skillMap.get(skill.name);
			if (existing) {
				// Keep the later skill under a `<label>/<name>` alias instead of dropping it silently.
				const base = `${skillCollisionLabel(skill)}/${skill.name}`;
				let alias = base;
				let suffix = 2;
				while (skillMap.has(alias)) {
					alias = `${base}~${suffix}`;
					suffix++;
				}
				skillMap.set(alias, { ...skill, name: alias });
				realPathSet.add(realPath);
				collisionDiagnostics.push({
					type: "collision",
					message: `name "${skill.name}" collision: also loaded as "${alias}"`,
					path: skill.filePath,
					collision: {
						resourceType: "skill",
						name: skill.name,
						winnerPath: existing.filePath,
						loserPath: skill.filePath,
					},
				});
			} else {
				skillMap.set(skill.name, skill);
				realPathSet.add(realPath);
			}
		}
	}

	if (includeDefaults) {
		addSkills(loadSkillsFromDirInternal(join(resolvedAgentDir, "skills"), "user", true));
		addSkills(loadSkillsFromDirInternal(resolve(resolvedCwd, CONFIG_DIR_NAME, "skills"), "project", true));
	}

	const userSkillsDir = join(resolvedAgentDir, "skills");
	const projectSkillsDir = resolve(resolvedCwd, CONFIG_DIR_NAME, "skills");

	const isUnderPath = (target: string, root: string): boolean => {
		const normalizedRoot = resolve(root);
		if (target === normalizedRoot) {
			return true;
		}
		const prefix = normalizedRoot.endsWith(sep) ? normalizedRoot : `${normalizedRoot}${sep}`;
		return target.startsWith(prefix);
	};

	const getSource = (resolvedPath: string): "user" | "project" | "path" => {
		if (!includeDefaults) {
			if (isUnderPath(resolvedPath, userSkillsDir)) return "user";
			if (isUnderPath(resolvedPath, projectSkillsDir)) return "project";
		}
		return "path";
	};

	for (const rawPath of skillPaths) {
		const resolvedPath = resolvePath(rawPath, resolvedCwd, { trim: true });
		if (!existsSync(resolvedPath)) {
			allDiagnostics.push({ type: "warning", message: "skill path does not exist", path: resolvedPath });
			continue;
		}

		try {
			const stats = statSync(resolvedPath);
			const source = getSource(resolvedPath);
			if (stats.isDirectory()) {
				addSkills(loadSkillsFromDirInternal(resolvedPath, source, true));
			} else if (stats.isFile() && resolvedPath.endsWith(".md")) {
				const result = loadSkillFromFile(resolvedPath, source);
				if (result.skill) {
					addSkills({ skills: [result.skill], diagnostics: result.diagnostics });
				} else {
					allDiagnostics.push(...result.diagnostics);
				}
			} else {
				allDiagnostics.push({ type: "warning", message: "skill path is not a markdown file", path: resolvedPath });
			}
		} catch (error) {
			const message = error instanceof Error ? error.message : "failed to read skill path";
			allDiagnostics.push({ type: "warning", message, path: resolvedPath });
		}
	}

	return {
		skills: Array.from(skillMap.values()),
		diagnostics: [...allDiagnostics, ...collisionDiagnostics],
	};
}
