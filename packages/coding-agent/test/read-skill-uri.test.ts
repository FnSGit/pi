import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { ExtensionToolContext } from "../src/core/extensions/types.ts";
import { resolveSkillUriPath, type Skill } from "../src/core/skills.ts";
import { createSyntheticSourceInfo } from "../src/core/source-info.ts";
import { createReadToolDefinition } from "../src/core/tools/read.ts";

function textOf(result: { content: ReadonlyArray<{ type: string; text?: string }> }): string {
	return result.content
		.filter((block) => block.type === "text")
		.map((block) => block.text ?? "")
		.join("\n");
}

describe("read tool skill:// URIs", () => {
	let tempDir: string;

	beforeEach(() => {
		tempDir = mkdtempSync(join(tmpdir(), "read-skill-uri-"));
	});

	afterEach(() => {
		rmSync(tempDir, { recursive: true, force: true });
	});

	function makeSkill(name: string): Skill {
		const dir = join(tempDir, name);
		mkdirSync(dir, { recursive: true });
		const filePath = join(dir, "SKILL.md");
		writeFileSync(filePath, `# ${name}\n\nskill-uri-marker:${name}\n`);
		return {
			name,
			description: `${name} description.`,
			filePath,
			baseDir: dir,
			sourceInfo: createSyntheticSourceInfo(filePath, { source: "test" }),
			disableModelInvocation: false,
		};
	}

	it("reads a skill://<name> URI through the resolver", async () => {
		const skill = makeSkill("demo");
		const tool = createReadToolDefinition(tempDir, {
			resolveSkillUri: (uri) => (uri === "skill://demo" ? skill.filePath : null),
		});

		const result = await tool.execute("call-1", { path: "skill://demo" }, undefined, undefined, {
			cwd: tempDir,
		} as unknown as ExtensionToolContext);

		expect(textOf(result)).toContain("skill-uri-marker:demo");
	});

	it("rejects an unknown skill:// URI with an actionable error", async () => {
		const skill = makeSkill("demo");
		const tool = createReadToolDefinition(tempDir, {
			resolveSkillUri: (uri) => (uri === "skill://demo" ? skill.filePath : null),
		});

		await expect(
			tool.execute("call-2", { path: "skill://missing" }, undefined, undefined, {
				cwd: tempDir,
			} as unknown as ExtensionToolContext),
		).rejects.toThrow(/Cannot resolve "skill:\/\/missing"/);
	});

	it("rejects a skill:// URI when no resolver is configured", async () => {
		const tool = createReadToolDefinition(tempDir);

		await expect(
			tool.execute("call-3", { path: "skill://demo" }, undefined, undefined, {
				cwd: tempDir,
			} as unknown as ExtensionToolContext),
		).rejects.toThrow(/Cannot resolve/);
	});

	it("reads skill:// URIs through the real resolveSkillUriPath", async () => {
		const skill = makeSkill("demo");
		const bundledPath = join(skill.baseDir, "references", "formats.md");
		mkdirSync(join(skill.baseDir, "references"), { recursive: true });
		writeFileSync(bundledPath, "bundled-marker:formats\n");
		const tool = createReadToolDefinition(tempDir, {
			resolveSkillUri: (uri) => resolveSkillUriPath(uri, [skill]),
		});
		const ctx = { cwd: tempDir } as unknown as ExtensionToolContext;

		const root = await tool.execute("call-4", { path: "skill://demo" }, undefined, undefined, ctx);
		expect(textOf(root)).toContain("skill-uri-marker:demo");

		const bundled = await tool.execute(
			"call-5",
			{ path: "skill://demo/references/formats.md" },
			undefined,
			undefined,
			ctx,
		);
		expect(textOf(bundled)).toContain("bundled-marker:formats");

		await expect(
			tool.execute("call-6", { path: "skill://demo/../escape" }, undefined, undefined, ctx),
		).rejects.toThrow(/Cannot resolve/);
	});
});
