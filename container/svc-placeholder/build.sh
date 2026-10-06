#!/bin/bash
# 文件作用：__SVC_ID__ 微服务镜像构建脚本（编译 + OCI Label 注入 + buildx 推送）
# 作者：JasonLee <shuiyuntian@foxmail.com>
# 创建日期：2026-10-04
# 版本：1.0.1
# 修改记录：
#   - 1.0.0 (2026-10-04) 初始创建
#   - 1.0.1 (2026-10-06) 去内部文档指针；SERVICE_SOURCE 改包内相对路径（两种仓布局通用）
#
# 版权所有 (C) 2026 CesiumAI 项目

# 构建规范：OCI Label 注入为强制项（含 Dockerfile base64、基础镜像、构建命令），
# 完整规范文档由平台方提供（提测/验收时核对）。
# 占位符 __SVC_ID__/__PKG_ID__/__TRACK__/__TIER__ 由脚手架实例化时替换
# （模板仓 tools/create-extension.sh；平台仓 scripts/create-extension.sh）。
set -e

SERVICE_NAME="__SVC_ID__"
# 版本取自同目录 VERSION 文件（组件版本轴：改哪个组件 bump 哪个）
SERVICE_VERSION="$(cat VERSION | tr -d '[:space:]')"
# 源码位置按包内相对路径记录（两种仓布局一致：<pkg>/backend/<svc>）
SERVICE_SOURCE="backend/${SERVICE_NAME}"
SERVICE_CATEGORY="extension"
BASE_IMAGE="eclipse-temurin:17-jre"
REGISTRY="localhost:32000"
# 镜像命名空间与仓内目录同构（AGENTS.md §8）：gis-platform/<track>/<tier>/<pkg>/<svc>
NAMESPACE="gis-platform/__TRACK__/__TIER__/__PKG_ID__"
IMAGE_TAG="${REGISTRY}/${NAMESPACE}/${SERVICE_NAME}:${SERVICE_VERSION}"
BACKEND_DIR="../../backend/${SERVICE_NAME}"

if [ "${SKIP_COMPILE}" != "1" ]; then
  echo "[build] 编译 ${SERVICE_NAME} ..."
  cd "${BACKEND_DIR}"
  mvn clean package -DskipTests
  cd -

fi

# 两种模式都要拷产物（编译模式=新构建，SKIP_COMPILE=1=已有产物）；缺 jar 立即失败防推空镜像
compgen -G "${BACKEND_DIR}/target/${SERVICE_NAME}-*.jar" > /dev/null || { echo "[build] 错误：${BACKEND_DIR}/target 下未找到 ${SERVICE_NAME}-*.jar"; exit 1; }
cp "${BACKEND_DIR}"/target/${SERVICE_NAME}-*.jar ./

if base64 --help 2>&1 | grep -q -- '-w'; then
  DOCKERFILE_BASE64=$(base64 -w 0 Dockerfile)
else
  DOCKERFILE_BASE64=$(base64 -i Dockerfile | tr -d '\r\n')
fi

PLATFORMS="${PLATFORMS:-linux/arm64,linux/amd64}"
BUILDER="${BUILDER:-multiarch}"

echo "[build] 使用 buildx 构建并推送（平台: ${PLATFORMS}, builder: ${BUILDER}）..."
docker buildx build \
  --builder "${BUILDER}" \
  --platform "${PLATFORMS}" \
  --push \
  --build-arg SERVICE_NAME="${SERVICE_NAME}" \
  --build-arg SERVICE_VERSION="${SERVICE_VERSION}" \
  --build-arg SERVICE_SOURCE="${SERVICE_SOURCE}" \
  --build-arg SERVICE_CATEGORY="${SERVICE_CATEGORY}" \
  --build-arg BASE_IMAGE="${BASE_IMAGE}" \
  --build-arg DOCKERFILE_BASE64="${DOCKERFILE_BASE64}" \
  --build-arg CREATED="$(date -u +"%Y-%m-%dT%H:%M:%SZ")" \
  --build-arg BUILD_COMMAND="docker buildx build --platform ${PLATFORMS} --push -t ${IMAGE_TAG} ." \
  -t "${IMAGE_TAG}" \
  .

echo "[build] 完成: ${IMAGE_TAG}"
