# Changelog

本文件记录 GIS AI 助手能力包（`ai-assistant-mcp`，2026-10-03 前为 `ai-assistant`）的所有重要变更。

格式基于 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，
版本号遵循[语义化版本](https://semver.org/lang/zh-CN/)。

## [2.1.4] - 2026-10-12

### Security（2026-11-10）

- geolocation-http 升级 Undici 至 7.30.2，覆盖代理、TLS、重定向与 Overpass 真实链路回归，独立审计清零。
- ai-orchestrator 升级 Zod 4.6.7、Vitest 4.1.12 及 Express/qs/fast-uri 等传递依赖，独立审计清零；真实 HTTP 验证健康、鉴权、非法 JSON 与 1 MiB 请求体上限。

### Migration（2026-11-14）

- 迁移至独立仓 agrsearth-ai-assistant：frontend/admin-ui 使用 @agrsearth/* 构建契约并自产包作用域 CSS；AI 契约工具、部署资产与版本化制品归本仓。
- 补齐悬浮入口 activate/deactivate/reactivate/destroy 清理，Entity/imagery/3D Tiles 等增删改限定本包资源；vendor pin 与公开工具契约不变。

### Fixed

### Fixed

- 模型侧工具 schema 兼容修复：vendor（zod→draft-07）元组写法 `items:[{...},{...}]` 在严格 JSON Schema 2020-12 校验的 LLM 网关（CSTCloud uni-api）下被 400 拒收（entity_add_polygon/polyline/ellipse/rectangle/wall/cylinder/box/corridor、tileset_style 共 9 个工具中招），orchestrator 暴露工具集前统一改写为 `prefixItems`+`items:false` 等价语义；vLLM 宽松可过，uni-api 必挂（aiearth01 迁移实测定位）

### Changed

- aiearth01 生产 LLM 切换到 CSTCloud uni-api（`https://uni-api.cstcloud.cn/v1`，模型 `kimi-k2.6`）：configmap LLM_BASE_URL/LLM_MODEL + `开发测试环境-secrets/llm-api-key` 注入 LLM_API_KEY + ry_cloud `ai_config` 库行同步（部署侧变更，镜像不变也可运行）

## [2.1.3] - 2026-10-05

### Changed

- 更名彻底收口（ai-assistant → ai-assistant-mcp）：npm 包名×3（@agrsearth/ai-assistant-mcp、-admin、@ai-assistant-mcp/ai-orchestrator）、面板 DOM id/窗口事件名改 ai-assistant-mcp 口径、orchestrator 组件 serviceId/镜像组件名/k8s workload 统一为 ai-assistant-mcp（镜像 localhost:32000/gis-platform/system/business/ai-assistant-mcp/ai-assistant-mcp:2.1.3，开发测试环境 已切换上线）

## [Unreleased] - 2026-10-03

### Changed

- **包更名 + 目录迁移**：`extensions/ai-assistant` → `extensions/system/business/ai-assistant-mcp`（统一 `extensions/<track>/<tier>/<pkg>/` 规则，track=system/tier=business）；manifest.json `id` 与前端 `manifest.ts`、admin-ui 入口的 packageId 同步为 `ai-assistant-mcp`。
- **吸收 platform/cesium-mcp 组件**：vendor `mcp/` 子树 → `vendor/cesium-mcp/`（pristine 零改动）；`geolocation-http/` 桥 → `backend/geolocation-http/`；镜像构建 → `container/cesium-mcp/`。`platform/cesium-mcp/` 目录撤销。
- cesium-mcp 组件版本轴历史：组件独立版本轴 `container/cesium-mcp/VERSION`（当前 1.1.1，ADR-005 §3.5 组件版本轴例外），与包 VERSION（2.1.2）解耦；历史条目见本文件末节「cesium-mcp 组件 Changelog（原 platform/cesium-mcp）」。
- cesium-mcp 镜像内部布局对齐包结构（`/app/vendor/cesium-mcp/` + `/app/backend/geolocation-http/`），镜像名/命名空间 `agrs-cesiumai/cesium-mcp` 不变。

## [2.1.2] - 2026-07-29

### Fixed

- **extent 误命中同名小对象致高度严重偏低**（18880 实测「飞行到北京」落 575m，geocode bbox ~288km 未生效）：R1 extent/bbox 交叉校验——bbox 对角线 ≥10km（行政区等实体真框）时，extent 必须与 bbox 同量级（ratio ∈ [1/3, 1.5]）才采用，否则判误命中（同名小 POI / 父级大区域）回落 bbox（Nominatim 真名解析优先）；bbox <10km 的 POI/合成框域 extent 直接用（故宫/奥运大厦/篁岭/浙江四验收场景不回归）。
- **并行工具调用下会话记录串位**（「飞行到上海」实测错用北京 extent → 同为 575m）：R2 记录-目的地距离守卫——camera_* 缺 height 推算前校验会话记录落点与本次目的地距离，超过 max(50km, 1.5×bbox 跨度) 弃用记录落缺省 10km；错位记录也不再触发内联 extent 补齐（省 Overpass 查询）。
- **推算决策不可观测**：R3 推算填入决策打 console info（高度 + reason），与 extent 回填行配套，kubectl 即可全链路诊断（此前「推算填入」只进 audit sink）。

## [2.1.1] - 2026-07-28

### Fixed

- **高度推算首查竞态**（18880 实测「飞到故宫博物院」连查两次落缺省 10km）：camera_* 缺 height 推算时历史记录尚无 extent → rescue 路径内联有界（8s）await 一次 geolocation_extent 补齐（桥索引化后正常 <1s），首查即命中第 1 级；并发同地点推算去重（in-flight promise 复用），防并行 fly_to 打爆 Overpass；超时/未命中不阻塞主链，自然回落类型表/bbox/缺省。
- **bbox 级几何取景校准**（开发测试环境 Nominatim/Overpass 实测四场景驱动）：第 3 级 bbox 由 2.7×（阈值 100m 跳过）改 1.0× 全量使用——Nominatim 村落级 ±0.02° 合成框（篁岭对角线 ~5.9km）2.7 倍过远，1.0 倍即几何取景高度；楼宇级点状框（奥运大厦 ~89m）自然落下限 500m；省级真框（浙江 ~700km）落上限 500km；`HEIGHT_RULES.bboxMinDiagM` 移除、`bboxFactor` 新增。
- 可观测性：extent 命中回填/未命中/内联超时/调用失败全量 info·warn 日志（此前推算零日志，线上无法诊断）。
- 配套桥修复（cesium-mcp 1.1.1）：Overpass QL 索引化 + POI 后缀剥离阶梯后，「故宫博物院」类全称 geocode 失配根治。

## [2.1.0] - 2026-07-26

### Added

- 高度推算 v2（四级回退链）：① 新增 `geolocation_extent` MCP 工具命中 → `clamp(2.7×extent对角线, 500m, 500km)`；② `geolocation_search` types → 类型表（building 系 500m / tourism 系 3km / road 2km / suburb·district·town 20km / city 80km / state 400km / country 1500km）；③ geocode boundingBox 有效（对角线>100m）→ 2.7×diag；④ 缺省 10km。参数集中于 `HEIGHT_RULES`（factor=2.7、min=500m、max=500km）。geocode 成功后异步预取 extent 写入 GeocodeHistory（fire-and-forget，失败静默）。修复「飞到故宫博物院」推算 500m 过近问题（现≈3.6km），「飞到奥运大厦」保持 500m 合理。
- 前端会话 403 自愈：遇到且仅遇到「HTTP 403 session not found or expired」时静默重签会话 → 新 sid 重建 SSE → 自动重发原消息（每条消息限重试 1 次，chatEpoch 防自愈期间状态覆盖），用户无感；重试仍失败才上屏报错。
- `/health` 响应新增 `sessions.active`（活跃会话数）。

### Changed

- 会话改为滑动 TTL：`verify` 通过即续期；`SESSION_TTL_SEC` 默认值 7200 → 43200（12 小时，env 仍可覆盖）；签发/过期/归属不符打日志。
- GeocodeHistory 默认 TTL 2h → 12h，对齐会话生命周期；新增 `updateExtent`（location 防串位校验）与 `mergeTypes`。

### Fixed

- 会话过期后发消息硬报 `Chat failed: HTTP 403 - session not found or expired`（现透明自愈）。
- 显式 height 绝不覆盖的既有行为由测试固化；`relaxCameraHeightRequired`/`fillTopDownOrientation`（pitch=-90° 垂直俯视兜底）行为不回归。

## [2.0.0] - 2026-07-21

> AI 助手系统性升级（方案：`docs/plan/20260721-方案-AI助手系统性升级.md`）：MCP 为执行中枢且 pristine，AI SDK v7 循环层收拢进扩展包，全 Node 单镜像，Java ai-agent 与旧 MCP 栈退役。

### 架构

- 新增 ai-orchestrator（`backend/ai-orchestrator/`，Node/TS）：Express + AI SDK v7（`ai@7.0.34`）streamText agent 循环 + `stopWhen: stepCountIs(8)`，vLLM 原生 tool calling 唯一主路径（旧"目录文本+JSON 两段式"废弃）。
- MCP（CesiumGS 官方）收拢至 `mcp/` 并恢复 **pristine 零修改**（`scripts/tools/sync-mcp-upstream.sh` + `--check` CI 校验，pin 2606b49）；`ai/` 目录撤销。
- **命令路由器**（orchestrator 调用侧代理）消化 MCP 命令通道广播缺陷：浏览器连 `/channel/events?sessionId`，登记 (sessionId, commandType) + per-tool 锁定向转发，result 转发 MCP——多会话串台根治，MCP 零修改。
- 单镜像部署：`container/ai-assistant/`（多阶段 Dockerfile + buildx 多架构），开发测试环境 `microk8s/ai-assistant/`（Deployment + ClusterIP 9600 + ConfigMap，含 resources limits），经 RuoYi Gateway 静态路由暴露。
- **Java ai-agent 与旧 MCP 栈整体退役**（ruoyi-modules 模块、开发测试环境 两个 deployment、DGX mcp compose 8 容器、旧三条免鉴权端点与 `/mcp/**` 白名单全部清除）。

### 安全

- 工具契约层（`contracts/tool-contracts.json`，42+1 工具 read/write/destructive/codegen 分级）+ 白名单 + ajv 参数校验（不合规回喂模型）。
- destructive 工具强制人工审批（`data-tool-approval` 挂起，fail-closed）；审批 UI 卡片（代码展示/倒计时/双态）。
- `/ai/agent/**` 全量鉴权（网关 token + Redis LoginUser）；sessionId 服务端签发 + 归属校验；滑动窗口限流（默认 20 rpm）；审计三类行落 `ai_operation_log`。
- codegen 管线 `cesium_execute_code`（默认关闭）：BM25 检索 cesiumjs-skills grounding → AST 校验（自由变量白名单强制/callee 检查/死循环启发式/4000 字符 100 行）→ 人工审批展示完整代码 → 主页面执行（前端另有运行时门+正则兜底）。
- 威胁建模：`docs/设计文档/架构图/ai-assistant-security.md`。

### 前端

- 对话协议切换 AI SDK UI message stream（自研零依赖解析器 `api/chatStream.ts`，编排后端化，删除三段式与 `@ai-sdk/mcp` 依赖，UMD 52KB）。
- 工具状态卡 / 审批卡 / CodeBlock 组件；executors `Record<EnabledTool, Executor>` 编译期守卫。
- 鉴权请求头（`api/auth.ts`，Cookie Admin-Token → Bearer）；EventSource 改 fetch 流式以带鉴权头；`/channel/result` 独立连接池（`channelResultBaseUrl`）解决同源排队突破 MCP 10s 命令超时问题。

### 管理面

- `ai_config`（单行 JSON，热更）+ `ai_operation_log` 两表；admin API 五端点（config/logs/stats，权限串 `aiassistant:*`）。
- ruoyi-ui「AI 助手管理」菜单：配置页（LLM 参数/maxSteps/限流/42 工具分组白名单，保存即热更）+ 统计看板（四卡 + 工具 TOPN + 审批/错误饼图 + 操作日志分页）。
- 菜单/DDL 种子：`data/init_ai_assistant_{tables,menu}.sql`。

### 测试与工程

- orchestrator vitest 87 例；前端 vitest 93 例（测试体系从 0 到 1，`.pnpmfile.cjs` 解决 vitest/vite peer 冲突）。
- CI `.github/workflows/ai-assistant-quality.yml`：契约漂移守卫 + MCP pristine 校验 + orchestrator/frontend 测试。
- 版本五处对齐 2.0.0；`check-extension-versions.sh` 9/9 通过。

## [1.0.0] - 2026-07-20

- AI 助手由宿主内联插件重建为 `extensions/ai-assistant` 远程扩展包，入口默认导出 CapabilityPackage 实例（远程加载契约）。
- 基于 MCP 的自然语言 GIS 助手：意图分析、工具执行、流式回复（飞到某地、添加标记、查询 POI 等）。
- API 改本地 fetch 走网关白名单免 token；SSE 命令通道接收 Gateway 下发的相机/实体命令。
- `@ai-sdk/mcp` 打入扩展包内；vue / element-plus / icons-vue 经宿主 import map external。
- 入口固定右下角悬浮按钮（`hiddenInToolbar` + `autoActivate`），激活时展开右侧对话面板。
- 修复 Cesium Viewer 深响应式导致的栈溢出（`ref(viewer)` → `shallowRef` + `markRaw`）。

---

## cesium-mcp 组件 Changelog（原 platform/cesium-mcp，2026-10-03 并入本包）

> 组件版本轴：`container/cesium-mcp/VERSION`（独立于包 VERSION）。

### 1.1.1 (2026-07-28)

- 修复 geolocation_extent 生产验收暴露的两个缺陷（开发测试环境 实测证据）：
  - Overpass QL 由 `nwr["name"~"^X$"]` 锚定正则（全表扫描 14.8s）改为索引化 union（name/official_name/name:zh 精确 ~0.1s + alt_name 包含 ~0.5s，regex 仅此一处）；
  - 名称阶梯第二级：未命中剥一个 POI 通名后缀重试（故宫博物院→故宫），根治 geocode 全称与 OSM 专名失配（实测「故宫博物院」原名 found:false，剥后缀命中 relation 9511883，对角线 1322m）。
- extent 缓存分级 TTL：正结果 1h 不变，未命中负结果 1h→5min（负结果粘性挡住数据补录与调试）。
- 桥查询加 info 日志（name/found/耗时）；测试 17→24 例（QL union/后缀剥离/负 TTL/防全扫红线断言）。

### 1.1.0 (2026-07-26)

- geolocation-http 桥新增第 4 个 MCP 工具 `geolocation_extent(name, at?, radiusKm?)`：查 Overpass way/relation bounds + tags（relation 优先、多候选取距 at 最近者），返回 extent 对角线长度（haversine），供 orchestrator 高度推算 v2 使用；LRU 缓存（容量 200 / TTL 1h），错误不缓存。
- 桥纯函数抽至 `geolocation-http/extent.mjs`（QL 构建/候选选取/响应解析/缓存），node:test 17 例（`npm test`）；vendor pristine 红线不变，`mcp/` 零修改。
- 对外工具面：gateway（6 域 39 工具 + 3 discovery）+ geolocation 桥（4 工具）= 46 MCP 工具。

### 1.0.0 (2026-07-26)

- MCP 平台化独立（S1）：`extensions/ai-assistant/mcp/` 整体迁移至 `platform/cesium-mcp/mcp/`（git mv 保留历史），归属 platform 层、命名 cesium-mcp。
- vendor pristine 红线不变：`mcp/` 为 CesiumGS/cesium-ai-integrations 的 mcp/ 子树零修改镜像，pin 见 `mcp/.upstream`（当时 2606b49），同步/校验用 `scripts/tools/sync-mcp-upstream.sh`（`--check` 零 diff）。
- 新增 `geolocation-http/`：geolocation-server（vendor 仅 stdio）的 HTTP streamable 桥（vendor 树外、in-process 复用其 build 产物），对 orchestrator 暴露 `http://<host>:3008/mcp`。
- ai-orchestrator 由 stdio spawn gateway 改为 HTTP streamable 连接（gateway `MCP_HTTP_URL` 默认 `http://localhost:4010/mcp`，geolocation 桥 `GEO_MCP_URL` 默认 `http://localhost:3008/mcp`），带启动指数退避重试与调用失败重建重连。
- 对外工具面：gateway（6 域 39 工具 + 3 discovery）+ geolocation 桥（3 工具）= 45 MCP 工具。
