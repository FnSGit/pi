import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { afterEach, expect } from "vitest";
import type { ModelsDevReasoningOption, ModelsDevV2Catalog, ModelsDevV2Model } from "../catalog/sources/models-dev.ts";
import type { Api, Model } from "../src/types.ts";

const packageRoot = fileURLToPath(new URL("..", import.meta.url));
const temporaryRoots: string[] = [];

afterEach(() => {
	for (const root of temporaryRoots.splice(0)) rmSync(root, { force: true, recursive: true });
});

/**
 * Write a `node --import` preload that serves every upstream catalog the
 * generator fetches: the given models.dev v2 catalog, and minimal responses for
 * the other sources. Any other request fails.
 */
export function writeUpstreamMock(preloadPath: string, modelsDev: ModelsDevV2Catalog): void {
	const responses = {
		"https://models.dev/experimental/v2.0/api.json": modelsDev,
		"https://models.dev/models.json?type=decision": {
			"typesafe/jev-latest": { id: "typesafe/jev-latest", name: "Jev", type: "decision", limit: { context: 64000 } },
		},
		"https://openrouter.ai/api/v1/models": { data: [] },
		"https://openrouter.ai/api/v1/models?output_modalities=image": {
			data: [
				{
					id: "test/image",
					name: "Test Image",
					architecture: { input_modalities: ["text"], output_modalities: ["image"] },
					pricing: {},
				},
			],
		},
		"https://openrouter.ai/api/v1/models?output_modalities=decisions": { data: [] },
		"https://ai-gateway.vercel.sh/v1/models": { data: [] },
		"https://radius.pi.dev/v1/config": {
			baseUrl: "https://radius.pi.dev",
			models: [
				{
					id: "test",
					name: "Test",
					reasoning: false,
					input: ["text"],
					cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
					contextWindow: 4096,
					maxTokens: 4096,
				},
			],
		},
	};
	writeFileSync(
		preloadPath,
		`const responses = ${JSON.stringify(responses)};\n` +
			`globalThis.fetch = async (input) => {\n` +
			`  const url = String(input);\n` +
			`  if (url in responses) return Response.json(responses[url]);\n` +
			`  throw new Error(\`Unexpected fetch: \${url}\`);\n` +
			`};\n`,
	);
}

/**
 * Generate the Fireworks catalog from a mocked models.dev upstream. Each entry
 * maps a model name (without the `accounts/fireworks/models/` prefix) to its
 * reasoning metadata, so tests stay independent of what models.dev currently
 * lists for Fireworks.
 */
export function generateFireworksModels(
	options: Record<string, ModelsDevReasoningOption[] | undefined>,
): Record<string, Model<Api>> {
	const root = mkdtempSync(join(tmpdir(), "pi-fireworks-generation-"));
	temporaryRoots.push(root);
	const preloadPath = join(root, "mock-catalog.mjs");
	const outputPath = join(root, "catalog");
	const models = Object.entries(options).map(([id, reasoningOptions]): ModelsDevV2Model => {
		const effort = reasoningOptions?.find((option) => option.type === "effort");
		const budget = reasoningOptions?.find((option) => option.type === "budget_tokens");
		return {
			id: `accounts/fireworks/models/${id}`,
			type: "chat",
			name: id,
			modalities: { input: ["text"], output: ["text"] },
			// Real Fireworks Messages models allow a large output, which keeps thinking
			// budgets at their level default instead of the 4096 fallback cap.
			limit: { context: 131072, output: 32768 },
			capabilities: {
				tools: { supported: true },
				reasoning: {
					supported: true,
					...(reasoningOptions?.some((option) => option.type === "toggle") ? { toggle: true } : {}),
					...(effort ? { effort: effort.values } : {}),
					...(budget ? { budget: { min: budget.min, max: budget.max } } : {}),
				},
			},
			api: {},
		};
	});
	writeUpstreamMock(preloadPath, {
		"fireworks-ai": { models: Object.fromEntries(models.map((model) => [model.id, model])) },
	});
	const result = spawnSync(
		process.execPath,
		["--import", pathToFileURL(preloadPath).href, "catalog/generate.ts", "--json-only", "--json-output", outputPath],
		{ cwd: packageRoot, encoding: "utf8", timeout: 10_000 },
	);
	expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
	expect(result.stderr).toBe("");
	return JSON.parse(readFileSync(join(outputPath, "providers/fireworks.json"), "utf8")) as Record<string, Model<Api>>;
}
