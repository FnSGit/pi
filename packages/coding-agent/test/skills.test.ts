import { homedir } from "os";
import { join, resolve } from "path";
import { describe, expect, it } from "vitest";
import type { ResourceDiagnostic } from "../src/core/diagnostics.ts";
import {
	expandSkillCommandText,
	formatSkillsForPrompt,
	loadSkills,
	loadSkillsFromDir,
	parseSkillUri,
	previewSkillDescription,
	resolveSkillUriPath,
	type Skill,
} from "../src/core/skills.ts";
import { createSyntheticSourceInfo } from "../src/core/source-info.ts";

const fixturesDir = resolve(__dirname, "fixtures/skills");
const collisionFixturesDir = resolve(__dirname, "fixtures/skills-collision");

function createTestSkill(options: {
	name: string;
	description: string;
	filePath: string;
	baseDir: string;
	disableModelInvocation?: boolean;
	source?: string;
}): Skill {
	return {
		name: options.name,
		description: options.description,
		filePath: options.filePath,
		baseDir: options.baseDir,
		sourceInfo: createSyntheticSourceInfo(options.filePath, { source: options.source ?? "test" }),
		disableModelInvocation: options.disableModelInvocation ?? false,
	};
}

describe("skills", () => {
	describe("loadSkillsFromDir", () => {
		it("should load a valid skill", () => {
			const { skills, diagnostics } = loadSkillsFromDir({
				dir: join(fixturesDir, "valid-skill"),
				source: "test",
			});

			expect(skills).toHaveLength(1);
			expect(skills[0].name).toBe("valid-skill");
			expect(skills[0].description).toBe("A valid skill for testing purposes.");
			expect(skills[0].sourceInfo.source).toBe("test");
			expect(diagnostics).toHaveLength(0);
		});

		it("should allow names that don't match parent directory", () => {
			const { skills, diagnostics } = loadSkillsFromDir({
				dir: join(fixturesDir, "name-mismatch"),
				source: "test",
			});

			expect(skills).toHaveLength(1);
			expect(skills[0].name).toBe("different-name");
			expect(
				diagnostics.some((d: ResourceDiagnostic) => d.message.includes("does not match parent directory")),
			).toBe(false);
		});

		it("should warn when name contains invalid characters", () => {
			const { skills, diagnostics } = loadSkillsFromDir({
				dir: join(fixturesDir, "invalid-name-chars"),
				source: "test",
			});

			expect(skills).toHaveLength(1);
			expect(diagnostics.some((d: ResourceDiagnostic) => d.message.includes("invalid characters"))).toBe(true);
		});

		it("should warn when name exceeds 64 characters", () => {
			const { skills, diagnostics } = loadSkillsFromDir({
				dir: join(fixturesDir, "long-name"),
				source: "test",
			});

			expect(skills).toHaveLength(1);
			expect(diagnostics.some((d: ResourceDiagnostic) => d.message.includes("exceeds 64 characters"))).toBe(true);
		});

		it("should warn and skip skill when description is missing", () => {
			const { skills, diagnostics } = loadSkillsFromDir({
				dir: join(fixturesDir, "missing-description"),
				source: "test",
			});

			expect(skills).toHaveLength(0);
			expect(diagnostics.some((d: ResourceDiagnostic) => d.message.includes("description is required"))).toBe(true);
		});

		it("should ignore unknown frontmatter fields", () => {
			const { skills, diagnostics } = loadSkillsFromDir({
				dir: join(fixturesDir, "unknown-field"),
				source: "test",
			});

			expect(skills).toHaveLength(1);
			expect(diagnostics).toHaveLength(0);
		});

		it("should load nested skills recursively", () => {
			const { skills, diagnostics } = loadSkillsFromDir({
				dir: join(fixturesDir, "nested"),
				source: "test",
			});

			expect(skills).toHaveLength(1);
			expect(skills[0].name).toBe("child-skill");
			expect(diagnostics).toHaveLength(0);
		});

		it("should prefer a directory's root SKILL.md over nested SKILL.md files", () => {
			const { skills, diagnostics } = loadSkillsFromDir({
				dir: join(fixturesDir, "root-skill-preferred"),
				source: "test",
			});

			expect(skills).toHaveLength(1);
			expect(skills[0].name).toBe("root-skill-preferred");
			expect(skills[0].description).toBe("Root skill should win.");
			expect(diagnostics).toHaveLength(0);
		});

		it("should skip files without frontmatter", () => {
			const { skills, diagnostics } = loadSkillsFromDir({
				dir: join(fixturesDir, "no-frontmatter"),
				source: "test",
			});

			// no-frontmatter has no description, so it should be skipped
			expect(skills).toHaveLength(0);
			expect(diagnostics.some((d: ResourceDiagnostic) => d.message.includes("description is required"))).toBe(true);
		});

		it("should warn and skip skill when YAML frontmatter is invalid", () => {
			const { skills, diagnostics } = loadSkillsFromDir({
				dir: join(fixturesDir, "invalid-yaml"),
				source: "test",
			});

			expect(skills).toHaveLength(0);
			expect(diagnostics.some((d: ResourceDiagnostic) => d.message.includes("at line"))).toBe(true);
		});

		it("should preserve multiline descriptions from YAML", () => {
			const { skills, diagnostics } = loadSkillsFromDir({
				dir: join(fixturesDir, "multiline-description"),
				source: "test",
			});

			expect(skills).toHaveLength(1);
			expect(skills[0].description).toContain("\n");
			expect(skills[0].description).toContain("This is a multiline description.");
			expect(diagnostics).toHaveLength(0);
		});

		it("should warn when name contains consecutive hyphens", () => {
			const { skills, diagnostics } = loadSkillsFromDir({
				dir: join(fixturesDir, "consecutive-hyphens"),
				source: "test",
			});

			expect(skills).toHaveLength(1);
			expect(diagnostics.some((d: ResourceDiagnostic) => d.message.includes("consecutive hyphens"))).toBe(true);
		});

		it("should load all skills from fixture directory", () => {
			const { skills } = loadSkillsFromDir({
				dir: fixturesDir,
				source: "test",
			});

			// Should load all skills that have descriptions (even with warnings)
			// valid-skill, name-mismatch, invalid-name-chars, long-name, unknown-field, nested/child-skill, consecutive-hyphens
			// NOT: missing-description, no-frontmatter (both missing descriptions)
			expect(skills.length).toBeGreaterThanOrEqual(6);
		});

		it("should return empty for non-existent directory", () => {
			const { skills, diagnostics } = loadSkillsFromDir({
				dir: "/non/existent/path",
				source: "test",
			});

			expect(skills).toHaveLength(0);
			expect(diagnostics).toHaveLength(0);
		});

		it("should use parent directory name when name not in frontmatter", () => {
			// The no-frontmatter fixture has no name in frontmatter, so it should use "no-frontmatter"
			// But it also has no description, so it won't load
			// Let's test with a valid skill that relies on directory name
			const { skills } = loadSkillsFromDir({
				dir: join(fixturesDir, "valid-skill"),
				source: "test",
			});

			expect(skills).toHaveLength(1);
			expect(skills[0].name).toBe("valid-skill");
		});

		it("should parse disable-model-invocation frontmatter field", () => {
			const { skills, diagnostics } = loadSkillsFromDir({
				dir: join(fixturesDir, "disable-model-invocation"),
				source: "test",
			});

			expect(skills).toHaveLength(1);
			expect(skills[0].name).toBe("disable-model-invocation");
			expect(skills[0].disableModelInvocation).toBe(true);
			// Should not warn about unknown field
			expect(diagnostics.some((d: ResourceDiagnostic) => d.message.includes("unknown frontmatter field"))).toBe(
				false,
			);
		});

		it("should default disableModelInvocation to false when not specified", () => {
			const { skills } = loadSkillsFromDir({
				dir: join(fixturesDir, "valid-skill"),
				source: "test",
			});

			expect(skills).toHaveLength(1);
			expect(skills[0].disableModelInvocation).toBe(false);
		});
	});

	describe("formatSkillsForPrompt", () => {
		it("should return empty string for no skills", () => {
			const result = formatSkillsForPrompt([]);
			expect(result).toBe("");
		});

		it("should format skills as XML", () => {
			const skills: Skill[] = [
				createTestSkill({
					name: "test-skill",
					description: "A test skill.",
					filePath: "/path/to/skill/SKILL.md",
					baseDir: "/path/to/skill",
				}),
			];

			const result = formatSkillsForPrompt(skills);

			expect(result).toContain("<available_skills>");
			expect(result).toContain("</available_skills>");
			expect(result).toContain("<skill>");
			expect(result).toContain("<name>test-skill</name>");
			expect(result).toContain("<description>A test skill.</description>");
			expect(result).toContain("<location>/path/to/skill/SKILL.md</location>");
		});

		it("should include intro text before XML", () => {
			const skills: Skill[] = [
				createTestSkill({
					name: "test-skill",
					description: "A test skill.",
					filePath: "/path/to/skill/SKILL.md",
					baseDir: "/path/to/skill",
				}),
			];

			const result = formatSkillsForPrompt(skills);
			const xmlStart = result.indexOf("<available_skills>");
			const introText = result.substring(0, xmlStart);

			expect(introText).toContain("The following skills provide specialized instructions");
			expect(introText).toContain("load that skill's file with the read tool");
		});

		it("should escape XML special characters", () => {
			const skills: Skill[] = [
				createTestSkill({
					name: "test-skill",
					description: 'A skill with <special> & "characters".',
					filePath: "/path/to/skill/SKILL.md",
					baseDir: "/path/to/skill",
				}),
			];

			const result = formatSkillsForPrompt(skills);

			expect(result).toContain("&lt;special&gt;");
			expect(result).toContain("&amp;");
			expect(result).toContain("&quot;characters&quot;");
		});

		it("should format multiple skills", () => {
			const skills: Skill[] = [
				createTestSkill({
					name: "skill-one",
					description: "First skill.",
					filePath: "/path/one/SKILL.md",
					baseDir: "/path/one",
				}),
				createTestSkill({
					name: "skill-two",
					description: "Second skill.",
					filePath: "/path/two/SKILL.md",
					baseDir: "/path/two",
				}),
			];

			const result = formatSkillsForPrompt(skills);

			expect(result).toContain("<name>skill-one</name>");
			expect(result).toContain("<name>skill-two</name>");
			expect((result.match(/<skill>/g) || []).length).toBe(2);
		});

		it("should exclude skills with disableModelInvocation from prompt", () => {
			const skills: Skill[] = [
				createTestSkill({
					name: "visible-skill",
					description: "A visible skill.",
					filePath: "/path/visible/SKILL.md",
					baseDir: "/path/visible",
				}),
				createTestSkill({
					name: "hidden-skill",
					description: "A hidden skill.",
					filePath: "/path/hidden/SKILL.md",
					baseDir: "/path/hidden",
					disableModelInvocation: true,
				}),
			];

			const result = formatSkillsForPrompt(skills);

			expect(result).toContain("<name>visible-skill</name>");
			expect(result).not.toContain("<name>hidden-skill</name>");
			expect((result.match(/<skill>/g) || []).length).toBe(1);
		});

		it("should return empty string when all skills have disableModelInvocation", () => {
			const skills: Skill[] = [
				createTestSkill({
					name: "hidden-skill",
					description: "A hidden skill.",
					filePath: "/path/hidden/SKILL.md",
					baseDir: "/path/hidden",
					disableModelInvocation: true,
				}),
			];

			const result = formatSkillsForPrompt(skills);
			expect(result).toBe("");
		});

		it("should render a truncated description preview", () => {
			const description = "x ".repeat(400);
			const skills: Skill[] = [
				createTestSkill({
					name: "verbose-skill",
					description,
					filePath: "/path/verbose/SKILL.md",
					baseDir: "/path/verbose",
				}),
			];

			const preview = previewSkillDescription(description);
			expect(preview.endsWith("\u2026")).toBe(true);
			expect(formatSkillsForPrompt(skills)).toContain(`<description>${preview}</description>`);
		});

		it("should mention skill:// URIs only for the read variant", () => {
			const skills: Skill[] = [
				createTestSkill({
					name: "test-skill",
					description: "A test skill.",
					filePath: "/path/to/skill/SKILL.md",
					baseDir: "/path/to/skill",
				}),
			];

			const read = formatSkillsForPrompt(skills);
			expect(read).toContain("skill://<name>");
			expect(read).toContain("skill://pdf-tools");

			const bash = formatSkillsForPrompt(skills, "bash");
			expect(bash).toContain("Use bash to load a skill's file");
			expect(bash).not.toContain("skill://");

			const indirect = formatSkillsForPrompt(skills, "indirect");
			expect(indirect).toContain("Load a skill's file when the task matches its description.");
			expect(indirect).not.toContain("skill://");
		});
	});

	describe("loadSkills with options", () => {
		const emptyAgentDir = resolve(__dirname, "fixtures/empty-agent");
		const emptyCwd = resolve(__dirname, "fixtures/empty-cwd");

		it("should load from explicit skillPaths", () => {
			const { skills, diagnostics } = loadSkills({
				agentDir: emptyAgentDir,
				cwd: emptyCwd,
				skillPaths: [join(fixturesDir, "valid-skill")],
				includeDefaults: true,
			});
			expect(skills).toHaveLength(1);
			expect(skills[0].sourceInfo.scope).toBe("temporary");
			expect(diagnostics).toHaveLength(0);
		});

		it("should warn when skill path does not exist", () => {
			const { skills, diagnostics } = loadSkills({
				agentDir: emptyAgentDir,
				cwd: emptyCwd,
				skillPaths: ["/non/existent/path"],
				includeDefaults: true,
			});
			expect(skills).toHaveLength(0);
			expect(diagnostics.some((d: ResourceDiagnostic) => d.message.includes("does not exist"))).toBe(true);
		});

		it("should expand ~ in skillPaths", () => {
			const homeSkillsDir = join(homedir(), ".pi/agent/skills");
			const { skills: withTilde } = loadSkills({
				agentDir: emptyAgentDir,
				cwd: emptyCwd,
				skillPaths: ["~/.pi/agent/skills"],
				includeDefaults: true,
			});
			const { skills: withoutTilde } = loadSkills({
				agentDir: emptyAgentDir,
				cwd: emptyCwd,
				skillPaths: [homeSkillsDir],
				includeDefaults: true,
			});
			expect(withTilde.length).toBe(withoutTilde.length);
		});
	});

	describe("collision handling", () => {
		it("should detect name collisions and keep first skill", () => {
			// Load from first directory
			const first = loadSkillsFromDir({
				dir: join(collisionFixturesDir, "first"),
				source: "first",
			});

			const second = loadSkillsFromDir({
				dir: join(collisionFixturesDir, "second"),
				source: "second",
			});

			// Simulate the collision behavior from loadSkills()
			const skillMap = new Map<string, Skill>();
			const collisionWarnings: Array<{ skillPath: string; message: string }> = [];

			for (const skill of first.skills) {
				skillMap.set(skill.name, skill);
			}

			for (const skill of second.skills) {
				const existing = skillMap.get(skill.name);
				if (existing) {
					collisionWarnings.push({
						skillPath: skill.filePath,
						message: `name collision: "${skill.name}" already loaded from ${existing.filePath}`,
					});
				} else {
					skillMap.set(skill.name, skill);
				}
			}

			expect(skillMap.size).toBe(1);
			expect(skillMap.get("calendar")?.sourceInfo.source).toBe("first");
			expect(collisionWarnings).toHaveLength(1);
			expect(collisionWarnings[0].message).toContain("name collision");
		});

		it("should keep a same-name collision under a <label>/<name> alias", () => {
			const { skills, diagnostics } = loadSkills({
				agentDir: resolve(__dirname, "fixtures/empty-agent"),
				cwd: resolve(__dirname, "fixtures/empty-cwd"),
				skillPaths: [join(collisionFixturesDir, "first"), join(collisionFixturesDir, "second")],
				includeDefaults: false,
			});

			const names = skills.map((s) => s.name);
			expect(names).toContain("calendar");
			expect(names).toContain("temporary/calendar");
			expect(skills.find((s) => s.name === "calendar")?.description).toBe("First calendar skill.");
			expect(skills.find((s) => s.name === "temporary/calendar")?.description).toBe("Second calendar skill.");
			expect(diagnostics.some((d) => d.message.includes('also loaded as "temporary/calendar"'))).toBe(true);
		});
	});
});

describe("previewSkillDescription", () => {
	it("collapses whitespace and returns short descriptions unchanged", () => {
		expect(previewSkillDescription("A test skill.")).toBe("A test skill.");
		expect(previewSkillDescription("a   b\n\nc")).toBe("a b c");
	});

	it("cuts at the longest sentence boundary", () => {
		const description = `${"A".repeat(45)}. ${"b ".repeat(200)}`;
		expect(previewSkillDescription(description)).toBe(`${"A".repeat(45)}.\u2026`);
	});

	it("cuts at the last word boundary when no sentence boundary qualifies", () => {
		const result = previewSkillDescription("word ".repeat(100));
		expect(result).toHaveLength(300);
		expect(result.endsWith("word\u2026")).toBe(true);
	});

	it("hard-cuts CJK text without spaces or sentence punctuation", () => {
		expect(previewSkillDescription("\u6280".repeat(400))).toBe(`${"\u6280".repeat(300)}\u2026`);
	});
});

describe("parseSkillUri", () => {
	it("parses a name-only URI", () => {
		expect(parseSkillUri("skill://pdf-tools")).toEqual({ name: "pdf-tools", relativePath: undefined });
	});

	it("parses a name and relative path", () => {
		expect(parseSkillUri("skill://pdf-tools/scripts/extract.sh")).toEqual({
			name: "pdf-tools",
			relativePath: "scripts/extract.sh",
		});
	});

	it("decodes percent-encoded parts", () => {
		expect(parseSkillUri("skill://foo/bar%2Fbaz")).toEqual({ name: "foo", relativePath: "bar/baz" });
		const ref = parseSkillUri("skill://caf%C3%A9");
		expect(ref?.name).toBe("caf\u00e9");
		expect(ref?.relativePath).toBeUndefined();
	});

	it("rejects an absolute relative path", () => {
		expect(parseSkillUri("skill://foo//etc/passwd")).toBeNull();
		expect(parseSkillUri("skill://foo/C:/Windows")).toBeNull();
	});

	it("rejects a relative path that escapes with ..", () => {
		expect(parseSkillUri("skill://foo/../secret")).toBeNull();
	});

	it("rejects a backslash path traversal", () => {
		expect(parseSkillUri("skill://demo/..\\..\\etc\\passwd")).toBeNull();
	});

	it("rejects an empty name", () => {
		expect(parseSkillUri("skill://")).toBeNull();
	});

	it("rejects a malformed percent-escape", () => {
		expect(parseSkillUri("skill://foo/%ZZ")).toBeNull();
	});

	it("rejects a non-skill prefix", () => {
		expect(parseSkillUri("read://foo")).toBeNull();
		expect(parseSkillUri("https://example.com")).toBeNull();
	});
});

describe("resolveSkillUriPath", () => {
	const skills = [
		createTestSkill({
			name: "demo",
			description: "Demo.",
			filePath: "/skills/demo/SKILL.md",
			baseDir: "/skills/demo",
		}),
	];

	it("resolves a name to the SKILL.md path", () => {
		expect(resolveSkillUriPath("skill://demo", skills)).toBe("/skills/demo/SKILL.md");
	});

	it("resolves a name and relative path inside the skill directory", () => {
		expect(resolveSkillUriPath("skill://demo/scripts/run.sh", skills)).toBe("/skills/demo/scripts/run.sh");
	});

	it("rejects a path that escapes the skill directory", () => {
		expect(resolveSkillUriPath("skill://demo/../escape", skills)).toBeNull();
	});

	it("returns null for an unknown skill", () => {
		expect(resolveSkillUriPath("skill://nope", skills)).toBeNull();
	});
});

describe("expandSkillCommandText", () => {
	const valid: Skill = {
		name: "valid-skill",
		description: "A valid skill for testing purposes.",
		filePath: join(fixturesDir, "valid-skill", "SKILL.md"),
		baseDir: join(fixturesDir, "valid-skill"),
		sourceInfo: createSyntheticSourceInfo(join(fixturesDir, "valid-skill", "SKILL.md"), { source: "test" }),
		disableModelInvocation: false,
	};
	const second: Skill = {
		name: "child-skill",
		description: "A nested skill in a subdirectory.",
		filePath: join(fixturesDir, "nested", "child-skill", "SKILL.md"),
		baseDir: join(fixturesDir, "nested", "child-skill"),
		sourceInfo: createSyntheticSourceInfo(join(fixturesDir, "nested", "child-skill", "SKILL.md"), { source: "test" }),
		disableModelInvocation: false,
	};

	it("expands a leading known skill and appends args", () => {
		const result = expandSkillCommandText("/skill:valid-skill do the thing", [valid]);
		expect(result.loadedSkills).toEqual(["valid-skill"]);
		expect(result.text).toContain(`<skill name="valid-skill" location="${valid.filePath}">`);
		expect(result.text).toContain("References are relative to");
		expect(result.text.endsWith("do the thing")).toBe(true);
		expect(result.unknownSkills).toEqual([]);
		expect(result.readErrors).toEqual([]);
	});

	it("returns an error block for a leading unknown skill", () => {
		const result = expandSkillCommandText("/skill:nope", [valid]);
		expect(result.unknownSkills).toEqual(["nope"]);
		expect(result.text).toBe(
			`<error>Unknown skill "nope". Available skills: valid-skill. Run /reload after adding a skill.</error>`,
		);
		expect(result.loadedSkills).toEqual([]);
	});

	it("expands an embedded token and turns the surrounding prose into args", () => {
		const result = expandSkillCommandText("please use /skill:valid-skill to extract", [valid]);
		expect(result.loadedSkills).toEqual(["valid-skill"]);
		expect(result.text).toContain(`<skill name="valid-skill"`);
		expect(result.text).not.toContain("/skill:valid-skill");
		expect(result.text).toContain("please use");
		expect(result.text).toContain("to extract");
		expect(result.text.indexOf("</skill>")).toBeLessThan(result.text.indexOf("to extract"));
	});

	it("expands multiple embedded tokens", () => {
		const result = expandSkillCommandText("use /skill:valid-skill then /skill:child-skill now", [valid, second]);
		expect(result.loadedSkills).toEqual(["valid-skill", "child-skill"]);
		expect(result.text).toContain(`<skill name="valid-skill"`);
		expect(result.text).toContain(`<skill name="child-skill"`);
		expect(result.text).toContain("use");
		expect(result.text).toContain("now");
	});

	it("leaves an unknown embedded token verbatim", () => {
		const result = expandSkillCommandText("use /skill:nope please", [valid]);
		expect(result.text).toBe("use /skill:nope please");
		expect(result.loadedSkills).toEqual([]);
		expect(result.unknownSkills).toEqual([]);
	});

	it("leaves a leading non-skill slash command untouched", () => {
		const result = expandSkillCommandText("/reload now", [valid]);
		expect(result.text).toBe("/reload now");
		expect(result.loadedSkills).toEqual([]);
	});

	it("records a read error and leaves the text unchanged", () => {
		const ghost: Skill = {
			name: "ghost",
			description: "Ghost.",
			filePath: "/non/existent/ghost/SKILL.md",
			baseDir: "/non/existent/ghost",
			sourceInfo: createSyntheticSourceInfo("/non/existent/ghost/SKILL.md", { source: "test" }),
			disableModelInvocation: false,
		};
		const result = expandSkillCommandText("/skill:ghost", [ghost]);
		expect(result.text).toBe("/skill:ghost");
		expect(result.loadedSkills).toEqual([]);
		expect(result.readErrors).toHaveLength(1);
		expect(result.readErrors[0].name).toBe("ghost");
	});

	it("returns the text unchanged when there are no skill tokens", () => {
		expect(expandSkillCommandText("just a normal message", [valid])).toEqual({
			text: "just a normal message",
			loadedSkills: [],
			unknownSkills: [],
			readErrors: [],
		});
	});

	it("does not expand a token embedded in a URL", () => {
		const text = "see https://example.com/skill:valid-skill now";
		const result = expandSkillCommandText(text, [valid]);
		expect(result.text).toBe(text);
		expect(result.loadedSkills).toEqual([]);
	});

	it("does not expand a token embedded in a path", () => {
		const text = "check path/skill:valid-skill here";
		const result = expandSkillCommandText(text, [valid]);
		expect(result.text).toBe(text);
		expect(result.loadedSkills).toEqual([]);
	});

	it("does not expand a token glued to trailing punctuation", () => {
		const text = "do(/skill:valid-skill)now";
		const result = expandSkillCommandText(text, [valid]);
		expect(result.text).toBe(text);
		expect(result.loadedSkills).toEqual([]);
	});

	it("collapses whitespace around a single expanded token", () => {
		const result = expandSkillCommandText("please use /skill:valid-skill to extract", [valid]);
		expect(result.loadedSkills).toEqual(["valid-skill"]);
		expect(result.text.endsWith("please use to extract")).toBe(true);
		expect(result.text).not.toContain("please use  ");
	});

	it("collapses multiple spaces around an expanded token", () => {
		const result = expandSkillCommandText("x  /skill:valid-skill  y", [valid]);
		expect(result.loadedSkills).toEqual(["valid-skill"]);
		expect(result.text.endsWith("x y")).toBe(true);
	});
});
