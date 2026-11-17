import { describe, expect, it } from "vitest";
import { streamSimple } from "../src/api/anthropic-messages.ts";
import { getSupportedThinkingLevels, hasApi } from "../src/models.ts";
import { normalizeContext } from "../src/utils/transcript.ts";
import { generateFireworksModels } from "./catalog-generation-utils.ts";

describe("Fireworks model generation", () => {
	// Regression for #9323: import catalog efforts and correct only the known omissions.
	it("combines upstream effort and toggle metadata with narrow corrections", () => {
		const models = generateFireworksModels({
			"deepseek-v4-flash-0731": [{ type: "toggle" }, { type: "effort", values: ["low", "high", "max"] }],
			"deepseek-v4-flash-vision-exp": [{ type: "toggle" }, { type: "effort", values: ["low", "high", "max"] }],
			"deepseek-v4-pro-0813": [{ type: "toggle" }, { type: "effort", values: ["high", "max"] }],
			"qwen3p8-max": [{ type: "toggle" }],
			"qwen3p8-2p4t-a95b": [{ type: "effort", values: ["low", "medium", "xhigh"] }],
			"kimi-k2p6": [{ type: "toggle" }],
		});
		for (const id of ["deepseek-v4-flash-0731", "deepseek-v4-flash-vision-exp", "deepseek-v4-pro-0813"]) {
			expect(models[`accounts/fireworks/models/${id}`].thinkingLevelMap).toEqual({
				off: "none",
				minimal: null,
				low: "low",
				medium: null,
				high: "high",
				xhigh: null,
				max: "max",
			});
		}
		for (const id of ["qwen3p8-max", "qwen3p8-2p4t-a95b"]) {
			expect(models[`accounts/fireworks/models/${id}`].thinkingLevelMap).toEqual({
				off: "none",
				minimal: null,
				low: "low",
				medium: "medium",
				high: null,
				xhigh: "xhigh",
				max: null,
			});
		}
		for (const model of Object.values(models)) {
			if (!hasApi(model, "anthropic-messages")) throw new Error("Expected Messages model");
			expect(model.compat?.allowEmptySignature).toBe(true);
			expect(model.compat?.forceAdaptiveThinking).toBe(model.id.endsWith("kimi-k2p6") ? undefined : true);
		}
		expect(models["accounts/fireworks/models/kimi-k2p6"].thinkingLevelMap).toBeUndefined();
	});

	// Regression for #9323: new effort-capable models must not require an allowlist update.
	it("automatically sends native effort for newly cataloged Messages models", async () => {
		const models = generateFireworksModels({
			"new-reasoner": [{ type: "toggle" }, { type: "effort", values: ["low", "max"] }],
		});
		const model = models["accounts/fireworks/models/new-reasoner"];
		if (!hasApi(model, "anthropic-messages")) throw new Error("Expected Messages model");
		expect(model.compat?.forceAdaptiveThinking).toBe(true);
		expect(getSupportedThinkingLevels(model)).toEqual(["off", "low", "max"]);
		let payload: Record<string, unknown> | undefined;
		await streamSimple(model, normalizeContext({ messages: [{ role: "user", content: "test", timestamp: 0 }] }), {
			apiKey: "test-fireworks-key",
			reasoning: "max",
			onPayload: (value) => {
				payload = value as Record<string, unknown>;
				throw new Error("payload captured");
			},
		}).result();
		expect(payload?.thinking).toEqual({ type: "adaptive", display: "summarized" });
		expect(payload?.output_config).toEqual({ effort: "max" });
	});

	it("does not infer adaptive thinking from toggle, budget, or missing metadata", () => {
		const models = generateFireworksModels({
			"toggle-only": [{ type: "toggle" }],
			"budget-only": [{ type: "budget_tokens", min: 1024 }],
			"fixed-reasoning": [],
			"missing-metadata": undefined,
		});
		for (const model of Object.values(models)) {
			if (!hasApi(model, "anthropic-messages")) throw new Error("Expected Messages model");
			expect(model.compat?.forceAdaptiveThinking).toBeUndefined();
			expect(model.thinkingLevelMap).toBeUndefined();
		}
	});

	// Regression for #9323: full hardcoded maps must not override updated catalog efforts.
	it("prefers updated upstream efforts over fixed maps and the Qwen fallback", () => {
		const models = generateFireworksModels({
			"deepseek-v4-flash-0731": [{ type: "effort", values: ["high", "max"] }],
			"qwen3p8-max": [{ type: "toggle" }, { type: "effort", values: ["medium", "xhigh"] }],
		});
		expect(models["accounts/fireworks/models/deepseek-v4-flash-0731"].thinkingLevelMap).toEqual({
			off: null,
			minimal: null,
			low: null,
			medium: null,
			high: "high",
			xhigh: null,
			max: "max",
		});
		expect(models["accounts/fireworks/models/qwen3p8-max"].thinkingLevelMap).toEqual({
			off: "none",
			minimal: null,
			low: null,
			medium: "medium",
			high: null,
			xhigh: "xhigh",
			max: null,
		});
	});
});
