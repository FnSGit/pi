# pi 设计知识: pideps — 依赖/打包/frontmatter

> 数据源: pr_pideps.json (GitHub PR Search, earendil-works/pi)
> PR 快照: 2026-07-26 | 代码标记: 6160683a4a8012f0d1cd30c145df18b4ca6f5176 (v0.85.1-30-g6160683a4, 2026-09-08, main)
> total_count=7 (命中总数), 返回 7 条 (首屏)
> 检索: `ctx_search(queries:[...], source:"pideps")` 仅搜本主题

## 覆盖范围
frontmatter 集中解析、prompt template argument-hint、async extension factory、npm legacy-peer-deps、strip-ansi 依赖补全、custom tool export、plan mode step tracking

## 设计原则
frontmatter 解析集中化 + yaml 库 (支持多行); extension factory 支持异步; npm 安装/卸载处理 peer-deps 冲突。

## PR 清单与设计要点

### #6604 [closed] add legacy-peer-deps flag on pi uninstall when using npm
- 创建: 2026-07-13 | 更新: 2026-07-13
- URL: https://github.com/earendil-works/pi/pull/6604
- 设计要点: otherwise it would fail when there's conflicting peer dependencies in installed packages

fixes: #6486

### #2780 [closed] feat(coding-agent,tui): support argument-hint frontmatter in prompt templates
- 创建: 2026-04-02 | 更新: 2026-07-01
- URL: https://github.com/earendil-works/pi/pull/2780
- 设计要点: What

Parse argument-hint from prompt template frontmatter and display it in the autocomplete dropdown, so users can see what arguments a command expects before invoking it.

Frontmatter format

Use <angle brackets> for required arguments and [square brackets] for optional ones:

 [code] ---

How it renders

The hint prepends to the description column in autocomplete:

 [code] → pr   <PR-URL>       — Review PRs from URLs with structured issue and code anal

Changes

| File | Change |
|------|---

### #513 [closed] feat(extensions): support async extension factory functions
- 创建: 2026-01-06 | 更新: 2026-03-24
- URL: https://github.com/earendil-works/pi/pull/513
- 设计要点: Summary

Extensions can now use async initialization, enabling dynamic imports, async setup, and lazy-loaded dependencies.

Problem

Extension factories are called without await:

 [code] factory(api);  // NOT awaited

This prevents extensions from using async patterns like:

 [code] export default async function(pi: ExtensionAPI) {

Solution
Update ExtensionFactory type to return void | Promise<void>
Await factory calls in loadExtensionWithBun, loadExtension, and loadExtensionFromFactory
Make l

### #1738 [closed] fix(coding-agent): add missing strip-ansi dependency
- 创建: 2026-03-03 | 更新: 2026-03-03
- URL: https://github.com/earendil-works/pi/pull/1738
- 设计要点: Summary

strip-ansi is imported in three source files but not declared in packages/coding-agent/package.json dependencies:
src/core/bash-executor.ts
src/modes/interactive/components/bash-execution.ts
src/modes/interactive/components/tool-execution.ts

This causes ERR_MODULE_NOT_FOUND at runtime when used with strict package managers like pnpm that do not hoist undeclared dependencies. It started affecting consumers after the 0.55.3 release.

Fix

Added "strip-ansi": "^7.1.0" to dependencies in p

### #728 [closed] Centralize frontmatter parsing + parse frontmatter with yaml library
- 创建: 2026-01-14 | 更新: 2026-01-15
- URL: https://github.com/earendil-works/pi/pull/728
- 设计要点: Problem: When porting my claude code skills to pi I had some multi-line descriptions. Pi only parsed the first line which is "|".

There are several similar frontmatter functions in the codebase (each was slightly different)

I've consolidated into a single function and used the yaml library to parse the yaml (see below for library choice background).

Finally, the Select component didn't handle multi line descriptions well, so I updated the component to replace new lines with spaces.

I

### #702 [closed] feat(coding-agent): Custom tool export rendering in export
- 创建: 2026-01-13 | 更新: 2026-01-16
- URL: https://github.com/earendil-works/pi/pull/702
- 设计要点: Hello! Follows https://github.com/badlogic/pi-mono/issues/669

Opening this as a draft PR so we can iterate on it and get feedback if people want to try it.

Turns out the implementation is not too far from the POC. Here's how it works:We create a ToolHtmlRenderer with everything needed to render a tool (how to retrieve a tool definition and the theme)We loop on the session entries, storing the non builtin-tool calls and their result. then we call their renderCall and renderResult function

### #694 [closed] feat(plan-mode): enhanced plan mode with explicit step tracking
- 创建: 2026-01-13 | 更新: 2026-01-13
- URL: https://github.com/earendil-works/pi/pull/694
- 设计要点: Dependencies

> ⚠️ This PR depends on #695 (questionnaire tool) - the questionnaire tool is included in plan mode's available tools.

Changes from the original
**Explicit [DONE:n] tracking** - More accurate than auto-marking on tool_result. The original auto-completed steps on every tool result, which was inaccurate for multi-tool steps.
**Plan: header requirement** - Only extracts todos from Plan: sections, not random numbered lists in the response
**Questionnaire tool enabled** - Plan mode inc

