# pi 设计知识: mcp — MCP 扩展/transport/工具调用

> 数据源: pr_mcp.json (GitHub PR Search, earendil-works/pi)
> PR 快照: 2026-07-26 | 代码标记: 6160683a4a8012f0d1cd30c145df18b4ca6f5176 (v0.85.1-30-g6160683a4, 2026-09-08, main)
> total_count=17 (命中总数), 返回 10 条 (首屏)
> 检索: `ctx_search(queries:[...], source:"mcp")` 仅搜本主题

## 覆盖范围
MCP 扩展基础设施 (stdio/SSE, .pi/mcp.json)、动态工具注册与同步、ToolInfo label/execute、工具覆盖、请求大小溢出恢复、工具 schema 清洗、GLM-5.2 工具调用、worker-loop mode、RPC 超时

## 设计原则
MCP 走 extension 而非 core; 动态注册工具必须同步进 agent loop context; 工具冲突 last-write-wins; 大请求按"丢老图"恢复; 各 provider 工具 schema 差异在适配层处理。

## PR 清单与设计要点

### #6356 [closed] fix(ai): support GLM-5.2 tool calls
- 创建: 2026-07-06 | 更新: 2026-07-06
- URL: https://github.com/earendil-works/pi/pull/6356
- 设计要点: Summary

Fix OpenCode Go GLM-5.2 tool calls by using a non-streaming chat completion when tools are present.

GLM-5.2 returns tool calls correctly in the normal chat completion response, but its streamed response can miss the tool-call deltas. The fallback converts that response back into the same chunk shape the existing parser already handles, including reasoning text, tool calls, finish reason, and usage.

Tests
npm run check
./test.sh
node node_modules/vitest/dist/cli.js --run test/openai-co

### #6087 [closed] fix(coding-agent): remove hardcoded RPC wait timeout
- 创建: 2026-06-26 | 更新: 2026-06-26
- URL: https://github.com/earendil-works/pi/pull/6087
- 设计要点: closes #6088

RpcClient had a hardcoded 60s wait cap in waitForIdle(), collectEvents(), and promptAndWait(). This made long-running tool sessions fail even when the MCP server was still working.

This change removes the implicit client-side completion timeout and adds RpcClientOptions.waitTimeoutMs for callers that want one. By default, these helpers now wait for agent_end or subprocess failure without a client-side cap. Callers that want a 60-second client-side completion timeout can pass waitT

### #3774 [closed] feat(mcp): add MCP extension with stdio/SSE transport support
- 创建: 2026-04-26 | 更新: 2026-04-26
- URL: https://github.com/earendil-works/pi/pull/3774
- 设计要点: Summary
Adds .pi/extensions/mcp/ — a pi extension that connects agent sessions to MCP servers defined in .pi/mcp.json (project-local) or ~/.pi/agent/mcp.json (global)
Tools auto-register at session_start under mcp__<server>__<tool> and are cleaned up at session_shutdown
Adds .devcontainer/devcontainer.json for a reproducible Node 24 dev environment
Adds .pi/mcp.json wired to context7 as a sample server config

Extension features
**Transports**: stdio (subprocess) and SSE (remote URL)
**Config**:

### #4954 [closed] feat (coding-agent): Expose `getToolDefinition` to command context
- 创建: 2026-05-24 | 更新: 2026-07-07
- URL: https://github.com/earendil-works/pi/pull/4954
- 设计要点: I've seen more than enough tools and mcp servers where the author clearly never reviewed the actual output of those tools.

I made a /tool command extension that lets you call the agent tools manually. It does not add the calls to the context, just adds a nice ui to fill in the input schema and displays the tool output mostly raw - no custom rendering.

https://github.com/user-attachments/assets/6faed6c3-2c09-4233-9ef5-462dc273b9c1

Right now we actually don't have a way to grab the tool d

### #4264 [closed] fix(extensions): expose label/execute in ToolInfo and allow tool override via last-write-wins
- 创建: 2026-05-07 | 更新: 2026-05-07
- URL: https://github.com/earendil-works/pi/pull/4264
- 设计要点: Summary

This PR fixes two root causes that prevent Pi extensions from interacting with tools registered by other extensions, specifically blocking the pi-tool-display extension from overriding MCP Direct Tools' rendering behavior.

Background

The issue was discovered while investigating why pi-tool-display could not apply custom renderResult/renderCall to tools registered by pi-mcp-adapter.

Problem 1: ToolInfo omitted label and execute

ExtensionAPI.getAllTools() returned a Pick<ToolDefinitio

### #4224 [closed] fix: sync dynamically registered tools into agent loop context
- 创建: 2026-05-06 | 更新: 2026-05-06
- URL: https://github.com/earendil-works/pi/pull/4224
- 设计要点: Summary
refresh the running agent loop tool context after dynamic MCP tool registration
preserve the original static tool set while syncing dynamically loaded tools into subsequent turns

Validation
Not run in this session

### #5370 [closed] fix(coding-agent): recover from request-size overflow by dropping oldest images
- 创建: 2026-06-03 | 更新: 2026-06-03
- URL: https://github.com/earendil-works/pi/pull/5370
- 设计要点: Summary

Image-heavy sessions (many screenshots from browser/winshot/MCP tools) can exceed Anthropic's 32 MB request limit (HTTP 413 request_too_large) while still under the token window. isContextOverflow() already detects this (#2734), so overflow recovery (compact + retry) fires — but **compaction only summarizes text; it cannot shrink images.** The kept-recent image blocks keep the retried request over the limit, so recovery fails after a single attempt and the session becomes unusable.

Add

### #3410 [closed] fix(providers): sanitize tool schemas for Claude models via Google Code Assist proxy
- 创建: 2026-04-19 | 更新: 2026-04-19
- URL: https://github.com/earendil-works/pi/pull/3410
- 设计要点: **Issue**
When invoking Claude models through the Antigravity provider (Google Cloud Code Assist proxy), the API rejects requests containing certain JSON Schema properties within tool definitions. This leads to 400 Bad Request errors during tool execution. The failures stem from two distinct parsing limitations across the request pipeline:

1. The Google Cloud Code Assist proxy fails to parse const keywords nested inside anyOf arrays (e.g., generated by TypeBox unions), throwing Unknown name "co

### #4329 [closed] feat(coding-agent): add --mode worker-loop for bus-driven task dispatch
- 创建: 2026-05-08 | 更新: 2026-05-09
- URL: https://github.com/earendil-works/pi/pull/4329
- 设计要点: Summary

Adds a new pi-mono mode, pi --mode worker-loop, that subscribes to a host-provided Unix-socket message bus and runs the existing one-shot prompt path against each agent_task_request envelope. This is the in-pi replacement for a throwaway Node wrapper used downstream in boss-pi (scripts/worker-loop.ts).

The reference implementation being replaced (~340 LOC of TypeScript glue):
scripts/worker-loop.ts (path is local — file kept in the consumer repo).

The downstream task spec, quoted from

### #1221 [closed] Added Agents, MCP, Slash Comments and Autocomplete improvements
- 创建: 2026-02-03 | 更新: 2026-03-24
- URL: https://github.com/earendil-works/pi/pull/1221
- 设计要点: This pull request introduces a major new extension for the coding agent: Model Context Protocol (MCP) support, allowing dynamic integration with external MCP servers for tool/resource access. It also adds several new built-in slash commands for improved discoverability and extensibility, and enhances autocomplete functionality in the TUI. There are also minor model metadata updates and documentation improvements.

**Major Features and Extensions:**Added a new MCP extension (mcp/) for the codi

