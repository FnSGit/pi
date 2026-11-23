#!/usr/bin/env bash
# 更新 pi：从 git 拉最新代码 → 构建二进制 → 安装到 ~/.local/share/pi + ~/.local/bin/pi wrapper
# 使用方法：
#   ./update-pi.sh [--no-pull] [--skip-build] [--platform <plat>] [--help]

set -euo pipefail

# 网络策略分两阶段（见「构建二进制」块）：
#   阶段 1 npm ci        —— npm 的 HTTP 客户端读 *_PROXY 环境变量（本机已全局设置）
#   阶段 2 generate-models —— node 内置 fetch 默认仍不走代理，必须显式 NODE_USE_ENV_PROXY=1
#                             （node v24.22.2 实测生效：带它 200，不带直连超时）
#  历史：2026-11-03 曾记录「直连全通」；2026-11-16 复测直连已不通，故一律走代理。

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../../../" && pwd)"
INSTALL_DIR="$HOME/.local/share/pi"
WRAPPER_PATH="$HOME/.local/bin/pi"

NO_PULL=false
SKIP_BUILD=false
PLATFORM="linux-x64"
OUT_DIR="/tmp/pi-build-$(date +%s)"
# package-lock.json 的 resolved 字段全部指向 registry.npmjs.org，用同一源可保证
# integrity 校验一致，并避免 npm 把主机名重写为本地镜像（本地镜像常对新版本
# tarball 回源失败，表现为 FETCH_ERROR）。
NPM_REGISTRY="https://registry.npmjs.org"
KEEP_PROXY=true

function print_usage() {
	cat <<EOH
使用: update-pi.sh [选项]

更新 pi 二进制：拉取最新 git 代码 → 构建 → 安装到用户级全局

选项:
  --no-pull          跳过 git pull（用当前工作树代码）
  --skip-build       跳过构建（假设已有构建产物在 --out <dir>）
  --platform <plat> 目标平台（默认 linux-x64；支持 darwin-arm64/darwin-x64/linux-arm64/windows-x64/windows-arm64）
  --out <dir>        构建输出目录（默认 /tmp/pi-build-<timestamp>）
  --registry <url>   npm registry（默认 https://registry.npmjs.org）
  --no-proxy         构建阶段不走代理、强制直连（默认走代理，见脚本内注释）
  --help             显示此帮助
EOH
}

function check_tools() {
	echo "=== 检查工具链 ==="
	local missing=false
	for tool in node npm bun git; do
		if ! command -v "$tool" &>/dev/null; then
			echo "❌ $tool 未安装"
			missing=true
		else
			echo "✅ $tool: $("$tool" --version 2>&1 | head -1)"
		fi
	done
	if [ "$missing" = true ]; then
		echo
		echo "请先安装缺失的工具再重试。"
		exit 1
	fi
}

function get_pi_version() {
	if [ -f "$INSTALL_DIR/pi" ]; then
		"$INSTALL_DIR/pi" --version 2>&1 || true
	fi
}

# 判断 node_modules 是否可直接复用。三项检查各对应一种真实故障：
#   1. tsgo 可执行 —— 既验证 .bin 符号链接存在，也验证其目标包已解压
#      （曾出现符号链接在、@typescript/native-preview 整个目录却缺失的悬空状态）
#   2. marked 已解压 —— 被中断的安装会留下空包目录，导致 tsgo 报
#      "Cannot find module 'marked'" 等误导性类型错误
#   3. 无空目录残留 —— 空包目录是安装被中断的直接信号
#   4. 依赖树与 lockfile 同步 —— 上游合并常升级依赖（如 openai 7.19→7.59），lock 更新而
#      node_modules 未重装，会带旧依赖进构建并报误导性类型错误（见「依赖版本漂移」一节）
function node_modules_ready() {
	node_modules/.bin/tsc --version >/dev/null 2>&1 || return 1
	[ -f node_modules/marked/package.json ] || return 1
	[ -z "$(find node_modules -maxdepth 2 -type d -empty -print -quit 2>/dev/null)" ] || return 1
	[ node_modules/.package-lock.json -nt package-lock.json ] || return 1
	return 0
}

while [[ $# -gt 0 ]]; do
	case "$1" in
		--no-pull)
			NO_PULL=true
			shift
			;;
		--skip-build)
			SKIP_BUILD=true
			shift
			;;
		--platform)
			PLATFORM="$2"
			shift 2
			;;
		--out)
			OUT_DIR="$2"
			shift 2
			;;
		--registry)
			NPM_REGISTRY="$2"
			shift 2
			;;
		--keep-proxy)
			# 旧参数名，保留兼容
			KEEP_PROXY=true
			shift
			;;
		--no-proxy)
			KEEP_PROXY=false
			shift
			;;
		--help)
			print_usage
			exit 0
			;;
		*)
			echo "未知选项: $1"
			print_usage
			exit 1
			;;
	esac
done

echo "============================================"
echo "           pi 自动更新流程"
echo "============================================"
echo "仓库: $REPO_ROOT"
echo "平台: $PLATFORM"
echo "安装目录: $INSTALL_DIR"
echo "wrapper: $WRAPPER_PATH"
echo "构建输出: $OUT_DIR"
echo "npm registry: $NPM_REGISTRY"
echo "构建阶段代理: $([ "$KEEP_PROXY" = true ] && echo '保留' || echo '清空（直连）')"  # 默认保留
echo "============================================"

check_tools

OLD_VERSION="$(get_pi_version)"
if [ -n "$OLD_VERSION" ]; then
	echo "当前安装版本: $OLD_VERSION"
else
	echo "当前未安装 pi"
fi

# 分支模型（见 SKILL.md「分支模型」）：
#   main      —— 上游镜像，与 upstream/main 永远一致，只允许 ff
#   dev/blunt —— fork 自有功能，构建来源
BASE_BRANCH="main"
BUILD_BRANCH="dev/blunt"

if [ "$NO_PULL" = false ]; then
	echo
	echo "=== 同步上游 ==="
	cd "$REPO_ROOT"
	if git remote | grep -q '^upstream$'; then
		UPSTREAM_REMOTE="upstream"
	elif git remote | grep -q '^origin$'; then
		UPSTREAM_REMOTE="origin"
	else
		echo "❌ 未配置 upstream/origin remote，无法同步"
		exit 1
	fi
	git fetch "$UPSTREAM_REMOTE" 2>&1 | tail -3

	CURRENT_BRANCH="$(git rev-parse --abbrev-ref HEAD)"
	# 同步 main 到上游最新：main 不在检出时用 fetch 快进 ref，不切工作树，也不碰其他
	# session 的改动；不能 ff 时直接失败，这正是「main 只做镜像」的保证。
	if [ "$CURRENT_BRANCH" = "$BASE_BRANCH" ]; then
		git merge --ff-only "$UPSTREAM_REMOTE/$BASE_BRANCH" 2>&1 | tail -3
	else
		git fetch "$UPSTREAM_REMOTE" "$BASE_BRANCH:$BASE_BRANCH" 2>&1 | tail -3
	fi
	echo "上游基线: $BASE_BRANCH = $(git rev-parse --short "$BASE_BRANCH")"

	# 构建分支接上上游基线
	if [ "$CURRENT_BRANCH" = "$BUILD_BRANCH" ]; then
		# 合并会扫描整个工作树，已跟踪文件的改动（含其他 session 的）会让它失败，宁可先停；
		# 未跟踪文件不阻塞合并，不算脏
		if [ -n "$(git status --porcelain --untracked-files=no)" ]; then
			echo "❌ 工作树有未提交改动，无法合并 $BASE_BRANCH（多 session 共存时不要动别人的文件）"
			echo "   先提交或清理后重跑；只想用当前代码构建可加 --no-pull"
			exit 1
		fi
		if ! MERGE_OUT="$(git merge --no-edit "$BASE_BRANCH" 2>&1)"; then
			echo "$MERGE_OUT" | tail -20
			echo "❌ 合并 $BASE_BRANCH 失败（多为 CHANGELOG 冲突）。解决冲突并提交后重跑 --no-pull。"
			exit 1
		fi
		echo "$MERGE_OUT" | tail -3
	else
		echo "⚠️  当前分支是 $CURRENT_BRANCH 而非 $BUILD_BRANCH，跳过合并，构建将用当前分支代码"
	fi
else
	echo
	echo "== [跳过] git 同步"
fi

if [ "$SKIP_BUILD" = false ]; then
	echo
	echo "=== 构建二进制 ==="
	cd "$REPO_ROOT"

	# --- 阶段 1：依赖安装（走代理）---
	# 两个必需的环境设定：
	#   npm_config_min_release_age=0
	#     项目 .npmrc 设了 min-release-age=2（供应链年龄门禁）。它会阻塞近期发布的
	#     版本，症状是 npm 静默挂起数分钟、几乎不耗 CPU、日志无任何输出，极易误判为
	#     网络慢。本仓库频繁引入新版本依赖，故必须禁用。
	#   npm_config_registry
	#     本地镜像对新版本 tarball 常回源失败（元数据 200、tarball 挂住），npm 报
	#     FETCH_ERROR。lockfile 的 resolved 全部指向 registry.npmjs.org，直连它既能
	#     绕过镜像，又与 integrity 哈希天然一致，且不会改写 lockfile。
	if node_modules_ready; then
		echo "node_modules 完整，跳过 npm ci"
	else
		echo "node_modules 缺失或损坏，执行 npm ci..."
		export npm_config_registry="$NPM_REGISTRY"
		export npm_config_min_release_age=0
		# npm 的 HTTP 客户端读 *_PROXY 环境变量（与 node 内置 fetch 不同，后者不走代理，见下）
		if ! npm ci --ignore-scripts --no-audit --no-fund; then
			echo "❌ npm ci 失败。若长时间无输出后失败，多为 registry 不可达或年龄门禁未禁用。"
			exit 1
		fi
		# 安装完复核一次，避免带着损坏的依赖树进入构建阶段
		if ! node_modules_ready; then
			echo "❌ npm ci 完成但 node_modules 仍不完整（tsc/marked 缺失或存在空包目录）。"
			exit 1
		fi
	fi

	# --- 阶段 2：构建（generate-models 过代理）---
	# generate-models 需访问 6 个端点：models.dev（catalog + decision）、openrouter.ai、
	# ai-gateway.vercel.sh、integrate.api.nvidia.com、radius.pi.dev。node 内置 fetch 不读
	# *_PROXY，需 NODE_USE_ENV_PROXY=1 才走代理（v24.22.2 实测生效）。偶发 connect 超时
	# 仍会出现（代理到 openrouter 撞过一次）→ 重跑脚本即可。
	if [ "$KEEP_PROXY" = true ]; then
		export NODE_USE_ENV_PROXY=1
	else
		unset NODE_USE_ENV_PROXY
	fi
	echo "构建阶段 generate-models: $([ "$KEEP_PROXY" = true ] && echo '过代理（NODE_USE_ENV_PROXY=1）' || echo '直连')"

	# 依赖已由阶段 1 处理，故始终传 --skip-install，避免 build-binaries.sh 内部
	# 再跑一次 npm ci 时使用 .npmrc 里的本地镜像而重新触发 FETCH_ERROR。
	# 注意：不要传 --offline-model-data。packages/ai/src/providers/data/ 被 .gitignore
	# 忽略、属生成产物，git pull 只更新代码不更新数据；沿用旧数据配新代码会在
	# packages/ai 报出误导性的类型错误（如 xai/openrouter 的 Provider<...> 不匹配）。
	rm -rf "$OUT_DIR"
	"$REPO_ROOT/scripts/build-binaries.sh" --skip-install --platform "$PLATFORM" --out "$OUT_DIR"
	echo
	echo "构建完成！产物:"
	if [ "$PLATFORM" = "windows-x64" ] || [ "$PLATFORM" = "windows-arm64" ]; then
		ls -lh "$OUT_DIR/pi-$PLATFORM.zip"
	else
		ls -lh "$OUT_DIR/pi-$PLATFORM.tar.gz"
	fi
else
	echo
	echo "== [跳过] 构建"
	if [ ! -d "$OUT_DIR/$PLATFORM" ]; then
		echo "❌ 没有构建产物: $OUT_DIR/$PLATFORM"
		exit 1
	fi
fi

echo
echo "=== 安装 ==="
rm -rf "$INSTALL_DIR"
mkdir -p "$INSTALL_DIR"

echo "复制二进制+资源到 $INSTALL_DIR..."
cp -r "$OUT_DIR/$PLATFORM/." "$INSTALL_DIR/"

echo "创建 wrapper 脚本 $WRAPPER_PATH..."
cat >"$WRAPPER_PATH" <<EOI
#!/usr/bin/env bash
exec "$INSTALL_DIR/pi" "\$@"
EOI
chmod +x "$WRAPPER_PATH"

if [ ! -f "$INSTALL_DIR/pi" ] && [ "$PLATFORM" = "windows-x64" ] || [ "$PLATFORM" = "windows-arm64" ]; then
	if [ ! -f "$INSTALL_DIR/pi.exe" ]; then
		echo "❌ 二进制未正确安装: $INSTALL_DIR/pi.exe"
		exit 1
	fi
else
	if [ ! -f "$INSTALL_DIR/pi" ]; then
		echo "❌ 二进制未正确安装: $INSTALL_DIR/pi"
		exit 1
	fi
fi

echo
echo "============================================"
echo "           ✅ 更新完成！"
echo "============================================"
echo
if [ -n "$OLD_VERSION" ]; then
	echo "旧版本: $OLD_VERSION"
fi
NEW_VERSION="$("$WRAPPER_PATH" --version 2>&1)"
echo "新版本: $NEW_VERSION"
echo
echo "二进制: $INSTALL_DIR/pi"
echo "wrapper: $WRAPPER_PATH"
if ! echo "$PATH" | tr ':' '\n' | grep -q "^$HOME/.local/bin$"; then
	echo
	echo "⚠️  注意: $HOME/.local/bin 未在 PATH 中。请添加到 PATH 或直接执行 $WRAPPER_PATH"
fi
echo
echo "测试: $WRAPPER_PATH --version"

# fork 工作流：origin/main 是上游镜像，origin/<构建分支> 是自有功能
if [ "$NO_PULL" = false ] && git remote | grep -q '^origin$'; then
	echo
	echo "=== 同步 fork (origin) ==="
	if git push origin "$BASE_BRANCH" 2>&1 | tail -5; then
		echo "✅ origin/$BASE_BRANCH 已对齐上游镜像"
	else
		echo "⚠️  push origin $BASE_BRANCH 失败，请手动检查"
	fi
	if git rev-parse --verify --quiet "$BUILD_BRANCH" >/dev/null; then
		if git push origin "$BUILD_BRANCH" 2>&1 | tail -5; then
			echo "✅ origin/$BUILD_BRANCH 已更新"
		else
			echo "⚠️  push origin $BUILD_BRANCH 失败，请手动检查"
		fi
	fi
fi
