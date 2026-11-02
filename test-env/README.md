# 开发支撑环境（aiearth01）使用说明

> 默认开发支撑环境由公司网 aiearth01 承载（LAN `10.82.11.51` / Tailscale `100.64.0.4`）。
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
| 产物公共前缀 | http://10.82.11.51:18880/plugins | 产物经 nginx `/plugins/` 反代访问（URL 不含 bucket 名） |
| developer-center 控制 API | http://10.82.11.51:18801/developer-center/api/v1 | 发布控制面唯一入口（release-prepare/upload-sessions/release-complete）；**禁止直连 resource-manager、禁止客户端自签 MinIO SigV4** |

`tools/publish.sh` 已按上表设置默认值；如需覆盖，用环境变量
`DC_API_BASE`（认证与发布控制全走 developer-center）。
公司网外访问（居家/出差）可经 Tailscale 把 `10.82.11.51` 换成 `100.64.0.4`
（脚本会按网关 IP 自动推导上传网络画像 `networkProfile`，也可经 `AGRSEARTH_NETWORK=lan|tailscale` 显式指定）。

## 2. 账号申请流程

1. 联系平台管理员，提供：团队名、负责人、包 id 清单、需要的菜单号段；
2. 平台管理员开通 **ext-developer 角色**并下发：
   - 团队 token（`AGRSEARTH_TOKEN`，发布控制 API 统一认证；`RM_TOKEN` 过渡兼容映射，将被移除）；
   - 球端/管理面测试入口的登录账号（SSO 开发者账号，ext-demo 或团队专属账号）。
3. 凭据只进本机环境变量或本地 `.env`（gitignored），**禁止写进包代码/文档/提测单**。

> 发布不再需要 MinIO 账号/密钥：产物上传走 developer-center 下发的 PostPolicy
> 预签名（短 TTL、精确 key + 大小锁定），客户端只做 multipart 直传，不接触永久凭据。

## 2.5 AI 辅助开发（dev-mcp，推荐）

本仓附带 `tools/dev-mcp/`——面向 AI 编码工具（Kimi Code / Codex / Claude Code / qoder）
的插件开发辅助 MCP：契约文档取读、脚手架建包、发布预检、一键发布到本环境、实例/日志
自助诊断、授权包级环境巡检（`environment_status`）、HMR 联调指引。巡检覆盖 Pod/实际镜像、
实例与任务、PG/schema/runtime 证据、菜单号段、产物 URL 和版本一致性，不读取 Secret 明文。
接入方式与各工具配置片段见仓根 `AGENTS.md`「AI 工具接入」节与 `tools/dev-mcp/README.md`；
Kimi Code 打开本仓即自动加载（`.kimi-code/mcp.json`）。非默认开发测试服务器可在仓根
`.env.local` 覆盖网关、DC API、原生登录 session/callback 完整 URL、clientId 和回跳端口段，
无需修改 `server.mjs`，完整变量表与示例见 `tools/dev-mcp/README.md`「环境配置」。

家庭网与办公网隔离时可临时使用 SSH 动态转发：`ssh -N -D 127.0.0.1:51080 aiearth01`，
再设置 `AGRSEARTH_SOCKS_PROXY=socks5h://127.0.0.1:51080`。DC 与登录请求均走隧道，
登录浏览器使用独立 Chrome 配置，不改系统代理；测试结束关闭 SSH 进程即释放。

## 3. 发布通道（tools/publish.sh）
```bash
# 1. 自助发布：构建 → DC release-prepare → 逐文件 upload-sessions + MinIO 直传 + complete
#    → release-complete（仅测试底座；AGRSEARTH_TOKEN 必填）
AGRSEARTH_TOKEN=... ./tools/publish.sh extensions/<track>/<tier>/<pkg-id>

# 2. 联调部署（release-complete 随发布触发部署，逐组件打印结果）
./tools/publish.sh extensions/<track>/<tier>/<pkg-id> --deploy

# 3. 菜单布设随 release-complete 服务端执行（menuJson 幂等布设）；
#    号段必须已向平台方申请（sys_config menu.segment.<pkg> 台账），本地先过校验：
python3 tools/menujson.py validate extensions/<track>/<tier>/<pkg-id>/data/menu.json --package <pkg-id>
```

发布流（全部控制 API 走 developer-center，脚本内无任何 MinIO/RM 直连）：
`release-prepare`（DC 门面 {version, metadata, backendResources?}，metadata 键名对齐
RM ReleasePrepareDTO；有后端服务时 backendResources 顶层数组按 RM PackageResourceDTO
字段携带 docker-image 声明）→
每个产物文件 `upload-sessions`（version/filename/sizeBytes/sha256/artifactType/networkProfile）
换取 postUrl/formFields → `curl multipart` 直传 MinIO（预签名短 TTL，host 由服务端按
networkProfile 下发，**不得改写**）→ `upload-sessions/{uploadId}/complete`（服务端重算
size+sha256 复核后登记）→ 全部成功后才 `release-complete`（version/dependencies/menuJson/deploy；
响应 .data.menuResult / .data.bundleResult）。

失败语义：任一步失败即非零退出并明确指认；任一文件 complete 失败即中止、**绝不执行
release-complete**。重跑口径分两段：release-complete 失败（含上传段失败）时版本仍为
**草稿态**可重放，修复后直接重跑（prepare/上传会话对草稿版本幂等）；一旦 release-complete
成功版本即**已发布（发布不可变）**，重跑会在 release-prepare 被拒绝——更新产物须递增版本号，
冒烟类环境抖动修复后直接复验 URL 即可。

networkProfile 选择：按 `DC_API_BASE` 网关 IP 自动推导（`100.64.*` → tailscale，
内网私网段 → lan），或经 `AGRSEARTH_NETWORK=lan|tailscale` 显式指定；推导不出即拒绝。

## 4. HMR 调试回路（--dev-url）

正常发布后要改前端？不必每次全量发布——把球端 `entries.esm.url` 指到本机：

```bash
# 1. 前端 watch 构建（产物持续输出到 dist/）
cd extensions/<track>/<tier>/<pkg-id>/frontend && npm run dev

# 2. 另一个终端：静态服务 dist/（本机 IP 需测试底座球端可直达）
cd extensions/<track>/<tier>/<pkg-id>/frontend/dist && python3 -m http.server 5173

# 3. 把已发布版本的 manifest entries 指向本机（宿主再拉 manifest 即加载本机产物）
./tools/publish.sh extensions/<track>/<tier>/<pkg-id> --dev-url http://<本机IP>:5173

# 4. 球端 18880 强制刷新 → 面板加载本机产物，改代码即生效（watch 自动重编）

# 5. 调试完恢复正式产物 URL
./tools/publish.sh extensions/<track>/<tier>/<pkg-id> --dev-url --reset
```

注意：

- `--dev-url` 基于**已发布版本**改写 manifest（先正常发布一次）；
- 本机防火墙放行端口；跨域受限时以静态服务响应头放行为准；
- 恢复（`--reset`）后建议强刷球端再验一次正式产物。

## 5. 边界

- 本环境**不保证数据持久与 SLA**：平台方升级/重建底座时可能清清单与 bucket，重要产物以团队仓库为准；
- 生产缺陷走提测单加急通道，勿绕过流程直发生产（`tools/publish.sh` 也不接受任何 prod 参数）。
