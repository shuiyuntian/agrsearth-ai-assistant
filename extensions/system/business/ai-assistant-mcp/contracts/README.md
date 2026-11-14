# AI 工具契约（Tool Contracts）

AI 助手（ai-orchestrator）安全闸的事实源：MCP 全量工具的契约清单 + 工具名常量。
由 `extensions/system/business/ai-assistant-mcp/tools/gen-tool-contracts.mjs` 自动生成，**请勿手改**。

## 文件

| 文件 | 说明 |
|:---|:---|
| `tool-contracts.json` | 契约清单。每条 `{ name, domain, side, riskLevel, description, inputSchema }`，附 `generatedAt` 与上游 pin（`upstream.repo/commit`，来自 `vendor/cesium-mcp/.upstream`） |
| `tool-names.ts` | TS 工具名常量 `TOOL_NAMES` 与 `ToolName` 联合类型（前端/orchestrator 编译期约束） |
| `tool-names.json` | 同内容 JSON（供 Java 等非 TS 消费方） |

## 契约字段含义

- `domain`：工具所属域。按工具名前缀映射：`camera_*→camera`、`entity_*→entity`、
  `animation_*`/`clock_control`/`globe_*→animation`、`imagery_*→imagery`、
  `tileset_*→tiles`、`terrain_*→terrain`、`cesium_*→discovery`、`geolocation_*→geolocation`。
- `side`：执行侧。`geolocation_*`/`cesium_*` → `server`（服务端/gateway 自身），其余 → `browser`（经 SSE 命令通道下发浏览器端 Cesium Viewer）。
- `riskLevel`：安全分级，供安全闸决策：
  - `read`：查询类（`list`/`get` 词段、`cesium_list_domains`、`cesium_man`）——免审批；
  - `write`：默认——常规写操作；
  - `destructive`：`*_remove` 类——需用户审批；
  - `codegen`：`cesium_execute_code`（P3 预留，当前上游不存在）。
- `inputSchema`：MCP listTools 原样透传的 JSON Schema（未经任何包装），可直接喂 ajv 做参数校验。

映射规则唯一事实源在 `extensions/system/business/ai-assistant-mcp/tools/lib/tool-contracts-lib.mjs` 顶部常量
（`DOMAIN_RULES`/`SIDE_RULES`/`RISK_RULES`），上游命名变化时改那里再重新生成。

## 重新生成

```bash
node extensions/system/business/ai-assistant-mcp/tools/gen-tool-contracts.mjs           # HTTP 模式：连已运行的 MCP（本地开发形态）
node extensions/system/business/ai-assistant-mcp/tools/gen-tool-contracts.mjs --stdio   # stdio 备选：子进程拉起，与运行中 MCP 无冲突
```

工具面 = gateway（6 域 39 + 3 discovery）+ geolocation（3）= 45 MCP 工具。
HTTP 模式（默认）经 streamable-http 连接 `MCP_CONTRACTS_GATEWAY_URL`（默认
`http://localhost:4010/mcp`）与 `MCP_CONTRACTS_GEO_URL`（默认 `http://localhost:3008/mcp`，
backend/geolocation-http 桥），listTools 合并后重写三份产物。
**注意**：vendor gateway 单实例只接受一次 initialize（"Server already initialized"），
orchestrator 占用中的 gateway 无法再供本脚本连接——orchestrator 在跑时请用 `--stdio`
（子进程拉起独立实例：gateway `pnpm --filter @cesium-mcp/gateway start` +
geolocation-server `node build/index.js`）。
**不改 `vendor/cesium-mcp/` 内任何文件**（vendor pristine，仅只读 import 其
`node_modules` 里的 `@modelcontextprotocol/sdk`，保证 schema 无包装）。

stdio 模式环境变量 `MCP_GATEWAY_PORT`：gateway SSE 通信端口，默认 `3910`（避开 orchestrator 默认的 `3010`）。

## 漂移守卫

```bash
node extensions/system/business/ai-assistant-mcp/tools/check-tool-contracts.mjs
```

重新拉取 listTools，用同一份共享逻辑重建期望契约并与 `tool-contracts.json` 对比：
工具集差异（新增/移除）、逐字段相等（`inputSchema` 深度相等，对象键序不敏感）。
不一致时打印差异并 **exit 1**；`generatedAt` 不参与对比，`upstream` commit 变化仅告警
（工具本体已实时校验，提醒重新生成以更新 provenance）。

### 接入 CI

在 CI 流水线（或 pre-push hook）加一步即可，退出码非 0 即失败：

```yaml
# 例：GitHub Actions
- name: Tool contracts drift check
  run: |
    pnpm -C extensions/system/business/ai-assistant-mcp/vendor/cesium-mcp/cesium-js install --frozen-lockfile
    pnpm -C extensions/system/business/ai-assistant-mcp/vendor/cesium-mcp/cesium-js --filter @cesium-mcp/gateway build
    pnpm -C extensions/system/business/ai-assistant-mcp/vendor/cesium-mcp/geolocation-server install --frozen-lockfile
    (cd extensions/system/business/ai-assistant-mcp/vendor/cesium-mcp/geolocation-server && ./node_modules/.bin/tsc)
    node extensions/system/business/ai-assistant-mcp/tools/check-tool-contracts.mjs --stdio
```

触发场景：vendor 上游同步（`extensions/system/business/ai-assistant-mcp/tools/sync-mcp-upstream.sh`）后必跑；
契约产物被手改时也会被立即捕获。

## 消费方

- **ai-orchestrator 安全闸**（P1）：白名单（`TOOL_NAMES`/`toolCount`）、危险分级审批
  （`riskLevel`）、入参 ajv 校验（`inputSchema`）。
- **前端**：`tool-names.ts` 编译期约束工具卡渲染与白名单；ajv 校验工具参数回显。
- **Java 侧**（如需登记/展示）：`tool-names.json`。
