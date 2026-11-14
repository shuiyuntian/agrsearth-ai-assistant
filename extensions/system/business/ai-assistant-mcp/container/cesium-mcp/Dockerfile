# ============================================================================
# cesium-mcp 单镜像（S3 平台化定案形态）
#
#   单容器双进程（tini PID 1，-g 信号广播进程组）：
#     ① MCP gateway（vendor pristine cesium-js workspace）：
#          PORT=3010 COMMUNICATION_PROTOCOL=sse MCP_TRANSPORT=streamable-http
#          → :3010 SSE 命令通道（/mcp/events、/mcp/result、/mcp/health）
#          → :4010 MCP streamable-http（= 通信端口 + 1000，有状态单 session）
#     ② geolocation-http 桥（本仓自有，复用 vendor geolocation-server build 产物）：
#          PORT=3008 → :3008/mcp（多 session）+ :3008/health
#
#   GIS 服务地址（NOMINATIM/OSRM/OVERPASS_SERVER_URL）走镜像 ENV 默认值，
#   k8s configmap 可覆盖；PORT 两进程各占固定值，只在 CMD 内按进程注入，
#   刻意不设全局 ENV（两进程共读 PORT 会冲突）。
#
# 构建规范：docs/运维手册/2-部署与变更/CONTAINER_IMAGE_SPEC.md
# 构建上下文：【仓库根目录】（仅需 extensions/system/business/ai-assistant-mcp；
#   上下文裁剪规则见本目录 Dockerfile.dockerignore，由 BuildKit 自动加载）
#
#   docker buildx build -f extensions/system/business/ai-assistant-mcp/container/cesium-mcp/Dockerfile \
#     --platform linux/arm64,linux/amd64 --push \
#     -t localhost:32000/agrs-cesiumai/cesium-mcp:<version> .
#
# 日常构建请使用同目录 build.sh（自动注入 OCI Label build-arg + 版本护栏）。
# ============================================================================

# ---------- stage 1: build ----------
FROM node:22-bookworm-slim AS build

# corepack：cesium-js 依 packageManager 字段自动用 pnpm@9.15.5；
# geolocation-server 无 packageManager 字段，显式 activate pnpm@11.8.0 作为兜底默认
# （对齐 Mac 开发侧版本与 lockfile；COREPACK_ENABLE_AUTO_PIN=0 防止回写 vendor package.json）
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0 \
    COREPACK_ENABLE_AUTO_PIN=0
RUN corepack enable && corepack prepare pnpm@11.8.0 --activate

WORKDIR /app

# --- MCP gateway workspace（vendor pristine CesiumGS，源码零修改） ---
# 全量安装（含 devDeps，供 tsc 编译）→ 只编译 gateway 运行所需子树
# （shared + 各域 server + gateway；--filter '<pkg>...' 含其 workspace 依赖，
#   跳过 test-applications/web-app 的 esbuild 打包）→ 裁回生产依赖
COPY extensions/system/business/ai-assistant-mcp/vendor/cesium-mcp/cesium-js vendor/cesium-mcp/cesium-js
RUN cd vendor/cesium-mcp/cesium-js \
    && pnpm install --frozen-lockfile \
    && pnpm --filter '@cesium-mcp/gateway...' build \
    && rm -rf node_modules servers/*/node_modules test-applications/node_modules \
        test-applications/*/node_modules \
    && pnpm install --prod --frozen-lockfile \
    && pnpm store prune

# --- geolocation-server（独立 lockfile；绕开 pnpm run 直接调 tsc） ---
# pnpm 11 默认 strictDepBuilds=true，devDep 链（tsx→esbuild）的 postinstall 被拦截会让
# install 硬失败（ERR_PNPM_IGNORED_BUILDS）；镜像内只用 tsc 编译、不运行 tsx/esbuild，
# 故两处 install 均带 --config.strict-dep-builds=false（跳过而非放行，不碰 vendor 树）
COPY extensions/system/business/ai-assistant-mcp/vendor/cesium-mcp/geolocation-server vendor/cesium-mcp/geolocation-server
RUN cd vendor/cesium-mcp/geolocation-server \
    && pnpm install --frozen-lockfile --config.strict-dep-builds=false \
    && ./node_modules/.bin/tsc \
    && rm -rf node_modules \
    && pnpm install --prod --frozen-lockfile --config.strict-dep-builds=false \
    && pnpm store prune

# --- geolocation-http 桥自身依赖（undici，仅代理/改写支持用途；运行 node server.mjs） ---
COPY extensions/system/business/ai-assistant-mcp/backend/geolocation-http backend/geolocation-http
RUN cd backend/geolocation-http \
    && pnpm install --prod --frozen-lockfile \
    && pnpm store prune

# ---------- stage 2: runtime ----------
FROM node:22-bookworm-slim

ARG SERVICE_NAME=cesium-mcp
ARG SERVICE_VERSION=1.0.0
ARG SERVICE_SOURCE=extensions/system/business/ai-assistant-mcp
ARG SERVICE_CATEGORY=platform
ARG BASE_IMAGE=node:22-bookworm-slim
ARG DOCKERFILE_BASE64
ARG CREATED
ARG BUILD_COMMAND

# tini：PID 1 信号转发（-g 广播进程组）/僵尸回收；curl：HEALTHCHECK 用；
# pnpm@9.15.5：gateway 以 `pnpm --filter @cesium-mcp/gateway start` 启动，
# 版本对齐 cesium-js workspace 的 packageManager 字段（不走 corepack 避免运行时联网下载）
RUN apt-get update \
    && apt-get install -y --no-install-recommends tini curl \
    && rm -rf /var/lib/apt/lists/* \
    && npm install -g pnpm@9.15.5

WORKDIR /app

COPY --from=build /app/vendor/cesium-mcp/cesium-js vendor/cesium-mcp/cesium-js
COPY --from=build /app/vendor/cesium-mcp/geolocation-server vendor/cesium-mcp/geolocation-server
COPY --from=build /app/backend/geolocation-http backend/geolocation-http

# 运行期默认环境（k8s configmap 可覆盖）。geolocation 三件套默认使用集群 Service DNS；
# NOMINATIM_SERVER_URL 经 geolocation-http 的 fetch 改写接管 vendor 硬编码公网地址。
# 注意：刻意不设 PORT——gateway(3010) 与 bridge(3008) 的端口在 CMD 内按进程注入。
ENV NODE_ENV=production \
    NOMINATIM_SERVER_URL=http://nominatim:8080 \
    OSRM_SERVER_URL=http://osrm:5000 \
    OVERPASS_SERVER_URL=http://overpass/api/interpreter \
    OSM_USER_AGENT=AGRSEarth/1.0

EXPOSE 3008 3010 4010

HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=5 \
  CMD curl -f http://localhost:3010/mcp/health || exit 1

# OCI 标准 Label + AGRSEarth 自定义 Label（CONTAINER_IMAGE_SPEC §4，resource-manager 展示用）
LABEL org.opencontainers.image.title="${SERVICE_NAME}"
LABEL org.opencontainers.image.description="Cesium MCP 服务单镜像（gateway SSE:3010 + streamable-http:4010 + geolocation 桥:3008，45 工具面）"
LABEL org.opencontainers.image.version="${SERVICE_VERSION}"
LABEL org.opencontainers.image.source="${SERVICE_SOURCE}"
LABEL org.opencontainers.image.base.name="${BASE_IMAGE}"
LABEL org.opencontainers.image.created="${CREATED}"
LABEL org.opencontainers.image.authors="AGRSEarth Dev"
LABEL org.opencontainers.image.build.command="${BUILD_COMMAND}"
LABEL org.opencontainers.image.dockerfile.base64="${DOCKERFILE_BASE64}"
LABEL com.agrsearth.service.category="${SERVICE_CATEGORY}"
LABEL com.agrsearth.service.id="${SERVICE_NAME}"

# tini -g：SIGTERM 广播整个进程组（bridge 优雅退出 + gateway 默认终止）；
# gateway 为主进程（exec 替换 sh），其退出即容器退出；bridge 后台常驻。
CMD ["tini", "-g", "--", "sh", "-c", \
     "env PORT=3008 node backend/geolocation-http/server.mjs & \
      cd vendor/cesium-mcp/cesium-js && \
      exec env PORT=3010 COMMUNICATION_PROTOCOL=sse MCP_TRANSPORT=streamable-http \
        pnpm --filter @cesium-mcp/gateway start"]
