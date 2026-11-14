#!/usr/bin/env bash
# 文件作用：sync-mcp-upstream Shell 脚本
# 作者：JasonLee <shuiyuntian@foxmail.com>
# 创建日期：2026-07-22
# 版本：1.0.3
# 修改记录：
#   - 1.0.3 (2026-11-10) CI 环境不再自动使用本机代理
#   - 1.0.2 (2026-11-10) 同步与 pristine 校验保留本地 UPSTREAM.md 治理说明
#   - 1.0.1 (2026-10-03) vendor 目录随包迁移：DEST/pin/注释路径 platform/cesium-mcp/mcp 改指 extensions/system/business/ai-assistant-mcp/vendor/cesium-mcp
#   - 1.0.0 (2026-07-22) 初始创建
#
# 版权所有 (C) 2026 AGRSEarth 项目

# sync-mcp-upstream.sh — 将 CesiumGS/cesium-ai-integrations 的 mcp/ 子树 pristine 同步到 extensions/system/business/ai-assistant-mcp/vendor/cesium-mcp/
#
# 用法:
#   scripts/tools/sync-mcp-upstream.sh [commit-sha]
#   不传 sha 时取上游 main 最新 commit。
#
# 行为:
#   1. 下载 https://github.com/CesiumGS/cesium-ai-integrations/archive/<sha>.tar.gz
#   2. 将其 mcp/ 子树整体同步到 extensions/system/business/ai-assistant-mcp/vendor/cesium-mcp/（--delete，pristine 零修改红线）
#   3. 复制上游 LICENSE 为 extensions/system/business/ai-assistant-mcp/vendor/cesium-mcp/LICENSE
#   4. 写 pin 文件 extensions/system/business/ai-assistant-mcp/vendor/cesium-mcp/.upstream（repo / sha / 日期）
#   5. 校验：vendor 目录与上游 tarball 零 diff（CI 可复跑本脚本加 --check 只校验不写入）
#
# 幂等，可重复执行。本地代理默认 http://127.0.0.1:7890，可用 HTTPS_PROXY 覆盖；CI 不自动设置代理。
set -euo pipefail

REPO="CesiumGS/cesium-ai-integrations"
REPO_URL="https://github.com/${REPO}"
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DEST="${REPO_ROOT}/vendor/cesium-mcp"
PIN_FILE="${DEST}/.upstream"

if [[ -z "${CI:-}" ]]; then
  export HTTPS_PROXY="${HTTPS_PROXY:-http://127.0.0.1:7890}"
  export HTTP_PROXY="${HTTP_PROXY:-${HTTPS_PROXY}}"
fi

MODE="sync"
SHA=""
for arg in "$@"; do
  case "${arg}" in
    --check) MODE="check" ;;
    *) SHA="${arg}" ;;
  esac
done

if [[ "${MODE}" == "check" ]]; then
  [[ -f "${PIN_FILE}" ]] || { echo "!!  未找到 pin 文件 ${PIN_FILE}" >&2; exit 1; }
  SHA="$(grep '^commit: ' "${PIN_FILE}" | awk '{print $2}')"
  echo ">> check 模式，pin commit: ${SHA}"
elif [[ -z "${SHA}" ]]; then
  echo ">> 查询上游 main 最新 commit ..."
  SHA="$(curl -fsSL "https://api.github.com/repos/${REPO}/commits/main" | python3 -c 'import json,sys; print(json.load(sys.stdin)["sha"])')"
fi
echo ">> upstream commit: ${SHA}"

TMP="$(mktemp -d)"
trap 'rm -rf "${TMP}"' EXIT

echo ">> 下载 tarball ..."
curl -fsSL "${REPO_URL}/archive/${SHA}.tar.gz" -o "${TMP}/src.tar.gz"
tar -xzf "${TMP}/src.tar.gz" -C "${TMP}"
SRC="${TMP}/cesium-ai-integrations-${SHA}/mcp"
[[ -d "${SRC}" ]] || { echo "!!  tarball 中未找到 mcp/ 目录" >&2; exit 1; }

if [[ "${MODE}" == "check" ]]; then
  # 校验 vendor 与上游零 diff（忽略 pin、治理说明与 node_modules 等本地产物；
  # pnpm-workspace.yaml 为 pnpm 11 install 副产物，.DS_Store 为 macOS 副产物）
  DIFF_EXCLUDES=(--exclude=.upstream --exclude=UPSTREAM.md --exclude=LICENSE --exclude=node_modules --exclude=dist --exclude=build --exclude=pnpm-workspace.yaml --exclude=.DS_Store)
  if diff -r "${DIFF_EXCLUDES[@]}" "${SRC}" "${DEST}" >/dev/null 2>&1; then
    echo ">> pristine 校验通过：extensions/system/business/ai-assistant-mcp/vendor/cesium-mcp 与上游 ${SHA} 零 diff"
  else
    echo "!!  pristine 校验失败：vendor 与上游存在差异，请重跑 sync 恢复" >&2
    diff -rq "${DIFF_EXCLUDES[@]}" "${SRC}" "${DEST}" | head -20 >&2
    exit 1
  fi
  exit 0
fi

mkdir -p "${DEST}"
echo ">> 同步 mcp/ 到 ${DEST}（pristine 覆盖）..."
rsync -a --delete --exclude=node_modules --exclude=UPSTREAM.md "${SRC}/" "${DEST}/"
cp "${TMP}/cesium-ai-integrations-${SHA}/LICENSE" "${DEST}/LICENSE"

cat > "${PIN_FILE}" <<EOF
repo: ${REPO_URL}
subtree: mcp/
commit: ${SHA}
synced_at: $(date '+%Y-%m-%d %H:%M:%S %z')
EOF

echo ">> 完成：mcp/ 已 pristine 同步（commit ${SHA:0:7}），pin 见 ${PIN_FILE}"
echo ">> 校验命令：scripts/tools/sync-mcp-upstream.sh --check"
