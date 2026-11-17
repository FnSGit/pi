# pi 设计知识: official — 官方 local-LLM provider 扩展

> 数据源: pr_official.json (GitHub PR Search, earendil-works/pi)
> PR 快照: 2026-07-26 | 代码标记: 6160683a4a8012f0d1cd30c145df18b4ca6f5176 (v0.85.1-30-g6160683a4, 2026-09-08, main)
> total_count=5 (命中总数), 返回 5 条 (首屏)
> 检索: `ctx_search(queries:[...], source:"official")` 仅搜本主题

## 覆盖范围
官方 local-LLM provider 扩展 (#4007/#4154/#4186)、Qwen CLI OAuth provider、extension reload 依赖缓存保留

## 设计原则
local-LLM provider 走 extension 实现, core 不引入 provider schema (回应 #3357 的 @badlogic 建议); reload 不重算依赖缓存。

## PR 清单与设计要点

### #6109 [closed] fix(coding-agent): preserve dependency cache on extension reload
- 创建: 2026-06-27 | 更新: 2026-06-27
- URL: https://github.com/earendil-works/pi/pull/6109
- 设计要点: Fixes #6108

Summary

Fix release binary extension reloads re-evaluating dependency modules on /reload.

As described in #6108, the compiled release binary could reload an extension by reprocessing its dependency graph. That meant dependencies with module evaluation side effects could run those side effects again on every /reload.

This change keeps /reload behavior for extension code, while preserving cached third-party dependency modules across reloads.

Code changesReuse one extens

### #4186 [closed] feat(coding-agent): add official local-LLM provider extensions
- 创建: 2026-05-05 | 更新: 2026-05-05
- URL: https://github.com/earendil-works/pi/pull/4186
- 设计要点: Summary

Implements the official local-LLM extensions @badlogic suggested in #3357 — extension-based, no core schema
change. Closes #3357. Closes #3469.

1. feat(coding-agent): add official local-LLM provider extensions — the four async-factory custom providers
under packages/coding-agent/examples/extensions/.
2. docs(coding-agent): document dynamic model discovery for custom providers — adds a "Dynamic Model
Discovery" section to docs/custom-provider.md with the canonical recipe (AbortC

### #4154 [closed] feat(coding-agent): add official local-LLM provider extensions
- 创建: 2026-05-04 | 更新: 2026-05-05
- URL: https://github.com/earendil-works/pi/pull/4154
- 设计要点: ## Summary

  Implements the official local-LLM extensions @badlogic suggested in #3357 — extension-based, no core schema
  change. Closes #3357. Closes #3469.

  Four new async-factory custom providers under packages/coding-agent/examples/extensions/. Each probes its
  engine at startup, registers discovered models with curated context-window/max-tokens defaults, and surfaces
  probe failures via a session_start notify rather than going silent.

  | Extension | Default | Engine-specifi

### #4007 [closed] feat(coding-agent): add official local-LLM provider extensions
- 创建: 2026-04-30 | 更新: 2026-05-01
- URL: https://github.com/earendil-works/pi/pull/4007
- 设计要点: SummaryAdds four official local-LLM provider extensions under packages/coding-agent/examples/extensions/:custom-provider-llamacpp/, custom-provider-lmstudio/, custom-provider-vllm/, custom-provider-ollama/.
  Each is an async-factory custom provider that probes its engine's model endpoint at startup, registers the discovered models with curated context-window/max-tokens defaults, and surfaces probe failures via ctx.ui.notify from session_start instead of going silent. 
  
 So it close #3357.

### #940 [closed] feat(coding-agent): add Qwen CLI OAuth provider
- 创建: 2026-01-25 | 更新: 2026-07-06
- URL: https://github.com/earendil-works/pi/pull/940
- 设计要点: Adds a Qwen CLI provider extension with OAuth device flow support, matching the official Qwen CLI.

Changes:Add custom-provider-qwen-cli extension (packages/coding-agent/examples/extensions/custom-provider-qwen-cli)Add Qwen OAuth device flow with PKCE and refresh supportRegister Qwen models (coder plus/flash + vision) with OpenAI-compatible APIAdd thinkingFormat: "qwen" to core types (uses enable_thinking param)Enable modifyModels hook for extension OAuth providers (documented in packages

