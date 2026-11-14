#!/bin/bash
# 文件作用：build Shell 脚本
# 作者：JasonLee <shuiyuntian@foxmail.com>
# 创建日期：2026-07-23
# 版本：1.1.0
# 修改记录：
#   - 1.1.0 (2026-10-05) 组件更名收口 ai-assistant→ai-assistant-mcp：目录 container/ai-assistant-mcp/、
#                       SERVICE_NAME/IMAGE_TAG 组件段改新名（镜像 .../ai-assistant-mcp/ai-assistant-mcp:<ver>）
#   - 1.0.1 (2026-10-03) 包迁移 extensions/system/business/ai-assistant-mcp：SERVICE_SOURCE/REPO_ROOT 深度/构建命令路径同步
#   - 1.0.0 (2026-07-23) 初始创建
#
# 版权所有 (C) 2026 AGRSEarth 项目

# ai-assistant-mcp 单镜像构建脚本（P4）
# 构建规范见：docs/运维手册/2-部署与变更/CONTAINER_IMAGE_SPEC.md
#
# 环境变量：
#   PLATFORMS    默认 linux/arm64,linux/amd64（多架构同 tag 覆盖推送）；本地快速验证用 linux/arm64
#   BUILDER      默认 multiarch（开发测试环境 多架构 builder，配置见 platform/deploy/buildkitd.toml）
#   PUSH         默认 1（--push 到 registry）；PUSH=0 时 --load 到本地 docker（仅允许单平台）
#   SKIP_COMPILE 本镜像的编译在 Dockerfile 多阶段内完成，无宿主编译步骤，该变量对本镜像不适用
#
# 用法：
#   ./build.sh                                  # 全量：多架构构建并推送 localhost:32000
#   PLATFORMS=linux/arm64 PUSH=0 ./build.sh     # 本机 arm64 快速验证（加载到本地 docker）

set -e

SERVICE_NAME="ai-assistant-mcp"
SERVICE_VERSION="2.1.4"
SERVICE_SOURCE="extensions/system/business/ai-assistant-mcp"
SERVICE_CATEGORY="extension"
BASE_IMAGE="node:22-bookworm-slim"
REGISTRY="localhost:32000"
NAMESPACE="gis-platform/system/business/ai-assistant-mcp"
IMAGE_TAG="${REGISTRY}/${NAMESPACE}/${SERVICE_NAME}:${SERVICE_VERSION}"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PKG_DIR="$(cd "${SCRIPT_DIR}/../.." && pwd)"
# 构建上下文=仓库根目录（Dockerfile 需 COPY .kimi-code/skills 与 extensions/system/business/ai-assistant-mcp/*）：
# SCRIPT_DIR=container/ai-assistant-mcp → PKG_DIR=extensions/system/business/ai-assistant-mcp → 再上四级才是仓库根
REPO_ROOT="$(cd "${PKG_DIR}/../../../.." && pwd)"

# 版本护栏：与扩展包 VERSION 不一致时拒绝构建（check-extension-versions.sh 的前置保障）
PKG_VERSION="$(tr -d '[:space:]' < "${PKG_DIR}/VERSION")"
if [ "${SERVICE_VERSION}" != "${PKG_VERSION}" ]; then
  echo "[build] 错误：SERVICE_VERSION=${SERVICE_VERSION} 与 extensions/system/business/ai-assistant-mcp/VERSION=${PKG_VERSION} 不一致" >&2
  exit 1
fi

if base64 --help 2>&1 | grep -q -- '-w'; then
  DOCKERFILE_BASE64=$(base64 -w 0 "${SCRIPT_DIR}/Dockerfile")
else
  DOCKERFILE_BASE64=$(base64 -i "${SCRIPT_DIR}/Dockerfile" | tr -d '\r\n')
fi

PLATFORMS="${PLATFORMS:-linux/arm64,linux/amd64}"
BUILDER="${BUILDER:-multiarch}"
PUSH="${PUSH:-1}"

if [ "${PUSH}" = "0" ]; then
  case "${PLATFORMS}" in
    *,*)
      echo "[build] 错误：PUSH=0（--load）仅支持单平台，请设 PLATFORMS=linux/arm64 等单一平台" >&2
      exit 1
      ;;
  esac
  OUTPUT_FLAG="--load"
else
  OUTPUT_FLAG="--push"
fi

echo "[build] 构建镜像 ${IMAGE_TAG}（平台: ${PLATFORMS}, builder: ${BUILDER}, 输出: ${OUTPUT_FLAG#--}）..."
cd "${REPO_ROOT}"
docker buildx build \
  --builder "${BUILDER}" \
  --platform "${PLATFORMS}" \
  ${OUTPUT_FLAG} \
  -f "${SCRIPT_DIR}/Dockerfile" \
  --build-arg SERVICE_NAME="${SERVICE_NAME}" \
  --build-arg SERVICE_VERSION="${SERVICE_VERSION}" \
  --build-arg SERVICE_SOURCE="${SERVICE_SOURCE}" \
  --build-arg SERVICE_CATEGORY="${SERVICE_CATEGORY}" \
  --build-arg BASE_IMAGE="${BASE_IMAGE}" \
  --build-arg DOCKERFILE_BASE64="${DOCKERFILE_BASE64}" \
  --build-arg CREATED="$(date -u +"%Y-%m-%dT%H:%M:%SZ")" \
  --build-arg BUILD_COMMAND="docker buildx build -f extensions/system/business/ai-assistant-mcp/container/ai-assistant-mcp/Dockerfile --platform ${PLATFORMS} ${OUTPUT_FLAG} -t ${IMAGE_TAG} ." \
  -t "${IMAGE_TAG}" \
  .

echo "[build] 完成: ${IMAGE_TAG}"
