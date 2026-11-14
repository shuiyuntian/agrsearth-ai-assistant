# ai-orchestrator（P0 骨架）

AI 助手升级的「大脑」：Node/TS 服务，经 MCP（CesiumGS 官方 gateway，vendor pristine）
驱动浏览器中的 Cesium Viewer；LLM 走 vLLM OpenAI 兼容端点（原生 tool calling）。

```
浏览器(Cesium) ←SSE /channel/events──┐
   │ POST /channel/result           │  ai-orchestrator (:9600)
   └──────────────┼─────────────────┤
                  ▼                 │
        command-router（按 sessionId 定向 + per-tool 锁）
                  │ 订阅 SSE(单槽位) │ HTTP streamable（重试/重连）
                  ▼                 ▼
        cesium-gateway-mcp :3010（SSE 命令通道）+ :4010/mcp（MCP 协议）
        geolocation-http   :3008/mcp（vendor geolocation-server 的 HTTP 桥）
                  ▲
        LLM: vLLM OpenAI 兼容（LLM_BASE_URL）
```

MCP 服务（本包 vendor/cesium-mcp + backend/geolocation-http）为外部进程，本地起法见
[包根 README.md 的 cesium-mcp 组件章节](../../README.md#cesium-mcp-组件vendor-mcp--geolocation-桥)；
orchestrator 不 spawn 任何 MCP 子进程。

## 起停

```bash
# 0. 一次性：构建 MCP（vendor pristine，详见包根 README.md cesium-mcp 组件章节）
cd extensions/system/business/ai-assistant-mcp/vendor/cesium-mcp/cesium-js && pnpm install && pnpm --filter '@cesium-mcp/gateway...' build
cd extensions/system/business/ai-assistant-mcp/vendor/cesium-mcp/geolocation-server && COREPACK_ENABLE_AUTO_PIN=0 pnpm install && ./node_modules/.bin/tsc
cd extensions/system/business/ai-assistant-mcp/backend/geolocation-http && pnpm install

# 1. 启动 MCP 服务（两个进程，终端 A/B；orchestrator 侧未就绪指数退避重试，启动顺序不限）
cd extensions/system/business/ai-assistant-mcp/vendor/cesium-mcp/cesium-js && \
  PORT=3010 COMMUNICATION_PROTOCOL=sse MCP_TRANSPORT=streamable-http \
  pnpm --filter @cesium-mcp/gateway start
cd extensions/system/business/ai-assistant-mcp && \
  NOMINATIM_SERVER_URL=http://127.0.0.1:18860 OSRM_SERVER_URL=http://127.0.0.1:18861 \
  OVERPASS_SERVER_URL=http://127.0.0.1:18862/api/interpreter OSM_USER_AGENT=AGRSEarth/1.0 \
  https_proxy=http://127.0.0.1:7890 http_proxy=http://127.0.0.1:7890 \
  no_proxy=127.0.0.1,localhost,127.0.0.1 \
  PORT=3008 node backend/geolocation-http/server.mjs

# 2. 启动 orchestrator（终端 C；HTTP 连接上述两个 MCP 端点）
cd extensions/system/business/ai-assistant-mcp/backend/ai-orchestrator
pnpm install
pnpm start          # tsx src/index.ts，监听 :9600

# 3. 启动模拟浏览器（另一个终端）
node scripts/mock-browser.mjs test            # sessionId=test
node scripts/mock-browser.mjs other           # 第二个会话（验证定向路由）

# 停止：Ctrl-C（MCP 两进程独立存活，orchestrator 退出不影响它们）
```

## 环境变量

| 变量 | 默认 | 说明 |
|:---|:---|:---|
| `PORT` | `9600` | orchestrator HTTP 端口 |
| `LLM_BASE_URL` | `https://llm.example.invalid/v1` | vLLM OpenAI 兼容端点（DGX 推理节点，200Gb 直连） |
| `LLM_MODEL` | `aeon-ultimate` | 模型名 |
| `LLM_API_KEY` | 空（发 `***REMOVED***`） | vLLM 本地部署一般不需要 |
| `MCP_HTTP_URL` | `http://localhost:4010/mcp` | gateway streamable-http 端点（= 通信端口+1000，外部进程） |
| `GEO_MCP_URL` | `http://localhost:3008/mcp` | geolocation-http 桥端点；空串=禁用 geolocation |
| `MCP_SSE_URL` | `http://localhost:3010/mcp/events` | gateway SSE 命令通道（单槽位，orchestrator 独占） |
| `MCP_RESULT_URL` | `http://localhost:3010/mcp/result` | 浏览器结果回传转发目标 |
| `AGENT_MAX_STEPS` | `8` | agent 最大步数（`stopWhen: stepCountIs`） |
| `ENABLED_TOOLS` | 缺省=契约全量 | 工具白名单（逗号分隔；空字符串=空白名单） |
| `TOOL_CONTRACTS_PATH` | `../../contracts/tool-contracts.json` | 契约文件路径覆盖 |
| `AUTH_ENABLED` | `true` | 鉴权开关（本地联调可 `false`，dev 身份 `dev-user`） |
| `JWT_SECRET` | `abcdefghijklmnopqrstuvwxyz` | RuoYi JWT secret（HS512，claim `user_key`） |
| `REDIS_URL` | `redis://localhost:6379` | 不可达时自动降级内存 Map（日志 warn） |
| `SESSION_TTL_SEC` | `43200` | 会话 TTL（秒），verify 通过即滑动续期 |
| `RATE_LIMIT_RPM` | `20` | 限流：滑动窗口每分钟请求数（per-user/per-IP） |
| `APPROVAL_TIMEOUT_MS` | `120000` | destructive 审批超时，超时=拒绝（fail-closed） |
| `MYSQL_URL` | 空 | MySQL 连接串（如 `mysql://root:pass@localhost:3306/ai_admin`）；未配置/不可达时降级：审计回 console、配置回 env |
| `CONFIG_POLL_MS` | `30000` | `ai_config` 轮询间隔（兜底外部直接改库） |

非法 env 会 fail-fast 并打印全部 issue。

## 接口

- `POST /chat` — body `{"sessionId":"test","messages":[{"role":"user","content":"飞到北京"}]}`，
  响应为 AI SDK UI message stream（SSE）。destructive 工具会挂起并写自定义
  `data-tool-approval` data part `{callId, tool, args, reason, riskLevel}`。
- `POST /chat/session` —（鉴权后）签发会话，返回 `{sessionId}`（owner=username，TTL 2h）。
- `POST /chat/approval` — 审批回执 `{sessionId, callId, approved}` → resolve 挂起。
- `GET /channel/events?sessionId=X` — 浏览器 SSE（多连接，按 sessionId 分桶，心跳 30s）。
- `POST /channel/result` — 浏览器回传 `{id,result}`，转发 gateway `/mcp/result`。
- `GET /health` — 状态 + 工具数 + transport("http") + mcp 各连接状态 + auth/store/mysql 模式 + configVersion。

P1-A 安全闸：`/chat` 与 `/channel` 全链路挂鉴权中间件（`user_key` header 或 JWT 兜底
→ Redis `login_tokens:<user_key>` 校验登录态）；/chat、/channel/events、/chat/approval
校验 sessionId 归属；/chat 限流（429 + Retry-After）；callTool 前 ajv 按契约 inputSchema
校验（不合规直接回喂模型，不走 MCP）。

## admin 管理面 API（P2-A）

DDL：`extensions/system/business/ai-assistant-mcp/data/init_ai_assistant_tables.sql`（`ai_config` 单行 JSON +
`ai_operation_log` 审计/用量表）。执行：`mysql -u<user> -p <db> < init_ai_assistant_tables.sql`。

| 方法/路径 | 权限串 | 说明 |
|:---|:---|:---|
| `GET /admin/config` | `aiassistant:config:list` | 当前生效配置（`llmApiKeyRef` 脱敏为 `******`） |
| `PUT /admin/config` | `aiassistant:config:edit` | 部分更新（zod 校验）→ 落库 + **进程内即时热更**（version 递增，下一轮请求即用新值） |
| `GET /admin/logs?pageNum&pageSize&username&toolName&beginTime&endTime` | `aiassistant:log:list` | RuoYi TableDataInfo 形态（rows/total/code/msg） |
| `GET /admin/stats/summary?beginTime&endTime` | `aiassistant:stats:list` | requests/sessions/activeUsers/tokens/approvalRate/errorRate/avg/p95DurationMs |
| `GET /admin/stats/tools?topN=10&beginTime&endTime` | `aiassistant:stats:list` | 工具调用 TOPN（次数/成功率/平均耗时） |

权限模型：`LoginUser.permissions` 含 `*:*:*` 或对应权限串放行，否则 403（dev 身份自带 `*:*:*`）。

**热更机制**：`ai_config` 单行 JSON 为事实源；`RuntimeConfig`（`src/config/runtime.ts`）
持有进程内快照，`applyPatch` 合并-校验-落库后 version++ 即时生效；chat（maxSteps/
temperature/maxTokens/模型）、限流（rpm）、白名单（enabledTools 按 version 重建工具集）、
审批策略（approvalPolicy）均每请求读快照；另有 30s 轮询兜底外部改库。

**审计落库**：`ai_operation_log` 三类行——`tool`（工具调用+参数摘要+耗时+结果）、
`llm`（模型/prompt_tokens/completion_tokens，取自 streamText onFinish 的 totalUsage；
provider 已开 `includeUsage` 使流式回传 usage）、`approval`（审批 approved/denied/timeout）。
异步写入、失败不阻塞主流程（warn + console 回显）；无 MySQL 回退 console。

## codegen 管线（P3-A）

`cesium_execute_code` 工具：`grounding 生成 → AST 校验 → 强制审批` 三段管线，
orchestrator 只产出代码，**真正执行在前端主页面**。

```
用户意图 ─┐
          ▼
skills-loader  BM25 选域（.kimi-code/skills/cesiumjs-*，CJK 同义词扩展，CODEGEN_MAX_SKILLS=1）
          ▼
generator    系统规则（只输出代码/只用 Cesium+viewer/禁危险 API）+ 域 SKILL.md 全文
             → vLLM 普通 completion（temperature 0.2）→ 去 markdown 围栏
          ▼
ast-verifier acorn parse-only：禁用标识符 / 动态 import / 计算属性(非字面量) /
             MemberExpression callee(constructor 等) / 自由标识符白名单【强制】 /
             4000 字符·100 行 / 死循环启发式 —— 违规回喂重生成（CODEGEN_MAX_ATTEMPTS=3）
          ▼
强制审批     riskLevel=codegen → data-tool-approval（args 带 {intent, code}，
             前端审批卡展示完整代码）→ POST /chat/approval
          ▼
返回 {code, verified, attempts, approvedForExecution:true} → 前端主页面执行
```

**开关**：`ai_config.codegenEnabled`（默认 false；PUT /admin/config 热更即注册/摘除工具）。
工具契约由 `extensions/system/business/ai-assistant-mcp/contracts/local-tools.json` 合并生成（`source:"local"`，
`node scripts/tools/gen-tool-contracts.mjs` 重生成不丢，漂移守卫兼容）。

**env**：`CODEGEN_SKILLS_DIR`（默认仓库根 `.kimi-code/skills`）、`CODEGEN_MAX_SKILLS`（1）、
`CODEGEN_MAX_ATTEMPTS`（3）。

**安全模型**：① grounding——prompt 侧先行约束（只输出代码、只用 Cesium+viewer、禁危险
API 清单）；② AST——acorn parse-only 静态校验，堵死 eval/Function/动态 import/计算属性
拼接/constructor 逃逸/自由变量出白名单（`process`/`require`/`globalThis` 全拒）；
③ 审批——destructive 级强制人工确认，审批卡展示完整代码，超时=拒绝（fail-closed）。
**免沙箱定案**：代码不在 orchestrator/服务端执行，仅经审批后由前端主页面在浏览器里跑；
残余风险：AST 是静态启发式（无法证明运行时无害，如合法 Cesium API 的高成本调用），
由人工审批兜底；`while(true)` 带 break 的形态无法静态证明终止性，靠 100 行上限+人工审。

## 验证步骤

```bash
# 单元测试 + 类型检查
pnpm test          # vitest：config 校验 / 定向匹配 / per-tool 锁 / wrapBrowserTools
pnpm typecheck     # tsc --noEmit

# gateway 健康（orchestrator 启动后）
curl -s http://localhost:3010/mcp/health

# 端到端：工具调用 → 命令路由 → mock-browser 回执 → 中文流式总结
curl -N -X POST localhost:9600/chat -H 'Content-Type: application/json' \
  -d '{"sessionId":"test","messages":[{"role":"user","content":"飞到北京"}]}'
# 预期：流中出现 camera_fly_to 的 tool-input/output；mock-browser 打印命令并回 200；
#       模型输出中文总结（如“已成功将相机定位到北京……”）

curl -N -X POST localhost:9600/chat -H 'Content-Type: application/json' \
  -d '{"sessionId":"test","messages":[{"role":"user","content":"列出所有实体"}]}'
# 预期：entity_list 被调用并返回成功。
```

定向路由验证：另起一个 `node scripts/mock-browser.mjs other`，对 `sessionId=test`
发 chat，other 会话不会收到任何命令。

## 设计要点（P0）

- **MCP 传输：一律 HTTP streamable（S1 起）**。gateway 与 geolocation-http 桥均为外部
  进程（本包 vendor/cesium-mcp + 桥，起法见包根 README）；orchestrator 不再 spawn 子进程。
  `src/mcp/client.ts` 对 gateway / geolocation 各建一个 client 并合并工具面
  （重名 fail-fast）：启动时未就绪**指数退避无限重试**（支持先起 orchestrator 后起
  MCP）；工具调用失败 → 标记 down、**有界重试重建 client**（新 session）后原调用
  重试一次，`/health` 的 `mcp` 字段实时反映各连接状态。
  注意 vendor gateway 的 streamable-http 单实例只接受一次 initialize：orchestrator
  必须是其唯一客户端；gateway 进程未重启时 session 不可再生（此时重建会一直失败，
  直到 gateway 重启——k8s 部署需保证两者生命周期对齐，见包根 README cesium-mcp 章节）。
- **命令通道**：gateway 的 SSE 是单连接，由 orchestrator 独占订阅；浏览器连 orchestrator
  的 `/channel/events`（多连接）。browser 工具调用前 `registerCall(sessionId, toolName)`
  登记，截获广播命令按 `command.type === toolName` 定向推送；同名工具 per-tool 锁串行；
  10s（对齐 MCP 超时）未回自动放锁。
- **browser 工具名单**（硬编码）：`camera_* / entity_* / animation_* / clock_control /
  globe_* / imagery_* / tileset_* / terrain_*`（以 listTools 实际名称为准，discovery 类
  `cesium_*` 不走浏览器）。
- **P1 预留挂点**（代码内注释标注）：鉴权中间件（`src/index.ts`）、命令审批钩子
  （`command-router.ts handleCommand`）、会话粘性路由、工具白名单（`config.ts`）。

## 已知限制

- vendor gateway 单实例只接受一次 initialize（"Server already initialized"）：
  orchestrator 必须是 gateway 唯一客户端；契约工具（gen/check-tool-contracts）
  在 orchestrator 占用 gateway 期间须用 `--stdio`；orchestrator 对 gateway 的
  断线重建仅在 gateway 进程重启后可恢复（geolocation 桥为多 session，无此限制）。
- 浏览器结果需满足 MCP 侧 outputSchema 对 handler 构造 output 的字段要求
  （如 `camera_fly_to` 需 `actualDuration`、`camera_get_position` 需 `position/orientation`），
  否则 MCP 侧 output 校验失败、模型会重试。mock-browser 已按类型回传。
- 单进程内存态（会话分桶、锁均在内存），无持久化；P1 再议。
