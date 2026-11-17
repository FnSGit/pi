# pi 设计知识: register — 工具注册/package-manager/public API

> 数据源: pr_register.json (GitHub PR Search, earendil-works/pi)
> PR 快照: 2026-07-26 | 代码标记: 6160683a4a8012f0d1cd30c145df18b4ca6f5176 (v0.85.1-30-g6160683a4, 2026-09-08, main)
> total_count=75 (命中总数), 返回 10 条 (首屏)
> 检索: `ctx_search(queries:[...], source:"register")` 仅搜本主题

## 覆盖范围
InlineExtension 类型、createDPiExtension 拆分、ToolExecution*Event 导出、package-manager git 包恢复、jiti 缓存持久化、reportUsage API、tool-call 参数校验、memory_save、hooks subpath export

## 设计原则
扩展机制持续公开化 (InlineExtension / Event 类型 / reportUsage); TS extension 经 jiti 运行时编译且缓存持久化到 agent dir; 工具调用最终参数需校验; 大扩展按职责拆分。

## PR 清单与设计要点

### #6847 [closed] fix: export ToolExecution*Event types from public API
- 创建: 2026-07-20 | 更新: 2026-07-20
- URL: https://github.com/earendil-works/pi/pull/6847
- 设计要点: Summary

Adds the missing ToolExecution*Event type exports to the public API of @earendil-works/pi-coding-agent, making them importable by extension developers and consumers of the package.

Problem

Unlike other event types such as SessionStartEvent, ToolCallEvent, and ToolResultEvent, the ToolExecution*Event types were not re-exported from packages/coding-agent/src/index.ts. This meant they were absent from the generated dist/index.d.ts, preventing users from importing them:

 [code] import ty

### #6467 [closed] fix(package-manager): restore missing git package deps + pnpm-friendly install flags
- 创建: 2026-07-09 | 更新: 2026-07-10
- URL: https://github.com/earendil-works/pi/pull/6467
- 设计要点: Problem

A git package whose checkout exists but whose node_modules is missing fails to load with Cannot find module '<dep>'. This hits pnpm users in particular.

Repro (the case I hit): @tintinweb/pi-subagents is installed as git:github.com/cad0p/tintinweb-pi-subagents@master with "npmCommand": ["pnpm"]. After the checkout lost its node_modules (a git clean -fdx during reconcile, a fresh clone by another tool, or a partial state), pi failed at startup:

 [code] Error: Failed to load extension "

### #6892 [closed] fix: persist jiti cache in agent dir to avoid cold start recompilation
- 创建: 2026-07-21 | 更新: 2026-07-21
- URL: https://github.com/earendil-works/pi/pull/6892
- 设计要点: Problem

Pi extensions written in TypeScript are compiled at runtime by jiti/Babel. The compiled output is cached to os.tmpdir()/jiti/ (/var/folders/.../T/jiti/ on macOS). 

macOS periodically removes unused files from temp directories (default: 3 days). When the cache is purged, every .ts extension must be recompiled on next startup.

Impact

Measured with PI_TIMING=1 on a system with pi-powerline-footer, pi-goal, and ponytail extensions:

| Phase | Cold (no jiti cache) | Warm (with cache) | Pe

### #5497 [closed] Fix coding-agent hooks package export
- 创建: 2026-06-08 | 更新: 2026-06-08
- URL: https://github.com/earendil-works/pi/pull/5497
- 设计要点: Summary

Fixes the published @earendil-works/pi-coding-agent/hooks subpath export by adding a deprecated compatibility entry point that maps the former hooks API names to the current extension API.

Root Cause

The package still advertises:

 [code] "./hooks": {

but packages/coding-agent/src/core/hooks was removed when hooks were merged into the extension system, so the published tarball does not contain dist/core/hooks/index.js or dist/core/hooks/index.d.ts.

Impact

Consumers importing @earen

### #6267 [closed] feat(coding-agent): add InlineExtension type for named inline extension factories
- 创建: 2026-07-02 | 更新: 2026-07-06
- URL: https://github.com/earendil-works/pi/pull/6267
- 设计要点: Closes #6260.

Summary

Adds an InlineExtension union type so inline extension factories passed to main() can be named for display in the startup Extensions list. Instead of <inline:1>, a named factory displays as <inline:my-extension>.

ExtensionFactory stays unchanged — bare functions are still accepted. The named wrapper is opt-in via { name, factory }.

ChangesAdd InlineExtension union type alongside ExtensionFactoryWiden extensionFactories fields in MainOptions, DefaultResourceLoa

### #5765 [closed] feat(d-pi): split createDPiExtension into remote-executor-extension and multi-agent-extension
- 创建: 2026-06-15 | 更新: 2026-06-15
- URL: https://github.com/earendil-works/pi/pull/5765
- 设计要点: Summary

Decompose the previous monolithic createDPiExtension into two focused, independently registrable extensions (plus the already-separated metadata extension):
createMultiAgentExtension (multi-agent-extension.ts): core orchestration surface — agent lifecycle (create/destroy_agent), send_message (next/steer), group_architecture, all source tools, dual-registered /agents and /sources commands (server stubs + real TUI handlers), d-pi custom message rendering, connect/source input event routin

### #6597 [closed] feat(memory): agent-driven memory_save tool + TUI/webui recall parity
- 创建: 2026-07-13 | 更新: 2026-07-13
- URL: https://github.com/earendil-works/pi/pull/6597
- 设计要点: Summary

Agent-facing memory_save tool with three outcomes (created/skipped/updated) plus TUI↔webui recall parity (both consume the same RecallResult shape from the unified recallPipeline). Replaces cosine-gate + Phase-2 LLM 二次确认 with a single LLM call per /compact cycle using oldId for in-place rewrites.

Changes
**memory_save tool** (extensions/personal-assistant/memory-save.ts:386): TypeBox-validated MemorySaveParams, three write paths via MemorySaveResult.details.action (created / skipped / 

### #6119 [closed] feat: add reportUsage API for extensions to contribute session cost
- 创建: 2026-06-27 | 更新: 2026-06-27
- URL: https://github.com/earendil-works/pi/pull/6119
- 设计要点: Problem
The subagent extension tracks token and cost usage per subagent, but there is no way for extensions to feed usage back into the main session footer or /session totals. Subagent costs only appear in individual tool result cards (expand with Ctrl+O).

Solution
Add pi.reportUsage(input, output, cacheRead, cacheWrite, cost, source?) to ExtensionAPI.

Changes (7 files, +94 lines)
**core/session-manager.ts** — New ExternalUsageEntry type + appendExternalUsage() method
**core/extensions/types.t

### #5963 [closed] fix(ai): reject malformed final tool call arguments
- 创建: 2026-06-22 | 更新: 2026-06-22
- URL: https://github.com/earendil-works/pi/pull/5963
- 设计要点: Summary
validate final streamed tool-call argument JSON in the shared ai stream path
keep partial JSON parsing for streaming updates, but fail with stopReason: "error" before toolcall_end/done can expose malformed final arguments
reject assistant messages that contain tool calls but finish with a non-toolUse stop reason

Tests
npm run check
cd packages/ai && ./node_modules/.bin/vitest --run test/strict-final-tool-arguments.test.ts
./test.sh was attempted: agent and ai package tests passed; codin

### #4007 [closed] feat(coding-agent): add official local-LLM provider extensions
- 创建: 2026-04-30 | 更新: 2026-05-01
- URL: https://github.com/earendil-works/pi/pull/4007
- 设计要点: SummaryAdds four official local-LLM provider extensions under packages/coding-agent/examples/extensions/:custom-provider-llamacpp/, custom-provider-lmstudio/, custom-provider-vllm/, custom-provider-ollama/.
  Each is an async-factory custom provider that probes its engine's model endpoint at startup, registers the discovered models with curated context-window/max-tokens defaults, and surfaces probe failures via ctx.ui.notify from session_start instead of going silent. 
  
 So it close #3357.

