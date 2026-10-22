# 文件作用：__SVC_ID__ 微服务镜像 Dockerfile（扩展包后端骨架模板）
# 作者：JasonLee <shuiyuntian@foxmail.com>
# 创建日期：2026-10-04
# 版本：1.0.1
# 修改记录：
#   - 1.0.0 (2026-10-04) 初始创建
#   - 1.0.1 (2026-10-06) 去内部文档指针；SERVICE_SOURCE 默认改包内相对路径（两种仓布局通用）
#
# 版权所有 (C) 2026 CesiumAI 项目

# OCI Label 注入为强制项（规范文档由平台方提供，提测/验收时核对），勿删 LABEL 段
# 占位符 __SVC_ID__/__SVC_PORT__/__PKG_ID__/__PKG_NAME__/__TRACK__/__TIER__
# 由脚手架实例化时替换（模板仓 tools/create-extension.sh；平台仓 scripts/create-extension.sh；
# 手工实例化见 backend/svc-placeholder/README.md 占位符表）

FROM eclipse-temurin:17-jre

ARG SERVICE_NAME=__SVC_ID__
ARG SERVICE_VERSION=0.1.0
ARG SERVICE_SOURCE=backend/__SVC_ID__
ARG SERVICE_CATEGORY=extension
ARG BASE_IMAGE=eclipse-temurin:17-jre
ARG BUILD_COMMAND="docker build -t localhost:32000/gis-platform/__TRACK__/__TIER__/__PKG_ID__/__SVC_ID__:0.1.0 ."
ARG DOCKERFILE_BASE64=""
ARG CREATED=""

WORKDIR /app

# 复制构建产物（build.sh 已从 backend/__SVC_ID__/target 拷入本目录）
COPY __SVC_ID__-*.jar app.jar

# 服务端口（与 backend/__SVC_ID__/src/main/resources/bootstrap.yml 的 server.port 一致）
EXPOSE __SVC_PORT__

# JVM 参数可在运行时被覆盖
ENV JAVA_OPTS="-Xms512m -Xmx1024m -Djava.security.egd=file:/dev/./urandom"

# OCI 标准 Label + CesiumAI 自定义 Label（规范强制注入点；值由 build.sh 经 --build-arg 覆盖）
LABEL org.opencontainers.image.title="${SERVICE_NAME}"
LABEL org.opencontainers.image.description="__PKG_NAME__ 后端微服务"
LABEL org.opencontainers.image.version="${SERVICE_VERSION}"
LABEL org.opencontainers.image.source="${SERVICE_SOURCE}"
LABEL org.opencontainers.image.base.name="${BASE_IMAGE}"
LABEL org.opencontainers.image.created="${CREATED}"
LABEL org.opencontainers.image.authors="CesiumAI Dev"
LABEL org.opencontainers.image.build.command="${BUILD_COMMAND}"
LABEL org.opencontainers.image.dockerfile.base64="${DOCKERFILE_BASE64}"
LABEL com.cesiumai.service.category="${SERVICE_CATEGORY}"
LABEL com.cesiumai.service.id="${SERVICE_NAME}"

ENTRYPOINT ["sh", "-c", "java $JAVA_OPTS -jar app.jar"]
