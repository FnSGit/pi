---
name: pi-update
description: 从 git 源码更新 pi 到最新版本并安装到用户级全局：快进 main（上游镜像）-> 并入 dev/blunt -> 构建二进制 -> 安装到 ~/.local/share/pi 并创建 ~/.local/bin/pi wrapper -> push 两个分支。Use when the user asks to 更新 pi / 升级 pi / 从源码重装 pi / 拉 pi 最新版本。
compatibility: 需要 node、npm、bun、git。脚本按自身位置定位仓库根目录，不依赖 cwd。
---

# pi-update Skill

从 git 源码更新 pi 到最新版本并安装到用户级全局。

## 何时使用

- 更新 / 升级 pi 到最新版本
- 从源码构建安装 pi
- 拉取 pi 最新版本

## 前置条件

- 本 skill 目录位于 pi 仓库内（脚本用 `SCRIPT_DIR/../../../` 定位仓库根，与 cwd 无关）
- 已安装 `node` / `npm` / `bun` / `git`（脚本会预检查）
- 阶段 1（依赖安装，npm）与阶段 2（generate-models，node fetch）都需要代理可达 `registry.npmjs.org`
  与 model data 端点；脚本已为两阶段都设好代理（见「故障排查」）

## 分支模型

仓库用双分支：

| 分支 | 角色 |
|---|---|
| `main` | 上游镜像，与 `upstream/main` 永远一致，只允许 ff；`origin/main` 同此 |
| `dev/blunt` | fork 自有功能（footer 改造、`skill://` URI 等），构建来源；`origin/dev/blunt` 同此。
fork 的 changelog 条目写在 `packages/coding-agent/CHANGELOG.fork.md`，`CHANGELOG.md` 保持与上游一致 |

脚本按此模型工作：快进 `main`（必要时用 `fetch main:main`，不切工作树）→ 把 `main` 并入
当前检出的 `dev/blunt` → 构建 → 安装 → push 两个分支。因此：

- 上游天天有新提交，`main` 始终能 ff，不会出现分叉
- 自有功能只活在 `dev/blunt`，不会污染 `main`
- 构建必须基于 `dev/blunt`；在 `main` 上构建会丢掉 fork 功能

## 执行

```bash
bash update-pi.sh
```

脚本位于本 skill 目录，用相对路径调用。它会一步做完：快进 `main` → 把 `main` 并入当前
检出的 `dev/blunt` → `npm ci`（必要时）→ 生成 model data → 构建 → 安装 → push
`origin` 的 `main` 和 `dev/blunt`。

工作树脏（包括其他 session 的未提交改动）时脚本会在合并前停下，这是有意设计。

## 脚本参数

| 参数 | 说明 |
|---|---|
| `--no-pull` | 跳过 git 同步（不快进 main、不合并），用当前工作树构建 |
| `--skip-build` | 跳过构建，用已有产物安装 |
| `--platform <plat>` | 目标平台（默认 `linux-x64`；支持 `darwin-arm64`/`darwin-x64`/`linux-arm64`/`windows-x64`/`windows-arm64`） |
| `--out <dir>` | 构建输出目录（默认 `/tmp/pi-build-<timestamp>`） |
| `--registry <url>` | npm registry（默认 `https://registry.npmjs.org`） |
| `--no-proxy` | 构建阶段不设 `NODE_USE_ENV_PROXY=1`，强制直连（默认走代理；当前网络下直连不通） |
| `--help` | 显示帮助 |

## 安装位置

- 二进制 + 资源：`~/.local/share/pi/`
- Wrapper：`~/.local/bin/pi`

## 验证

版本号只能证明安装动作完成，不能证明二进制可用。完整验证：

```bash
pi --version          # 版本号已更新
pi --list-models      # 退出码 0、列出全部 provider 且无 error —— 证明 model data 已正确生成
pi -p "Say exactly: ok"   # 返回 ok —— 证明真实推理链路可用
```

`--list-models` 是最关键的一项：`packages/ai/src/providers/data/` 是生成产物，数据陈旧时
版本号看着正常、实际模型目录是错的。

## 故障排查

脚本已内置下列大部分条目的处理逻辑，此处记录症状与原理，便于判断是否命中已知问题。

### npm 静默挂起（无输出、几乎不耗 CPU）

症状：`npm ci` / `npm install` 挂住数分钟，日志停在 `npm warn deprecated ...` 不再前进，
`ps` 显示进程处于 `do_epoll_wait`、CPU 时间只有几秒。

原因：项目 `.npmrc` 的 `min-release-age=2`（供应链年龄门禁）阻塞近期发布的依赖版本。
脚本已设 `npm_config_min_release_age=0` 绕过。

判别要点：这是**门禁**不是网络慢 —— 网络慢会有持续的下载进度输出，门禁是完全静默。

### npm ci 报 FETCH_ERROR

症状：大批 tarball `attempt 1 failed with FETCH_ERROR`，且失败的都是较新版本的包；
元数据请求却返回 200。

原因：`.npmrc` 指向本地镜像时，npm 会把 `package-lock.json` 里 `registry.npmjs.org` 的
主机名重写为镜像地址，而镜像对这些新版本 tarball 回源失败（挂住不响应）。
脚本已用 `npm_config_registry` 直连 `registry.npmjs.org`（与 lockfile 的 `resolved`、
`integrity` 天然一致，不会改写 lockfile）。

### tsgo: not found → tsc 重命名

症状：`sh: 1: tsgo: not found`，或 tsgo 跑起来后报一堆看似源码问题的类型错误。

原因：上游已从 `@typescript/native-preview`（bin 名 `tsgo`）切换到 `typescript@7`（bin 只有
`tsc`），脚本的 node_modules 检查已改为 `tsc`。若构建中出现该报错，先确认 node_modules 是否
被并发的其他 session 破坏（详见下节）。

### node_modules 损坏伪装成类型错误
症状：构建阶段报 `Cannot find module 'marked-cjk-friendly'` 等模块缺失；或 `tsc` 报
`Cannot find module 'marked'`、`Property 'raw' does not exist on type 'LatexToken'` 等。

原因：`node_modules` 被中断的安装破坏 —— `.bin` 符号链接缺失或悬空（链接在、目标包目录
整个消失），以及大量空包目录。这类损坏会伪装成源码类型错误，极易误判为代码有 bug。
脚本用 `node_modules_ready()` 三项检查（tsc 可执行、marked 已解压、无空包目录）识别，
命中则完整 `npm ci` 重装。

注：`npm rebuild --ignore-scripts` 只能重建 `.bin` 链接（秒级、不碰网络），装不了缺失的包。

### generate-models 必须经代理（NODE_USE_ENV_PROXY=1）

症状：`generate-models` 报 `Failed to fetch models.dev catalog`，cause 为
`AggregateError [ETIMEDOUT]` 或 `ConnectTimeoutError`，无响应头。

原因：node 内置 fetch **不读** `*_PROXY` 环境变量，必须显式 `NODE_USE_ENV_PROXY=1`。
本机实测（2026-11-16，Node v24.22.2）：

```bash
node -e 'fetch("https://models.dev/api.json").then(r=>console.log(r.status),e=>console.log(e.cause?.code))'
# → ETIMEDOUT（真直连，curl --noproxy '*' 同样超时）
NODE_USE_ENV_PROXY=1 node -e 'fetch("https://models.dev/api.json").then(r=>console.log(r.status))'
# → 200
```

脚本已在构建阶段自动 `export NODE_USE_ENV_PROXY=1`；`--no-proxy` 则不设该变量、走直连。

历史：本轮之前 skill 记录的是「Node v24.14.1 上 NODE_USE_ENV_PROXY 不生效、必须直连」——
该结论在 v24.22.2 上已反转（node 从 24.16 起逐步完善了 env proxy 支持）。

定位单个端点的方法：

```bash
NODE_USE_ENV_PROXY=1 node -e 'fetch("https://integrate.api.nvidia.com/v1/models").then(r=>console.log(r.status),e=>console.log(e.cause?.code))'
```

### 构建报 ConnectTimeoutError（代理瞬时超时）

症状：`generate-models` 报 `Failed to fetch OpenRouter models`（或其他源），cause 为
`ConnectTimeoutError: Connect Timeout Error (attempted address: openrouter.ai:443, timeout: 10000ms)`。

注意：报错里的 address 可能是**目标域名**而非代理地址，不要据此判断“没走代理”——
先确认本次运行真的带了 `NODE_USE_ENV_PROXY=1`（上一节）。

generate-models 共 6 个 fetch：models.dev catalog、models.dev decision models、OpenRouter、
Vercel AI Gateway、NVIDIA NIM、Radius（`radius.pi.dev/v1/config`）。

处理：多为代理瞬时抖动，**重跑脚本即可**（2026-11-16 实测：同一命令重跑即过）。

### 合并 main 冲突（应已消失）

fork 的 changelog 条目已从 `packages/coding-agent/CHANGELOG.md` 挤到
`packages/coding-agent/CHANGELOG.fork.md`，因此该文件与 `upstream/main` 完全一致，合上游
typically 不再产生冲突（2026-11-17 演练验证：上游往 `## [Unreleased]` 顶部追加条目可以自动合并）。

**新增 fork 变更时，条目写 `CHANGELOG.fork.md`，不要动 `CHANGELOG.md`。** 一旦动了后者，
冲突会立刻回来。

如果合并仍然报 `CONFLICT (content)`：

1. 看冲突文件是不是 `CHANGELOG.md`——是的话，直接取上游版本（`git checkout --theirs -- <文件>`），
   再把 fork 条目补回 `CHANGELOG.fork.md`
2. 其他文件冲突按业务判断解决（不要去 `git stash` / `reset --hard`，见仓库 AGENTS.md）
3. 解完 `git add <文件> && git commit --no-edit`，再重跑脚本

工作树脏时脚本会直接停下（合并会扫描整棵树，其他 session 的已跟踪文件改动会阻塞它；
未跟踪文件不算脏），这是有意的：不要动别人的文件，等其干净后重跑。

### 只需升级二进制、不动仓库代码

直接基于当前工作树构建（不拉不合并）：

```bash
bash update-pi.sh --no-pull
```

它会用当前分支的代码构建并安装。注意：当前分支若是 `main`（纯上游镜像），装出来的二进制
**没有 fork 功能**——用 `rg -c <功能关键字> ~/.local/share/pi/pi` 可验证。


### 切勿使用 --offline-model-data

`packages/ai/src/providers/data/` 被 `.gitignore` 忽略（见仓库 `.gitignore` 第 11 行），是
`generate-models` 的产物。`git pull` 只更新代码、不更新这些数据，沿用旧数据配新代码会在
`packages/ai` 报出误导性的类型错误，例如：

- `xai.ts`：数据里混有 `openai-completions` 模型，但 `xaiProvider()` 声明返回
  `Provider<"openai-responses">` → TS2322
- `openrouter.ts`：数据里模型全是 `openai-completions`，代码却提供了 `anthropic-messages`
  的 api 映射 → TS2353

这类错误的表象是「泛型推断不符」，真因是数据陈旧。必须在线刷新 model data。

### bun/Node 未安装

脚本会预检查并提示安装。

### 其他 session 在跑 npm

并发的其他 session 可能正在同一工作树跑 npm，会删改 `node_modules`。若构建中途报
`tsgo: not found`（或 tsc 报大量模块缺失）而此前明明验证过可用，优先怀疑这种情况，
重跑脚本即可。多 session 共存时只动自己改过的文件，禁止 `git stash` / `git add -A` /
`git reset --hard`（见项目 AGENTS.md）。

