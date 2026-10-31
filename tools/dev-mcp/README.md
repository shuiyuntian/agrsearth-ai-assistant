# mcps/agrsearth-dev — AGRSEarth 插件开发 MCP

> 面向**第三方插件开发团队**的 MCP server（stdio，Node，运行在团队本机）。
> 唯一事实源在平台仓 `mcps/agrsearth-dev/`；模板仓 `tools/dev-mcp/` 是导出产物
> （等价 vendored，**禁止直接改**，问题回报平台方）。
> 与 `agrsearth-ops`（业主运维）是两个 server：本 server 只触达 aiearth02 共享开发
> 调试环境，永不出现家庭网地址，远程一律走 **DC（developer-center）API**。

## 工具清单（22 个，v1.1.0 统一命名）

| 分组 | 工具 | 说明 | 副作用 |
|---|---|---|---|
| 契约文档 | `docs_read` | 模板仓模式读 docs/L1-L10；平台仓模式读 PLUGIN_DEVELOPMENT.md | 无 |
| 脚手架 | `package_scaffold` | 包装 create-extension.sh 建包（track/tier/delivery/backend/admin-ui） | 本地，可逆 |
| 预检 | `package_precheck` | 版本五处一致性 + menu.json 校验（平台仓模式走 publish --check-only 全闸口） | 无 |
| 发布 | `package_publish` | **写操作**：tools/publish.sh 编排 DC 发布门面——`release-prepare` → `upload-sessions`（预签名 postUrl/formFields，POST 直传）→ `complete` → `release-complete`（不再 MinIO SigV4 自签/RM 登记；prod 硬拒绝；平台仓模式拒绝） | 有 |
| 包 | `package_list` | DC `GET /packages`：我可见的扩展包分页（keyword/track/tier） | 无 |
| 包 | `package_register` | **写操作**：DC `POST /packages/register` 注册包（teamId 归属 + resources.postgres/menu 资源位开关） | 有 |
| 包 | `package_manage` | 包委托 grants（list/create/revoke）+ 生命周期：`archive`（POST /packages/{id}/archive 幂等归档，数据保留账号 NOLOGIN）、`transfer`（POST /packages/{id}/transfer {targetTeamId}；有 PG 数据返回 migrationTaskId，task_get 跟踪迁移） | 读+写 |
| 团队 | `team_list` | DC `GET /teams`、`/teams/{id}/members` 分页查询 | 无 |
| 团队 | `team_manage` | `create` / `add-member` / `update-role` / `remove-member`（写，需 reason）；`search-users` 平台用户窄检索；`quota_request` 配额申请（POST /teams/{teamId}/quota-requests，items 1-8 项 `{quota:MENU_POOL\|PACKAGE\|PG, band?, additional:1-100}`，创建 QUOTA_APPROVAL 任务待审）；`quota_approve`/`quota_reject` 平台管理员审批（POST /tasks/{taskId}/quota-approve / quota-reject{reason}；21 工具定型不增 task_manage，审批承载于本工具） | 读+写 |
| 资源 | `resource_list` | DC `GET /packages/{packageId}/resources`：包资源位列表；scope 为客户端过滤（`pg-admin` 会被明确拒绝——团队级账号无列表示端点） | 无 |
| 资源 | `resource_issue` | **写操作**：签发本人 PG 账号（幂等，新签发一次性返回密码）。`scope=pg-dev` → `/packages/{id}/resources/pg-dev/issue`（锚点 packageId）；`scope=pg-admin` → `/teams/{teamId}/resources/pg-admin/issue`（锚点 teamId，TEAM_OWNER/MAINTAINER） | 有 |
| 资源 | `resource_rotate` / `resource_revoke` | **写操作**：`scope=pg-dev` → `/packages/{id}/resources/pg-dev/{rotate\|revoke}`；`scope=pg-admin` → `/teams/{teamId}/resources/pg-admin/{rotate\|revoke}`（吊销回收 owner group 成员身份） | 有 |
| 实例 | `instance_list` | DC `GET /instances`：包级实例列表（packageId 必填=授权锚点，status 可选；读授权未过一律 404，不暴露存在性） | 无 |
| 实例 | `instance_logs` | DC `GET /instances/{id}/logs`（服务端 LogMasker 逐行脱敏，只掩值不掩键）｜`tasks=true` 走 `GET /instances/{id}/tasks`（per-instance 运维任务，与发放任务不同源） | 无 |
| 巡检 | `environment_status` | DC `GET /environment/status`：授权包级 Pod/镜像/实例健康、任务、PG/runtime 证据状态、菜单、产物 URL 与版本一致性；未授权 404，不读 Secret 明文，证据不足返回 `NOT_VERIFIED` | 无 |
| 任务 | `task_get` | DC `GET /tasks`（分页，只读）/ `GET /tasks/{taskId}`（详情含 outbox 轨迹）；`type=PACKAGE_MIGRATION` 展示包转移迁移状态；`type=QUOTA_APPROVAL` 为配额申请审批任务（team_manage quota_request 创建） | 无 |
| 任务 | `task_retry` | **写操作**：DC `POST /tasks/{taskId}/retry` 幂等重试（仅 PARTIAL/可恢复 ERROR 回池，只补 FAILED 步） | 有 |
| 联调 | `hmr_get_guide` | 生成 --dev-url HMR 回路命令 + 排障清单 | 无 |
| 认证 | `auth_login` | 浏览器原生授权登录（OIDC 授权码 + PKCE S256 + loopback 回跳），令牌落盘 `~/.config/agrsearth`（0600） | 本地凭据 |
| 认证 | `auth_status` | 凭据来源 + DC `GET /me` 实测复核（不回显令牌） | 无 |
| 认证 | `auth_logout` | 删除本地落盘令牌（env/.env.local 通道只提示不代删） | 本地凭据 |

> DC API 基址：`{AGRSEARTH_DEV_BASE}/developer-center/api/v1`（controller 真实路径见
> `extensions/system/platform/developer-center/backend/.../controller/`）；RM
> （resource-manager）旧 API 按本工具集红线**不再使用**。

## 接入（模板仓，团队侧）

```bash
cd tools/dev-mcp && npm install   # 仅首次
```

仓根 `.kimi-code/mcp.json` 已由导出脚本生成（Kimi Code 开箱即用）。其他 AI 工具等价配置：

- **Codex**（`~/.codex/config.toml`）：
  ```toml
  [mcp_servers.agrsearth-dev]
  command = "node"
  args = ["tools/dev-mcp/server.mjs"]
  ```
- **Claude Code**（`claude mcp add`）：
  `claude mcp add agrsearth-dev -- node tools/dev-mcp/server.mjs`
- **qoder / 其他**：任意支持 stdio MCP 的客户端，入口 `node tools/dev-mcp/server.mjs`，
  工作目录 = 模板仓根。

## 鉴权（auth_login 原生授权，AGRSEARTH_TOKEN 为 CI 覆盖）

日常交互式使用**无需手动申请 token**：

1. 调用 `auth_login`（默认自动打开系统浏览器；无桌面场景用 `openBrowser=false`
   拿授权链接手动打开）；
2. 在 Casdoor 页面完成账密 + MFA/首登改密（密码不过本工具）；
3. 浏览器回跳 `http://127.0.0.1:<49152-65535 随机端口>/callback`，工具收授权码换
   RuoYi JWT，落盘 `~/.config/agrsearth/dev-mcp-token.json`（文件 0600、目录 0700）。

令牌解析优先级（高→低）：`AGRSEARTH_TOKEN` 环境变量（CI 覆盖）＞ `~/.config/agrsearth`
落盘文件 ＞ 仓根 `.env.local`（遗留兼容）。`auth_status` 可查来源并用 DC `/me` 实测；
`auth_logout` 删落盘文件。

前置条件（平台侧一次性，aiearth02）：

- ruoyi-auth nacos 配置 `casdoor.native-clients` 已登记 `agrsearth-dev-cli`
  （公开客户端无 secret，allowed-ports `49152-65535`）；
- Casdoor 应用 `agrsearth-dev-cli` 已建（secret 留空）且 redirectUris 含 `http://127.0.0.1`；
- 网关 `/auth/**` 白名单覆盖（既有，`/auth/casdoor/native-*` 同链）；
- **网关需有 `/developer-center/**` → `lb://developer-center`（StripPrefix=1）路由**
  （落地时核对 aiearth02 nacos 网关配置）。

## 环境配置

| 环境变量 | 默认值 | 说明 |
|---|---|---|
| `AGRSEARTH_DEV_BASE` | `http://10.82.11.52:18801` | aiearth02 网关（公司网 LAN）；Tailscale 可达时可用 `http://100.64.0.5:18801` |
| `AGRSEARTH_TOKEN` | 无 | CI 覆盖用 Bearer token（优先级最高；交互场景推荐 auth_login） |
| `AGRSEARTH_DEV_CLIENT_ID` | `agrsearth-dev-cli` | 原生公共客户端 clientId（白名单键） |
| `AGRSEARTH_TOKEN_FILE` | `~/.config/agrsearth/dev-mcp-token.json` | 令牌落盘路径（测试/多实例可覆盖） |

## 审计与红线

- 全部工具调用落 `logs/operations/dev-mcp-<日期>.jsonl`（北京时间，gitignored）：时间、
  工具、参数摘要（敏感键脱敏 `***`）、结果码、耗时；**只记请求参数，不记任何响应体**，
  令牌绝不入日志。
- 写操作（`package_publish`、`package_register`、`package_manage` 写 action、
  `team_manage` 写 action、`resource_issue`/`resource_rotate`/`resource_revoke`、
  `task_retry`）强制 `reason`（≥4 字符），缺失即拒。
- 远程只走 DC API；生产（aiearth01）无任何通道。
- 实例门面语义（DC 设计）：`packageId` 是授权锚点、未授权一律 404（不暴露存在性），
  工具如实透传不reinterpret；日志服务端已逐行脱敏（只掩值不掩键），工具侧只按行数
  截断展示、不改内容。
- 资源红线（DC 设计）：PG 账号（pg-dev 包级/pg-admin 团队级）subject 恒为当前登录者
  本人；runtime 密码只写 Secret、不经 ResourceController——本工具不返回、不伪造
  runtime 密码；issue/rotate 的密码为一次性字段，只在工具响应展示一次，不落盘、审计
  不记响应体。`resource_list` 的 `scope=pg-admin` 明确拒绝（团队级账号无列表示端点，
  账号元数据经 issue 幂等返回查看），不假成功。
- 生命周期语义：`archive` 幂等（数据保留、账号 NOLOGIN）；`transfer` 有 PG 数据时返回
  `migrationTaskId`，用 `task_get` 跟踪迁移状态。
- 配额闭环：`quota_request` 创建 QUOTA_APPROVAL 任务（服务端字段名 `quota` 非 `type`，
  items ≤8、additional 1-100）；平台管理员用 `team_manage quota_approve/quota_reject`
  审批（approve 无 body 抬升配额并预发池块；reject 终态 REVOKED 不动配额、reason 透传）。
  `task_get` 只读、`task_retry` 保持发放任务重试原义，21 工具外不增 task_manage。
- 共享调试环境全员只读可见（2026-10-22 业主裁定：调试环境不做团队间隔离）；写权限
  由 ext-developer 角色权限点与团队数据级授权卡住，MCP 只是通道，不放宽任何服务端校验。

## 测试

```bash
cd mcps/agrsearth-dev && npm test
```

node:test 轻量测试（无新框架）：PKCE 纯函数（含 RFC 7636 测试向量）、loopback 端口段、
令牌落盘 0600 回环、JSON-RPC `tools/list` 冒烟（断言 22 工具齐全 + 关键写工具声明
reason 字段 + `environment_status` 只读边界）。
