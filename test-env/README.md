# 开发支撑环境（aiearth01）使用说明

> 默认开发支撑环境由公司网 aiearth01 承载（LAN `10.82.11.51`）。
> aiearth01 同时是预备生产环境，不能沿用独立测试底座的隔离假设；开发操作仍须受
> developer-center 授权与审计约束。aiearth02 当前用于部署测试，不作为模板仓默认开发环境。
> 团队自助发布只走 developer-center；正式生产发布由平台管理员执行。
> 平台方运维口径见平台仓 `platform/deploy/environments/prod/aiearth01/README.md`。

## 1. 地址表（默认端点，全部可环境变量覆盖）

| 组件 | 地址 | 用途 |
|:---|:---|:---|
| GIS 球平台 | http://10.82.11.51:18880 | 插件面板联调入口 |
| 管理面 | http://10.82.11.51:18850 | 扩展管理/菜单对账 |
| 网关 | http://10.82.11.51:18801 | 业务 API 统一入口 |
| Nacos | 10.82.11.51:18810 | 本地后端按需注册与读取配置；共享环境，不是本地独占实例 |
| 产物公共前缀 | http://10.82.11.51:18880/plugins | 产物经 nginx `/plugins/` 反代访问（URL 不含 bucket 名） |
| developer-center 控制 API | http://10.82.11.51:18801/developer-center/api/v1 | 发布控制面唯一入口；禁止直连 resource-manager、禁止客户端自签 MinIO SigV4 |

`tools/publish.mjs` 已按上表设置默认值；如需覆盖，用 `DC_API_BASE`。公司网外访问可使用
`ssh -N -D 127.0.0.1:51080 aiearth01` 建立本机动态转发，再设置
`AGRSEARTH_SOCKS_PROXY=socks5h://127.0.0.1:51080`；DC、MinIO 与冒烟请求均走该代理。

## 2. 账号与团队

1. 联系平台管理员，提供团队名、负责人和包 ID 清单；菜单号段不需要单独申请。
2. 开通 SSO 开发者账号、ext-developer 角色和团队归属。新包注册要求 TEAM_MAINTAINER 及以上；普通开发者可开发并发布已有权限的包。
3. 交互开发使用 dev-mcp 原生登录，不需要平台方下发长期团队 token；CLI/CI 才按需配置 `AGRSEARTH_TOKEN`。
4. 凭据只进本机安全存储或环境变量，禁止写进包代码、文档、对话或提测单。

带菜单的包在首次 `package_register` 时声明 `menu=true`，DC 自动分配本包号段；`task_get` 到 ACTIVE 后用 `resource_list` 实查。越段 fail-fast 时按报错分段修正，不要误走 quota_request；仅团队池真用尽才进入配额审批。

发布不需要 MinIO 账号/密钥：产物上传走 DC 下发的短期 PostPolicy 预签名。

## 2.5 AI 辅助开发与本地联调

先按 [L0](../docs/L0-AI辅助开发.md) 完成 agent-doctor 和登录检查。dev-mcp 提供文档、脚手架、预检、发布、实例日志、环境巡检和 HMR 指引。非默认环境可在仓根 `.env.local` 或用户级配置覆盖非密连接参数，详见 `tools/dev-mcp/README.md`。

后端遵循 **本地直接验证 → 需要时接共享 Nacos → 人工确认 → 批准后部署**：

- 本地 `mvn spring-boot:run` 默认连接上表 Nacos；注册不会自动创建网关路由。
- DC 仅在 `deploy=true` 时注册动态路由；已有路由按服务发现负载均衡，不保证请求只到本机。
- 首次全新服务没有路由时，先本地验证，人工确认并批准首次受控部署后再做后续全链迭代。
- 全链联调要求本机与平台双向可达；结束及时停止并注销本地实例。
- 详细操作与 publish/deploy 副作用见 [L8 §8.6](../docs/L8-提测与发布.md)。

访问国际资源的 Clash 代理与访问本环境的 SOCKS 隧道是不同通道，不要混用；见 L2/L9。

## 3. 发布通道（publish.mjs + 双 shim）
```bash
# 1. macOS / Ubuntu 自助发布（CLI 需 AGRSEARTH_TOKEN；AI 可复用 dev-mcp 登录态）
./tools/publish.sh extensions/<track>/<tier>/<pkg-id>

# Windows CMD / PowerShell：tools\publish.cmd extensions/<track>/<tier>/<pkg-id>

# 2. 部署工作负载：必须经本地/联调证据人工确认后另行批准
./tools/publish.sh extensions/<track>/<tier>/<pkg-id> --deploy

# 3. 零网络本地预检（含菜单与版本校验）：
node tools/publish.mjs extensions/<track>/<tier>/<pkg-id> --check-only
```

发布流（全部控制 API 走 developer-center，无 MinIO/RM 管理面直连）：
`release-prepare`（{version, metadata, backendResources?}）→ 每个产物文件 `upload-sessions`
（version/filename/sizeBytes/sha256/artifactType/networkProfile）换取 postUrl/formFields →
Node multipart 直传 MinIO（预签名短 TTL，host 不得改写）→ `upload-sessions/{uploadId}/complete`
→ 全部成功后才 `release-complete`（version/dependencies/menuJson/deploy）。

失败语义：任一步失败即非零退出；任一文件 complete 失败即中止、**绝不执行 release-complete**。
release-complete 前失败时版本保持**草稿态**可重放；一旦 release-complete 成功即发布不可变，
更新产物须递增版本号。

networkProfile 按 `DC_API_BASE` 网关地址自动推导（内网私网段 → lan，其余 → 广域通道），
或经 `AGRSEARTH_NETWORK` 显式指定（取值由平台方按部署环境发放）。SOCKS5 代理同时覆盖 DC、MinIO 和冒烟。

非密拓扑项（`DC_API_BASE` / `AGRSEARTH_NETWORK` 等）支持配置分层：**进程环境变量 > 仓根
`.env.local` > 用户级 `~/.config/agrsearth/config.json` > 内置默认值**（publish.mjs 与 dev-mcp 同口径；
token 不进配置层）。个人网络拓扑建议写用户级 config.json——机器级生效、不落任何仓库。

自构后端镜像在 `container/<svc>/` 执行
`PUSH_VIA=ssh PUSH_SSH_HOST=aiearth01 ./build.sh`：默认 `PLATFORMS=linux/amd64`，buildx `--load`
后 docker save，经 SSH 在 aiearth01 `docker load && docker push`；`PUSH_VIA=registry` 保留直接推送。

## 4. HMR 调试回路（--dev-url）

正常发布后要改前端？不必每次全量发布——把球端 `entries.esm.url` 指到本机：

```bash
# 1. 终端 A：前端 watch 构建（骨架 dev = vite build --watch，不接 --port/--host）
cd extensions/<track>/<tier>/<pkg-id>/frontend && npm run dev

# 2. 终端 B：vite preview 伺服最新 dist（本机 IP 需让球端可达）
cd extensions/<track>/<tier>/<pkg-id>/frontend
npx vite preview --outDir dist --host 0.0.0.0 --port 5173 --strictPort

# 3. manifest 指向本机实际 ESM 产物（不是 preview 根路径）
./tools/publish.sh extensions/<track>/<tier>/<pkg-id> --dev-url http://<本机IP>:5173/tool.es.js

# 4. 球端 18880 强制刷新 → 面板加载本机产物，改代码即生效（watch 自动重编）

# 5. 调试完恢复正式产物 URL
./tools/publish.sh extensions/<track>/<tier>/<pkg-id> --dev-url --reset
```

注意：

- `--dev-url` 基于**已发布版本**改写 manifest（先正常发布一次）；
- 本机防火墙放行端口；跨域受限时以静态服务响应头放行为准；
- 恢复（`--reset`）后建议强刷球端再验一次正式产物。

## 5. 边界

- **服务端零 SSH/零直连（红线）**：禁止 SSH 登录 aiearth01（或任何服务端）执行任何操作——初始化
  数据库、kubectl、改配置、直查 MySQL/PG 一律禁止；一切环境侧变更只经 developer-center 控制 API
  （dev-mcp 工具 / `tools/publish.mjs`）。数据库初始化 = 包内 `data/sql/*.sql` 随 release-complete
  幂等落库，永远不需要登录服务器执行 SQL。本文出现的 `ssh -N -D`（SOCKS 动态转发）与
  `PUSH_VIA=ssh`（镜像搬运）仅为**本机发起的客户端通道**，不构成服务器访问授权——AI 编码工具
  尤其不得将其泛化为「可以 SSH 上服务器操作」。本条约束**经本仓开展插件开发的团队与 AI 工具**；
  平台方运维人员的维护性操作（含居家网络经 SSH 运维 aiearth01）自有通道，见平台仓运维手册，
  不受本条约束；
- 本环境**不保证数据持久与 SLA**：平台方升级/重建底座时可能清清单与 bucket，重要产物以团队仓库为准；
- 生产缺陷走提测单加急通道，勿绕过流程直发生产（`tools/publish.sh` 也不接受任何 prod 参数）。
