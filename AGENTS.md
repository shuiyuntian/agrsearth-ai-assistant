# AGENTS.md — AGRSEarth 插件开发模板仓（AI 编码工具通用契约）

> 本文件是**工具中立**的 AI 编码契约：Kimi Code / Codex / Claude Code / qoder 等任何
> 打开本仓的 AI 工具都应先读本文件。Kimi Code 另有触发式技能
> `.kimi-code/skills/agrsearth-plugin-dev/SKILL.md`（红线相同、带 recipe 明细），两者同源，
> 改红线时两处同步。

## 这是什么仓

航遥业务中台（AGRSEarth）的**插件（能力包）开发模板仓**。你在这里开发的每个包最终会被发布到
共享开发调试环境（aiearth01，公司网）验收，生产发布由平台管理员执行。平台侧契约唯一本体是平台仓
`docs/插件开发指南/4-契约参考/PLUGIN_DEVELOPMENT.md`；本仓 `docs/L0-L10` 是分层指南，
冲突时以契约本体为准。

## 目录速览

- `extensions/` — **你的扩展包工作区**（`extensions/<track>/<tier>/<id>/`，与平台仓布局同构；
  提测规范见 `extensions/README.md`）；内含官方演示包 `tool/business/wind-field-demo/`（禁止提测）
- `packages/` — `@agrsearth/*` 平台供给包（sdk-types / vite-config / ui-utils / admin-sdk /
  icon-kit / layer-factory / ts-config），**只读勿改**
- `skeletons/` — tool / system / admin-ui 三套骨架，建包一律走脚手架，不手抄
- `tools/` — create-extension.mjs（建包）/ publish.mjs（发布）/ check-extension-versions.mjs（版本校验）
  均为 Node 唯一实现（.sh/.cmd 为薄 shim，免 bash/jq/python）、dev-mcp/
- `backend/svc-placeholder/`、`container/svc-placeholder/` — 后端服务与镜像骨架（脚手架实例化）
- `maven-repo/` — vendored com.ruoyi 依赖闭包（file:// 仓，后端构建免平台仓）
- `test-env/` — 共享开发调试环境（aiearth01）地址表与账号申请说明
- `docs/L0-L10` — 分层开发指南；`RELEASE_CHECKLIST.md` — 提测前自检清单

## AI 工具接入（dev-mcp，推荐）

本仓附带 `tools/dev-mcp/`——插件开发辅助 MCP server（stdio）。接入后你的 AI 工具可直接
查契约文档、跑脚手架、做发布预检、一键发布到共享调试环境、自助查实例/日志。

- **Kimi Code**：仓根 `.kimi-code/mcp.json`（自动注册）。
- **Codex**：`.codex/config.toml`。
- **Claude Code + CodeBuddy**：共用仓根 `.mcp.json`。
- **Qoder**：`.qoder/settings.json`。
- **OpenCode**：`opencode.json`；Skill 位于 `.opencode/skills/`。
- **Trae**：`.trae/mcp.json`（IDE 中启用项目级 MCP 并信任项目）。
- **其他支持 stdio MCP 的客户端**：入口 `node tools/dev-mcp/server.mjs`，工作目录 = 仓根。

首次使用先 `cd tools/dev-mcp && npm install`（`agent-doctor` 会把缺依赖判为 FAIL）。登录统一用 `auth_login_start` / `auth_login_wait`；
CI 才用 `AGRSEARTH_TOKEN` 覆盖。`node tools/agent-doctor.mjs --client <kimi|codex|claude|qoder|opencode|trae|codebuddy>`
检查 MCP 与 Skill；完整矩阵见 `docs/AGENT_PARITY.md`。

> MCP 配置使用仓根相对路径（Trae 除外，已用 `${workspaceFolder}`）——**请以模板仓根目录为工作区打开**，
> 把本仓嵌套为更大工作区的子目录会导致 MCP server 启动失败。各端首次接入还需在客户端信任/批准
> 项目级 MCP 配置（Claude Code 弹批准提示、Trae 需在 IDE 启用项目级 MCP）。
> Windows 建包走 `tools\create-extension.cmd`（Node 薄 shim，无需 Git Bash/jq/Python）。

Skill 权威源为 `.kimi-code/skills/`（插件开发 `agrsearth-plugin-dev` + CesiumJS `cesiumjs-*`/
`using-cesiumjs-skills`，后者由平台仓 vendor 同步，**勿手改**）；Codex/OpenCode/Claude/Qoder/Trae/CodeBuddy
分别用各自项目目录（`.codex/skills/`、`.opencode/skills/`、`.claude/skills/`、`.qoder/skills/`、
`.trae/skills/`、`.codebuddy/skills/`）的同内容副本，`.agents/skills/` 为通用入口。
改 Skill 只改权威源，然后跑 `node tools/check-agent-parity.mjs --fix` 同步副本，禁止单端漂移。
**版本倒挂警示**：cesiumjs 技能基线为 CesiumJS v1.144，高于当前宿主球端 cesium 1.141.0——
技能可能推荐宿主不存在的新 API（如 `GeoJsonPrimitive`、`Scene.snap`），落地前以宿主实际版本为准。
CesiumJS vendor skills 仅作 API 与场景参考；其中 Performance Tips / visual eval 不属于 AGRSEarth 默认配置或验收红线，
不得作为默认降配依据。插件应使用宿主 Viewer，不照搬独立 Viewer 示例，不在无明确需求时修改共享场景的
`requestRenderMode`、`resolutionScale`、`msaaSamples` 等全局渲染参数；性能降级须基于具体场景与实测。
**`tools/dev-mcp/` 是导出产物，禁止直接改**——问题回报平台方，源头在平台仓 `mcps/agrsearth-dev/`。

## 默认任务流与审批

1. 纯问答只读；小修按既有模式处理。新包、多文件或多组件任务先澄清业务目标，给出分类、槽位、修改范围和验收标准，用户确认后实施。
2. 涉及 MCP/远程调用时先检查 doctor 与 `auth_status`。建包用 `package_scaffold`，本地完成后执行构建、URL 对账和 `package_precheck`，以真实输出判定。
3. 后端先本地直接验证；需要全链时可连接共享 Nacos，但注册不自动创建网关路由，已有路由也不保证只到本机。结束联调及时停止注销本地实例。
4. 注册、发布、资源签发等写操作逐次取得用户明确批准。后端 `deploy=true` 必须在本地/联调证据经人工确认后另行批准；不得默认部署或触发生产。
5. 完成时报告变更、命令结果、远程状态和未验证项；构建或发布冒烟通过不等于业务验收通过。详细流程与代理排错见权威 Skill 和 `docs/L0-AI辅助开发.md`。

## 契约红线（违反即验收打回；交付前必须 grep 自查）

1. **默认导出契约**：`frontend/src/index.ts` 默认导出 `CapabilityPackage` **实例**
   （`{ manifest, activate, deactivate?, destroy? }`），禁止工厂函数；admin-ui 入口导出
   `{ manifest, adminViews }`。
2. **现场分组隔离（ADR-006）**：实体只走 `ctx.entities.*`，**禁止 `viewer.entities.add()` 直加**；
   Primitive 只走 `ctx.primitives` 并自清理；帧回调/键盘/定时器等可触发重建的路径先判挂起态。
3. **宿主依赖 external**：`vue/vue-router/pinia/element-plus/@element-plus/icons-vue/cesium/echarts`
   （及 `opencc-js`、`@/utils/request`）一律不打进产物——构建必须经 `@agrsearth/vite-config[/admin]`。
4. **管理页红线（ADR-007）**：不自建 `createApp`；不用 `import.meta.env`（用 `@agrsearth/admin-sdk`
   的 `getBaseApi()`）；不 import 宿主内部组件/store。
5. **显式声明零推断**：manifest `track`（tool|system）/`tier`（platform|business）必填，
   `delivery` 仅 tool·business 象限用；旧 `class` 字段已全退役，勿再填；`components` 段
   （frontend/backend[]/adminUi/menu{enabled,menuPath}/data）必须与包内实际结构一致；
   禁止 latest 镜像 tag；一切 k8s/docker 时区 `TZ=Asia/Shanghai`（一票否决项）。
6. **前后端 URL 契约单源化**：球端/管理页调用本包后端的 URL 一律集中在各自
   `src/api/index.ts` 的 `API` 常量表（`SVC` 前缀 + 见名知意的键），业务代码禁止散落
   `/<serviceId>/...` 字面量；URL 必须与公开后端 Spring Mapping 全路径一致，发布前双向对账。
7. **环境零 SSH/零运维直连**：禁止 SSH 登录 aiearth01（或任何服务端）执行 kubectl、改配置、
   直查 MySQL 或以管理员/runtime 凭据直连 PG；一切环境侧变更只经 DC 控制 API（dev-mcp 工具 /
   `tools/publish.mjs`）。开发者需要查看或调试 PG 时，仅可经 `resource_issue` 申请本人短 TTL
   `pg-dev`/`pg-admin` 账号，并按返回的外部 `jdbcUrl`、库名和授权 schema 访问；不得分享凭据或越权
   访问其他包。数据库初始化与正式迁移仍只能由 `data/sql/*.sql` 随 release-complete 幂等落库，
   临时连接不得替代发布链。本文档与 test-env/README 中出现的 SSH 仅限两个客户端侧通道用途：
   网络隔离时的 SOCKS 动态转发、自构镜像 `PUSH_VIA=ssh` 搬运——均为本机发起的连接，不代表可以
   登录服务器执行命令。（本条约束经本仓开展插件开发的团队与 AI 工具；平台方运维人员的维护性
   操作自有通道，见平台仓运维手册，不受本条约束。）
8. **菜单号段零申请**：menuId 禁止自编、禁止照抄 skeleton/演示包示意值（2004000/3004000 段）。
   号段**不需要申请**——`package_register`（resources.menu=true）自动从团队池切出本包专属千段：
   `task_get` 跟踪发放任务到 ACTIVE → `resource_list` 复核 menu 资源位 → `data/menu.json`
   全部 menuId（含 parentId 引用）落本包段内 → publish。**「禁止越段写菜单」fail-fast ≠ 缺号段、
   不要 quota_request**——报错文本自带本包实分段 [start-end]，把 menu.json 改成它重发即可。
   注意**注册一次性定资源位**：menu=false 注册的包没有自己的段，重注册 409——需要菜单的包
   注册时就必须 menu=true，误注册只能「package_manage remove → 重新注册」。
   仅团队池真正用尽（默认 10 块×10000 号/band）才走 `team_manage quota_request` →
   QUOTA_APPROVAL PENDING → 平台管理员审批（18850 开发者中心→任务页）；TEAM_OWNER 不能自审
   （403 是设计如此），PENDING 期间不要重发版本烧号。

## 常用命令

```bash
npm install                    # 首次：装全部 workspace 依赖（@agrsearth/* 自动链接）
npm run check                  # 契约单测 + 全部 workspace 骨架构建
npm run test:publish           # Node 发布协议 + golden master 回归
node tools/check-agent-parity.mjs          # 七端 Skill/MCP 资产一致性
node tools/agent-doctor.mjs --client qoder # 当前客户端接入自检
node tools/check-api-contract.mjs extensions/<track>/<tier>/<id>  # 前后端 URL 双向对账
./tools/create-extension.sh <id> --track tool|system --tier platform|business \
    [--name 中文名] [--with-backend] [--with-admin-ui]
# Windows：tools\create-extension.cmd <id> --track ...（Node 薄 shim，无需 Git Bash）
./tools/check-extension-versions.sh        # 版本一致性 + 四必备校验（Windows：tools\check-extension-versions.cmd）
./tools/publish.sh extensions/<track>/<tier>/<id>  # macOS/Ubuntu 发测试底座
# Windows：tools\publish.cmd extensions/<track>/<tier>/<id>
./tools/publish.sh extensions/<track>/<tier>/<id> --dev-url http://<本机>:<端口>/tool.es.js  # HMR：watch + vite preview
# 有随包 CSS 时追加：--dev-css-url http://<本机>:<端口>/tool.css；reset 同时恢复 JS/CSS
```

## 遇到问题 → 先去哪

通用 R1–R7 recipe 见 `docs/L5-开发Recipes.md`（所有 agent 可读；七端 Skill 同源，触发方式按客户端约定）。
排错按下表选入口，不要先改服务器或共享配置：

| 症状 | 处置入口 |
|---|---|
| 构建/骨架/URL 契约自检失败 | `npm run check`；`node tools/check-api-contract.mjs <包目录>`；`docs/L9-FAQ与排错.md` |
| 球端加载失败 / 联调报错 | dev-mcp `hmr_get_guide` + docs/L9 |
| 发布失败 | `node tools/publish.mjs <包目录> --check-only`；dev-mcp `package_precheck` / `task_get` / `task_retry` |
| 菜单注册失败 / 越段 fail-fast / 配额 PENDING | 红线 8 流程：dev-mcp `resource_list` 查本包实分段改 menu.json 重发（不要 quota_request）；docs/L9 §9.4 |
| 实例异常 / 查日志 | dev-mcp `instance_list` / `instance_logs` |
| 环境不通 | dev-mcp `environment_status` |
| 权限不生效 | 核 `data/menu.json`、`v-hasPermi` 与 docs/L10；平台方执行权限对账 |

## 验收 Checklist（提测前逐条过）

完整清单见 `RELEASE_CHECKLIST.md` 与 `docs/L8-提测与发布.md`；核心条目：

- [ ] `npm run check` 通过；`check-extension-versions.sh` 全绿
- [ ] grep 自查：无 `viewer.entities.add`、无 `createApp`、无 `import.meta.env`、无 latest tag
- [ ] components 段与目录结构一致；注释头五要素合规（docs/L7）
- [ ] 管理页布局规约（撑满式列表 / 操作列宽度测算 / 弹窗 70%×70vh 居中 / 浮层嵌套走 drawer）——
      细则见 `.kimi-code/skills/agrsearth-plugin-dev/SKILL.md` 与 docs/L10
- [ ] 权限两层模型：页内只读接口注解 = 页面 view perms（整页共用，禁止按接口切碎）

## 与平台仓的同步约定

本仓是模板内容的**唯一事实源**（fork 模型，2026-10-22 起）：`packages/`（@agrsearth 供给物）、
`backend|container/svc-placeholder/`、`tools/dev-mcp/`、`maven-repo/`
由平台方经 `scripts/build/sync-template.sh` 单向同步下发（溯源见 `.upstream`），
**不要在本仓改这些目录**——向平台方提 issue，源头修改后重新同步。
`skeletons/`、`docs/`、`test-env/`、本文件等模板内容直接在本仓维护（平台管理员）。
你自己包的目录（`extensions/<track>/<tier>/<你的id>/`）不受同步影响。
