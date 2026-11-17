---
name: pi-design-knowledge
description: pi (earendil-works) 仓库设计知识库 — 基于 42 个历史 PR 调研, 覆盖 MCP 扩展与工具注册/覆盖、官方 local-LLM provider、依赖打包与 frontmatter 解析、测试离线策略与 eval harness、extension 公开 API 五大主题, 按 references/<主题>.md 模块化检索。Use when 设计或排障 pi 的 MCP / extension / provider / tool 注册机制, 或需要查询 pi 某功能的历史 PR 与设计决策。
---

# pi-design-knowledge

pi (earendil-works/pi) 仓库设计知识库。基于一次系统性的 PR 调研(5 个主题, 42 个 PR)
提炼, 用于在设计/排障 pi 相关功能时快速定位历史决策, 避免重复调查。

## 何时使用

当遇到以下任一情况时加载本 skill:

- 设计或改动 pi 的 **MCP 扩展 / 工具注册 / 工具覆盖** 相关功能
- 设计或改动 **官方 provider 扩展 / local-LLM provider** (Qwen 等)
- 排查 **依赖打包 / frontmatter 解析 / extension reload 缓存** 问题
- 排查 **测试离线策略 / eval harness / 工具调用参数校验** 问题
- 设计 **扩展公开 API / InlineExtension / extension factory / reportUsage** 等 extension 机制
- 排查 **请求大小溢出 / 工具 schema 清洗 / 非标准流式响应** 等 ai 层问题
- 需要回答 "pi 之前是否为 X 做过 PR / 采用了什么方案"

不用于: 通用 pi 用法问答 (查 pi 自带文档); 与上述主题无关的 bug。

## 模块化检索 (按需加载, 避免带入无关内容)

知识按主题拆成 5 个独立 reference 文件, **各自独立索引**。
先看下表判断该去哪个主题, 再按"检索方式"只取该主题, 不要全量加载。

| 主题 | reference 文件 | 覆盖问题 | PR 数 |
|------|--------------|----------|-------|
| check | `references/check.md` | 测试离线 / eval harness / 流式响应修复 / durable tool result / 子进程归因 | 10 |
| mcp | `references/mcp.md` | MCP 扩展(stdio/SSE) / 动态工具注册 / 工具覆盖 / 请求溢出 / schema 清洗 / worker-loop | 10 |
| official | `references/official.md` | 官方 local-LLM provider 扩展 / Qwen CLI OAuth / reload 依赖缓存 | 5 |
| pideps | `references/pideps.md` | frontmatter 集中解析 / argument-hint / async factory / npm peer-deps / strip-ansi | 7 |
| register | `references/register.md` | InlineExtension / createDPiExtension 拆分 / Event 导出 / jiti 缓存 / reportUsage / 参数校验 | 10 |

**检索方式 (三选一, 优先方式 1)**:

1. **语义检索 (推荐, 最省 context)** — 只搜目标主题, 命中精准片段:
   ```
   ctx_search(queries: ["你的关键词"], source: "<主题名>")
   # source 取上表"主题"列: check / mcp / official / pideps / register
   ```
   不确定主题时, 不带 source 跨主题搜, 但会带入更多片段。
2. **整主题加载** — 需要通览该主题全部 PR 时:
   ```
   read references/<主题>.md
   ```
3. **查原始 PR JSON** — 需要未压缩的 body / 全字段:
   ```
   ctx_execute_file(path: "pr_<主题>.json", ...)   # 按需过滤 number/title
   ```

查 GitHub 最新状态 (PR 可能已合并): `gh pr view <number> -R earendil-works/pi`
或 `gh pr diff <number>` (本仓库 gh 已登录, 见 skill `gh`)。

## 数据标记 (使用前先校准)

> **缺口提示**: PR 快照早于代码标记约 6 周, 期间可能有新 PR/合并。
> 遇"最新状态"类问题先按下方【同步更新流程】刷新, 不要直接断言。

- PR 数据快照日期: **2026-07-26** (`pr_*.json` 文件 mtime)
- 当前代码标记: commit `6160683a4a8012f0d1cd30c145df18b4ca6f5176`
  (describe `v0.85.1-30-g6160683a4`, 日期 2026-09-08, 分支 main)

每个主题文件仅含 search API 分页首屏 (通常 10 条), `total_count` 为命中总数;
首屏外 PR 需用 `gh pr list --search` 补查 (见下)。

## 同步更新流程

当出现以下信号时刷新本 skill:

1. 当前 commit 已超前记录的代码标记较多 (`git rev-parse HEAD` 对比)。
2. 遇到 07-26 之后的新 PR / 新合并。
3. 用户明确要求刷新。

刷新步骤:

```bash
# 1. 记录新代码标记
git rev-parse HEAD && git show -s --format=%ci HEAD && git describe --tags --always

# 2. 重新拉取各主题 PR 快照 (覆盖 pr_*.json)
#    gh pr list --search 直接列出, 支持排序/分页
gh pr list -R earendil-works/pi --state all --limit 30 \
  --search "check in:title,body" \
  --json number,title,state,createdAt,updatedAt,body > pr_check.json
#   其余主题同理替换 search 关键词 (mcp / official local-LLM provider / frontmatter / register tool)
#   注意: gh pr list 返回数组, 非 search API 的 {items, total_count} 结构;
#         重生成 references/<主题>.md 时需按数组遍历

# 3. 重生成受影响主题的 references/<主题>.md (从 pr_<主题>.json 提炼)
# 4. ctx_index 重新索引更新的文件 (source: <主题名>)
```

## 文件清单

```
.pi/skills/pi-design-knowledge/        # 相对 pi 仓库根
├── SKILL.md                          # 本文件 (轻量导航, 不含 PR 细节)
└── references/
    ├── check.md                      # 主题1 (独立索引 source=check)
    ├── mcp.md                        # 主题2 (独立索引 source=mcp)
    ├── official.md                   # 主题3 (独立索引 source=official)
    ├── pideps.md                     # 主题4 (独立索引 source=pideps)
    └── register.md                   # 主题5 (独立索引 source=register)
```

原始数据 `pr_*.json` 保留在 pi 仓库根目录 (`./pr_*.json`), 与本 skill 同项目。
