# pi 设计知识: check — 测试/校验/eval

> 数据源: pr_check.json (GitHub PR Search, earendil-works/pi)
> PR 快照: 2026-07-26 | 代码标记: 6160683a4a8012f0d1cd30c145df18b4ca6f5176 (v0.85.1-30-g6160683a4, 2026-09-08, main)
> total_count=489 (命中总数), 返回 10 条 (首屏)
> 检索: `ctx_search(queries:[...], source:"check")` 仅搜本主题

## 覆盖范围
coding-agent 测试离线策略、vitest eval harness、openai-completions 流式修复、durable external tool result、子进程归因 (AI_AGENT)、image block 渲染、OpenRouter OAuth fallback

## 设计原则
测试默认离线 (`PI_OFFLINE=1`); eval 走独立 workspace + 显式 provider/model; 非标准流式响应 (array content / 缺 finish_reason) 在 provider 适配层修复。

## PR 清单与设计要点

### #7031 [open] fix(coding-agent): run coding-agent tests offline by default
- 创建: 2026-07-23 | 更新: 2026-07-25
- URL: https://github.com/earendil-works/pi/pull/7031
- 设计要点: ** UPDATED - scope expanded - original issue was only setting PI_OFFLINE 1 in one test; now we are turning off by default for all coding-agent tests and turning back on for those that require it. See below: https://github.com/earendil-works/pi/pull/7031#issuecomment-5079016445** 

Hey there

I had a CI failure on a draft PR. This which turned out to because of a timed out request to the pi.dev anthropic model catalogue.

I suggest:disabling networking (PI_OFFLINE 1)keepig the tests focus

### #7117 [open] feat(coding-agent): add extension creation eval
- 创建: 2026-07-25 | 更新: 2026-07-25
- URL: https://github.com/earendil-works/pi/pull/7117
- 设计要点: Summary
replace the general-knowledge eval with a Coding Agent smoke eval
add a focused AgentSession adapter for vitest-evals
normalize Pi messages, tool calls, tool results, and usage for future judges
add an isolated eval that creates, reloads, and invokes a Pi extension

Validation
npm run build
npm run check
npm run eval -- smoke.eval.ts
npm run eval -- extensions.eval.ts
full non-e2e suite passed except one timing-sensitive 5303-bash-output-truncation failure; the test passed on immediate i

### #6572 [open] feat(coding-agent): render image blocks in interactive user messages
- 创建: 2026-07-12 | 更新: 2026-07-21
- URL: https://github.com/earendil-works/pi/pull/6572
- 设计要点: Summary
Render image blocks in interactive user messages using the existing TUI Image component.
Attach clipboard images to the next submitted user message instead of inserting a temp file path.
Show pending clipboard image attachments in the footer as 1 image attached / N images attached.
Preserve normal text clipboard paste behavior.

Closes #6563.

Testing
npm run build
npm run check
npx vitest --run test/user-message.test.ts test/interactive-mode-startup-input.test.ts
./test.sh with isolated

### #7114 [open] Add manual redirect URL fallback to OpenRouter OAuth login
- 创建: 2026-07-25 | 更新: 2026-07-25
- URL: https://github.com/earendil-works/pi/pull/7114
- 设计要点: Summary

/login openrouter only completes through the loopback callback server, so it can't finish on remote/headless machines (SSH, containers) — the browser runs elsewhere and can't reach 127.0.0.1 on the host running pi.

This races the callback server against a manual_code prompt, same as the Anthropic and OpenAI Codex flows: paste the final redirect URL (or the bare code) and it's exchanged with the same PKCE verifier. A claimed callback keeps priority, so a paste can't interrupt an in-flig

### #7022 [open (draft)] ***WIP it's a PoC *** fix(coding-agent): guard tree navigation during responses
- 创建: 2026-07-23 | 更新: 2026-07-25
- URL: https://github.com/earendil-works/pi/pull/7022
- 设计要点: WIP WIP WIP
Will add an issue as the other ones were auto-closed but never deliberately rejected by a maintainer. 

Thinking of solutions to the bug where if you /tree while the agent is streaming and go somewhere else, weird stuff happens. 

We *could* just block /tree entirely during streaming, but that would mean not being able to read the /tree anymore which I personally find v helpful when I'm planning my next move.

So instead this:lets you /treebut when you select a checkpoint du

### #7061 [open] fix(openai-completions): handle array content and missing finish_reason
- 创建: 2026-07-24 | 更新: 2026-07-25
- URL: https://github.com/earendil-works/pi/pull/7061
- 设计要点: Problem

Two bugs affecting providers that return non-standard streaming responses:

1. Array content ([object Object],[object Object])

Some Databricks models (Qwen3, gpt-oss reasoning models) return choice.delta.content as a **typed array** when tools are present:

 [code] [{"type": "reasoning", "summary": [...]}, {"type": "text", "text": "Hello!"}]

The current code does:
 [code] block.text += choice.delta.content; // array + string = "[object Object],[object

This produces garbled output ins

### #7131 [closed] Set AI_AGENT for child process attribution
- 创建: 2026-07-26 | 更新: 2026-07-26
- URL: https://github.com/earendil-works/pi/pull/7131
- 设计要点: Summary

Set AI_AGENT=pi in the CLI and RPC entry points, alongside the existing
PI_CODING_AGENT=true marker.

AI_AGENT is an emerging cross-agent convention used by Claude Code, GitHub
CLI, and Vercel's agent detection tooling. Setting it allows generic consumers
to identify Pi without Pi-specific heuristics.

Testing
npm run check
git diff --check

### #7085 [closed] feat(coding-agent): add vitest eval harness
- 创建: 2026-07-24 | 更新: 2026-07-25
- URL: https://github.com/earendil-works/pi/pull/7085
- 设计要点: Summaryadd a private packages/evals workspace using vitest-evals and the Pi SDKrequire explicit provider/model selection and use Pi's normal credential resolutionadd an isolated capital-of-France smoke eval with usage metadatashare workspace source aliases through vitest.base.tskeep private workspace and compatibility-alias versions synchronized during releases

Testingnpm run checknpm run buildnpm run test:scriptsfocused coding-agent config, image-processing, and argument testseval 

### #7111 [closed] feat: support durable external tool results
- 创建: 2026-07-25 | 更新: 2026-07-25
- URL: https://github.com/earendil-works/pi/pull/7111
- 设计要点: Summary

Adds a generic durable external-tool-result flow for any session host that must wait for a typed result outside the running agent process.
A tool can return defer: true.
Pi persists the assistant tool call and a JSONL pending marker, without fabricating a tool-result message.
AgentSession.listPendingExternalToolCalls() reconstructs unresolved calls after JSONL reopen.
AgentSession.submitExternalToolResult() writes a native tool result for the original toolCallId and resumes through Pi's

### #6681 [closed] windows: reset pi terminal title after checking npm packages
- 创建: 2026-07-15 | 更新: 2026-07-15
- URL: https://github.com/earendil-works/pi/pull/6681
- 设计要点: on windows the npm check changes the terminal title and it doesn't change back.
this is a narrow fix for it.
fixes #6629

