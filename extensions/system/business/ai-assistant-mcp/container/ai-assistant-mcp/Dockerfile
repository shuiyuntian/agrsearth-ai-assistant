# ============================================================================
# ai-assistant-mcp 单镜像（S3 瘦身形态）
#
#   单容器：tini(PID 1) → ai-orchestrator（主进程，HTTP :9600）
#   MCP 已全部外部化（S1/S2 起 orchestrator 只经 HTTP streamable 连接，不 spawn 子进程）：
#     - MCP gateway + geolocation 桥 → cesium-mcp 镜像/服务（本包 container/cesium-mcp）
#     - 连接地址由 env 注入：MCP_HTTP_URL / GEO_MCP_URL / MCP_SSE_URL / MCP_RESULT_URL
#       （k8s 指向 cesium-mcp Service；本地开发默认 localhost:4010/3008/3010，见 config.ts）
#   镜像内还打包：contracts/tool-contracts.json（工具契约事实源）、
#                /app/skills（codegen 领域技能 cesiumjs-*/SKILL.md）
#
# 构建规范：docs/运维手册/2-部署与变更/CONTAINER_IMAGE_SPEC.md
# 构建上下文：【仓库根目录】（需同时取 extensions/system/business/ai-assistant-mcp 两处源码与 .kimi-code/skills；
#   上下文裁剪规则见本目录 Dockerfile.dockerignore，由 BuildKit 自动加载）
#
#   docker buildx build -f extensions/system/business/ai-assistant-mcp/container/ai-assistant-mcp/Dockerfile \
#     --platform linux/arm64,linux/amd64 --push \
#     -t localhost:32000/gis-platform/system/business/ai-assistant-mcp/ai-assistant-mcp:<version> .
#
# 日常构建请使用同目录 build.sh（自动注入 OCI Label build-arg）。
# ============================================================================

# ---------- stage 1: build ----------
FROM node:22-bookworm-slim AS build

# corepack 按 package.json 的 packageManager 字段自动选用 pnpm 版本
# （ai-orchestrator → pnpm@11.8.0），免确认下载
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0
RUN corepack enable

WORKDIR /app

# --- ai-orchestrator（tsc 产物 build/src/index.js） ---
COPY extensions/system/business/ai-assistant-mcp/backend/ai-orchestrator backend/ai-orchestrator
RUN cd backend/ai-orchestrator \
    && pnpm install --frozen-lockfile \
    && pnpm build \
    && rm -rf node_modules \
    && pnpm install --prod --frozen-lockfile \
    && pnpm store prune

# --- 工具契约 + codegen 领域技能（运行期经 TOOL_CONTRACTS_PATH / CODEGEN_SKILLS_DIR 引用） ---
COPY extensions/system/business/ai-assistant-mcp/contracts contracts
COPY .kimi-code/skills skills

# ---------- stage 2: runtime ----------
FROM node:22-bookworm-slim

ARG SERVICE_NAME=ai-assistant-mcp
ARG SERVICE_VERSION=2.0.0
ARG SERVICE_SOURCE=extensions/system/business/ai-assistant-mcp
ARG SERVICE_CATEGORY=extension
ARG BASE_IMAGE=node:22-bookworm-slim
ARG DOCKERFILE_BASE64
ARG CREATED
ARG BUILD_COMMAND

# tini：PID 1 信号转发/僵尸回收（orchestrator 自带优雅退出：SIGTERM → 关 MCP 客户端）
RUN apt-get update \
    && apt-get install -y --no-install-recommends tini \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY --from=build /app/backend/ai-orchestrator backend/ai-orchestrator
COPY --from=build /app/contracts contracts
COPY --from=build /app/skills skills

# 运行期默认环境（k8s configmap 可覆盖）。三个路径默认值在 tsc 产物中会错位
# （build/ 多一级目录），必须显式指定为绝对路径。
# MCP 连接地址（MCP_HTTP_URL/GEO_MCP_URL/MCP_SSE_URL/MCP_RESULT_URL）刻意不设镜像默认：
# 本地开发取 config.ts 的 localhost 默认，k8s 由 configmap 指向 cesium-mcp Service。
ENV NODE_ENV=production \
    PORT=9600 \
    TOOL_CONTRACTS_PATH=/app/contracts/tool-contracts.json \
    CODEGEN_SKILLS_DIR=/app/skills

EXPOSE 9600

HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=5 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||9600)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

# OCI 标准 Label + AGRSEarth 自定义 Label（CONTAINER_IMAGE_SPEC §4，resource-manager 展示用）
LABEL org.opencontainers.image.title="${SERVICE_NAME}"
LABEL org.opencontainers.image.description="GIS AI 助手（ai-orchestrator 单进程；MCP 经 HTTP 外部化到 cesium-mcp 服务；含工具契约 + codegen 技能）"
LABEL org.opencontainers.image.version="${SERVICE_VERSION}"
LABEL org.opencontainers.image.source="${SERVICE_SOURCE}"
LABEL org.opencontainers.image.base.name="${BASE_IMAGE}"
LABEL org.opencontainers.image.created="${CREATED}"
LABEL org.opencontainers.image.authors="AGRSEarth Dev"
LABEL org.opencontainers.image.build.command="${BUILD_COMMAND}"
LABEL org.opencontainers.image.dockerfile.base64="${DOCKERFILE_BASE64}"
LABEL com.agrsearth.service.category="${SERVICE_CATEGORY}"
LABEL com.agrsearth.service.id="${SERVICE_NAME}"

CMD ["tini", "--", "node", "backend/ai-orchestrator/build/src/index.js"]
