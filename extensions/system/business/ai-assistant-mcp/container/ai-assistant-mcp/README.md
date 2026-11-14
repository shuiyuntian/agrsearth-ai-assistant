# ai-assistant-mcp 单镜像

> 规范：平台仓 `docs/运维手册/2-部署与变更/CONTAINER_IMAGE_SPEC.md`

## 形态（S3 瘦身）

单镜像单容器，MCP 已全部外部化（orchestrator 只经 HTTP streamable 连接，不 spawn 子进程）：

```text
tini (PID 1)
└── node backend/ai-orchestrator/build/src/index.js   # 主进程，HTTP :9600
        │  HTTP streamable
        ├── MCP_HTTP_URL   → cesium-mcp:4010/mcp（gateway，42 工具）
        ├── GEO_MCP_URL    → cesium-mcp:3008/mcp（geolocation 桥，4 工具（extent 仅供内部））
        └── MCP_SSE_URL / MCP_RESULT_URL → cesium-mcp:3010（浏览器命令通道）
```

镜像内容：

| 路径 | 内容 |
|:---|:---|
| `/app/backend/ai-orchestrator` | orchestrator tsc 产物（`build/src/index.js`）+ 生产依赖 |
| `/app/contracts` | 工具契约事实源（`TOOL_CONTRACTS_PATH=/app/contracts/tool-contracts.json`） |
| `/app/skills` | codegen 领域技能 `cesiumjs-*/SKILL.md`（`CODEGEN_SKILLS_DIR=/app/skills`） |

MCP 服务端见 [`../cesium-mcp/`](../cesium-mcp/)（独立镜像/Deployment）。

## 构建

构建上下文为**仓库根目录**（需 `.kimi-code/skills`），裁剪规则在 `Dockerfile.dockerignore`
（BuildKit 按 `<Dockerfile>.dockerignore` 自动加载）。日常构建一律走 `build.sh`：

```bash
cd extensions/system/business/ai-assistant-mcp/container/ai-assistant-mcp

./build.sh                                # 多架构（arm64+amd64）构建并推送 localhost:32000
PLATFORMS=linux/arm64 PUSH=0 ./build.sh   # 本机 arm64 快速验证（--load 到本地 docker）
```

环境变量：`PLATFORMS`（默认 `linux/arm64,linux/amd64`）、`BUILDER`（默认 `multiarch`）、
`PUSH`（默认 `1`；`0`=--load，仅单平台）。`SKIP_COMPILE` 不适用——编译在 Dockerfile 多阶段内完成。

`build.sh` 内置版本护栏：`SERVICE_VERSION` 必须与 `extensions/system/business/ai-assistant-mcp/VERSION` 一致，
改版本先升 VERSION（并由 `scripts/check-extension-versions.sh` 校验五处一致）。

## 冒烟（本地 docker）

orchestrator 启动时会无限重试直到连上 MCP（`MCP_HTTP_URL`/`GEO_MCP_URL`），
所以冒烟前需先起本地 MCP（见包根 README.md 的 cesium-mcp 组件章节）：

```bash
docker run --rm -d --name ai-assistant-mcp-smoke --network host \
  -e AUTH_ENABLED=false \
  -e MYSQL_URL="mysql://root:wrong@127.0.0.1:1/ry_cloud" \
  -e REDIS_URL="redis://127.0.0.1:1" \
  localhost:32000/gis-platform/system/business/ai-assistant-mcp/ai-assistant-mcp:2.1.4

sleep 15
curl -s http://127.0.0.1:9600/health        # 期望 status=ok、tools=45、transport=http
docker logs ai-assistant-mcp-smoke 2>&1 | grep -E "\[mysql\]|\[redis\]|\[mcp\]"   # 降级 warn 可见
docker stop ai-assistant-mcp-smoke
```

预期：MySQL/Redis 不可达只降级（审计回退 console、配置回退 env、会话回退内存），
进程不退；`/health` 200 且 MCP 工具数 45、`mcp.gateway/geolocation.state=up`。

## 部署

k8s 清单：`platform/deploy/environments/prod/开发测试环境/microk8s/ai-assistant-mcp/`
（`kubectl apply -k platform/deploy/environments/prod/开发测试环境/microk8s/` 一并纳入）。
RuoYi Gateway 静态路由 `/ai/agent/chat/**`、`/ai/agent/channel/**` → `http://ai-assistant-mcp:9600`（StripPrefix=2）。

> 注意：gateway 的 streamable-http 为有状态单 session，orchestrator 是其唯一客户端；
> 滚动时 `cesium-mcp` 与 `ai-assistant-mcp` 两个 deployment 一起 `rollout restart`。
