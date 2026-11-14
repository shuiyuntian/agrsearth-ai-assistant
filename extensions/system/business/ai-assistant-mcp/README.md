# ai-assistant-mcp — GIS AI 助手能力包

> **分类**：系统轨·业务能力包（track=system / tier=business，无 delivery）
> **包版本**：见 `VERSION`，当前为 2.1.4
> **组件**：球端悬浮入口 / admin-ui / ai-orchestrator / cesium-mcp（vendor gateway + geolocation-http 桥）
> **跨包依赖**：geolocation-services >=1.0.0；外部 LLM 是可插拔环境依赖，不随包部署

## 1. 调用契约

```text
frontend（右下角悬浮按钮 + 对话面板）
  → 网关 /ai/agent/** → ai-orchestrator:9600
      ├─ HTTP streamable → MCP gateway:4010/mcp
      ├─ HTTP streamable → geolocation-http:3008/mcp
      ├─ 命令路由 → 浏览器 /channel/events、/channel/result
      ├─ OpenAI 兼容 HTTP → 外部 LLM（环境配置）
      ├─ MySQL ai_config / ai_operation_log（环境运行数据）
      └─ Redis 会话与限流（环境运行数据）

geolocation-http → 既有 Nominatim / OSRM / Overpass 上游 API
```

orchestrator 聚合两个 MCP client，不新增统一地理 API 或控制器：

- gateway：39 个浏览器工具 + 3 个 discovery，共 42；
- geolocation-http：geocode/route/search/extent，共 4；其中 extent 仅供 orchestrator 内部高度推算；
- MCP 连接面为 46；模型契约再加本地 codegen 为 46；默认模型可见 45（codegen 默认关闭、extent 不进模型白名单）。

地理服务字段、边界框、路径、POI、relation bounds 和错误语义均沿用 geolocation-services 的公开上游契约。vendor Nominatim provider 的公网地址由桥层 fetch 改写接管，不修改 vendor。

## 2. 目录与版本轴

```text
extensions/system/business/ai-assistant-mcp/
├── VERSION / manifest.json / README.md / CHANGELOG.md
├── frontend/                 # 悬浮入口与浏览器执行器，包版本 2.1.4
├── admin-ui/                 # remote config/dashboard，包版本 2.1.4
├── backend/
│   ├── ai-orchestrator/      # Node/TS，镜像版本 2.1.4
│   └── geolocation-http/     # 自研 HTTP 桥，打入 cesium-mcp 镜像
├── vendor/cesium-mcp/        # pristine，pin 见 .upstream / UPSTREAM.md
├── contracts/                # 真实 listTools 生成的工具契约
├── tools/                    # 契约生成/校验与 upstream sync
├── container/
│   ├── ai-assistant-mcp/     # orchestrator 镜像，版本=包 VERSION
│   └── cesium-mcp/           # 组件独立版本轴，见本目录 VERSION
├── data/                     # 原样菜单声明与初始化 SQL（不自动执行）
└── deploy/k8s/               # 两套工作负载的 RM bundle
```

包和 orchestrator 镜像保持 2.1.4；cesium-mcp 组件以 `container/cesium-mcp/VERSION` 为准，当前也是 2.1.4。不得用历史文档中的 1.1.1 或 admin-ui 的 2.1.2 覆盖这些较高版本。

## 3. 独立安装、构建与测试

在独立仓根安装 frontend/admin-ui 及模板 workspace：

```bash
npm install
npm run build -w @agrsearth/ai-assistant-mcp
npm run test -w @agrsearth/ai-assistant-mcp
npm run build -w @agrsearth/ai-assistant-mcp-admin
```

frontend 经 `@agrsearth/vite-config` 传 `packageId=ai-assistant-mcp`，只扫描本包源码并生成 `[data-cap-package]` 作用域 `tool.css`，禁止 Preflight/base 和宿主源码扫描。admin-ui 使用 `@agrsearth/vite-config/admin` 与 `@agrsearth/admin-sdk`，不自建 createApp、不引用宿主内部 store/components、不使用 import.meta.env。

Node 后端与 vendor 使用各自锁文件：

```bash
cd backend/ai-orchestrator
pnpm install --frozen-lockfile
pnpm typecheck && pnpm test && pnpm build

cd ../geolocation-http
pnpm install --frozen-lockfile
pnpm test

cd ../../vendor/cesium-mcp/cesium-js
COREPACK_ENABLE_AUTO_PIN=0 pnpm install --frozen-lockfile
pnpm --filter '@cesium-mcp/gateway...' build

cd ../geolocation-server
COREPACK_ENABLE_AUTO_PIN=0 pnpm install --frozen-lockfile --config.strict-dep-builds=false
./node_modules/.bin/tsc
```

vendor pristine 校验与工具契约漂移检查：

```bash
extensions/system/business/ai-assistant-mcp/tools/sync-mcp-upstream.sh --check
node extensions/system/business/ai-assistant-mcp/tools/check-tool-contracts.mjs --stdio
```

契约文件只能由真实 listTools 再生成，不手改。安装依赖时保持 `COREPACK_ENABLE_AUTO_PIN=0`，避免回写 vendor package.json。

## 4. 悬浮生命周期与资源所有权

- activate 创建面板、会话和 SSE；deactivate 同时隐藏面板与 Teleport 悬浮按钮，中止 chat、断开 SSE、清理审批/面板计时器并停止本包 orbit；reactivate 恢复上次展开状态和连接；destroy 释放 DOM、监听、定时器、effect scope 和本包资源。
- Entity/动画走 `ctx.entities`，imagery 走 `ctx.layers`，3D Tiles 走 `ctx.primitives`，地形走 `ctx.terrain`；list/remove/style 只处理本包登记对象，禁止删除其他包私有对象。
- 相机、Clock、光照与相机控制器保持既有 AI 工具的共享操作语义。deactivate/destroy 不回滚用户已确认的全局状态，但不得留下持续监听或后续写入。codegen 继续默认关闭。
- 面板与 Teleport 按钮都带 `data-cap-package=ai-assistant-mcp`；普通右侧工具与其他独立入口不共享本包激活态。

## 5. 本地真实工具链（不调用 LLM）

分别启动 gateway、geolocation-http 和 orchestrator，端口可用环境变量覆盖。地理服务地址通过 `NOMINATIM_SERVER_URL`、`OSRM_SERVER_URL`、`OVERPASS_SERVER_URL` 显式注入；本地开发应使用经批准的只读服务端点，不写死到公开仓。

```bash
cd vendor/cesium-mcp/cesium-js
PORT=13010 COMMUNICATION_PROTOCOL=sse MCP_TRANSPORT=streamable-http \
  pnpm --filter @cesium-mcp/gateway start

PORT=13008 NOMINATIM_SERVER_URL=http://127.0.0.1:18860 \
  OSRM_SERVER_URL=http://127.0.0.1:18861 \
  OVERPASS_SERVER_URL=http://127.0.0.1:18862/api/interpreter \
  node backend/geolocation-http/server.mjs

cd backend/ai-orchestrator
PORT=19600 AUTH_ENABLED=false MYSQL_URL= REDIS_URL=redis://127.0.0.1:1 \
  MCP_HTTP_URL=http://127.0.0.1:14010/mcp GEO_MCP_URL=http://127.0.0.1:13008/mcp \
  MCP_SSE_URL=http://127.0.0.1:13010/mcp/events \
  MCP_RESULT_URL=http://127.0.0.1:13010/mcp/result \
  LLM_BASE_URL=https://llm.example.invalid/v1 LLM_MODEL=external-model \
  pnpm start
```

这些测试覆盖真实健康字段、内存会话、工具发现和只读地理工具，不覆盖也不冒充 LLM 推理。`POST /chat/`、codegen 和任何付费外部 LLM 调用均需单独批准。

## 6. 真实 LLM 验收（需单独批准）

`tests/runtime/verify-ai-llm.mjs` 通过环境变量接收经批准的 OpenAI 兼容端点与模型，不把内网地址或凭据写入公开仓。脚本验证模型目录、真实推理、orchestrator 聊天、模型自主 geocode 只读调用，以及 codegen 生成、AST 复核和人工审批；生成代码只保存证据，不执行。地理服务地址也必须显式指向经批准的只读服务。

```bash
S11_EVIDENCE_DIR=/tmp/s11-llm-evidence \
S11_LLM_BASE_URL=http://approved-vllm.example.com/v1 \
S11_LLM_MODEL=approved-model \
GEOLOCATION_NOMINATIM_URL=http://approved-nominatim.example.com \
GEOLOCATION_OSRM_URL=http://approved-osrm.example.com \
GEOLOCATION_OVERPASS_URL=http://approved-overpass.example.com/api/interpreter \
node tests/runtime/verify-ai-llm.mjs
```

该验收使用独立端口和内存会话，不写远程 MySQL、Redis、菜单或工作负载。模型目录 ID 与推理响应 `model` 字段分别记录，二者不一致时不得擅自视为同一标识。

## 7. 镜像与部署

两个构建入口均在 `container/<svc>/build.sh`，构建上下文为独立仓根；`Dockerfile.dockerignore` 排除 node_modules/build/dist、测试 harness 和无关上游内容。原生构建示例：

```bash
cd container/ai-assistant-mcp
PLATFORMS=linux/arm64 PUSH=0 ./build.sh
cd ../cesium-mcp
PLATFORMS=linux/amd64 PUSH=0 ./build.sh
```

`PUSH=0` 只加载到本机 Docker，不推 registry。正式双架构交付应由 arm64/amd64 原生构建合并 OCI index，不能用 QEMU 冒充原生。

`deploy/k8s/` 包含 cesium-mcp 与 ai-assistant-mcp 的 ConfigMap、Service、Deployment：ClusterIP 3008/3010/4010 与 9600，cesium-mcp 为 Recreate，保留资源限制、探针和 `TZ=Asia/Shanghai`。namespace 由 RM 注入；MySQL/LLM Secret 只保留引用，实体归环境 owner。地理服务默认使用集群 Service DNS；LLM 示例使用明确不可用的 `.invalid` 占位，实际端点与模型由环境配置接管。

未经单独批准，不执行注册、发布、部署、远程菜单布设、数据库 DDL、Nacos/网关/Secret 修改、真实外部 LLM 调用或 Git commit/push。
