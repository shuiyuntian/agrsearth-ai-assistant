---
name: agrsearth-plugin-dev
description: Use when developing AGRSEarth 航遥业务中台 plugins (tool/system capability packages) — skeleton scaffolding, CapabilityContext contracts, admin-ui remote pages, backend services, menu.json 菜单声明, k8s deploy, publish 发布, and 提测 (submit-for-test) preparation. Enforces plugin contract red lines (default-export instance, ctx.entities only, host deps external) and per-recipe acceptance checklists. 新建/改造/发布插件、构建失败与 publish 校验失败排查时使用。
---

# AGRSEarth Plugin Development（航遥业务中台插件开发）

Template repo: `packages/` (@agrsearth/* workspace packages) + `skeletons/` (tool/system/admin-ui skeletons) + `docs/L1-L10` (layered guides; authoritative detail lives in the platform repo `docs/插件开发指南/4-契约参考/PLUGIN_DEVELOPMENT.md`).

## 触发条件

- 新建/改造能力包（manifest.json、frontend Capability、admin-ui、backend、deploy/k8s、data SQL）
- 插件构建失败、远程加载失败、publish 校验失败排查
- 提测前自检与材料准备

## 契约红线（违反即验收打回，先 grep 再交付）

1. **默认导出契约**：`frontend/src/index.ts` 必须默认导出 `CapabilityPackage` **实例**（`{ manifest, activate, deactivate?, destroy? }`），禁止工厂函数；admin-ui 入口导出 `{ manifest, adminViews }`。
2. **现场分组隔离（ADR-006）**：实体只走 `ctx.entities.add/remove/...`；**禁止 `viewer.entities.add()` 直加**；Primitive 只走 `ctx.primitives` 并自清理；帧回调/键盘/定时器触发重建前先判挂起态。
3. **宿主依赖 external**：`vue/vue-router/pinia/element-plus/@element-plus/icons-vue/cesium/echarts`（及 `opencc-js`、`@/utils/request`）一律不打进产物——构建必须经 `@agrsearth/vite-config` / `@agrsearth/vite-config/admin`。
4. **管理页红线（ADR-007）**：不自建 `createApp`；不用 `import.meta.env`（用 `@agrsearth/admin-sdk` 的 `getBaseApi()`）；不 import 宿主内部组件/store。
5. **显式声明零推断**：manifest `track`/`tier` 必填（tool|system / platform|business；`delivery` 仅 tool·business 象限用，旧 `class` 字段已全退役勿再填）；`components` 段（frontend/backend[]/adminUi/menu{enabled,menuPath}/data）与包内实际结构一致；禁止 latest 镜像 tag；时区 `TZ=Asia/Shanghai` 一票否决。
6. **前后端 URL 契约单源化**：球端/管理页调用本包后端的 URL 一律集中在各自 `src/api/index.ts` 的 `API` 常量表（`SVC` 前缀 + 见名知意的键），业务代码禁止散落 `/<serviceId>/...` 字面量；URL 必须与公开后端 Spring Mapping 全路径一致，发布前执行双向对账。
7. **环境零 SSH/零直连**：禁止 SSH 登录 aiearth01（或任何服务端）执行任何操作——初始化数据库、kubectl、改配置、直查 MySQL/PG 一律禁止；一切环境侧变更只经 DC 控制 API（dev-mcp 工具 / `tools/publish.mjs`）。数据库初始化 = `data/sql/*.sql` 随 release-complete 幂等落库。文档中出现的 SSH 仅限两个客户端侧通道用途：网络隔离时的 SOCKS 动态转发、自构镜像 `PUSH_VIA=ssh` 搬运——均为本机发起的连接，不代表可以登录服务器执行命令。
8. **菜单号段零申请**：menuId 禁止自编、禁止照抄 skeleton/演示包示意值（2004000/3004000 段）。号段**不需要申请**——`package_register`（resources.menu=true）自动从团队池切出本包专属千段：`task_get` 跟踪发放任务到 ACTIVE（回执含 `band:start-end`）→ `resource_list` 复核 menu 资源位 → `data/menu.json` 全部 menuId（含 parentId 引用）落本包段内 → publish。**「禁止越段写菜单」fail-fast ≠ 缺号段、不要 quota_request**——报错文本自带本包实分段 [start-end]，把 menu.json 改成它重发即可。仅团队池真正用尽（默认 10 块×10000 号/band，约 100 个带菜单的包才触得到）才走 `team_manage quota_request`（quota=MENU_POOL, band=tool|system）→ QUOTA_APPROVAL PENDING → **平台管理员审批**（18850 开发者中心→任务页，或平台方 dev-mcp `quota_approve`）；TEAM_OWNER 不能自审（403 是设计如此），PENDING 期间不要重发版本烧号。

## 任务 Recipe 索引（每条带验收 checklist，详见 docs/L5-开发Recipes.md）

| Recipe | 任务 | 骨架/样例 |
|---|---|---|
| R1 | 新建插件（选轨 + 复制骨架 + 改名清单） | `skeletons/tool`、`skeletons/system` |
| R2 | 球端面板与地图联动（createPanel native + ctx.entities + emit/on） | `skeletons/tool/frontend` |
| R3 | 加管理页（admin-ui + remote: 菜单 + v-hasPermi） | `skeletons/admin-ui` + `*/data/menu.json` |
| R4 | 加后端服务（backendServices + container/ + TZ） | `backend/svc-placeholder`、`container/svc-placeholder`（create-extension.sh --backend 实例化） |
| R5 | 菜单声明（data/menu.json，menu-provision 幂等落地） | `*/data/menu.json` |
| R6 | 多组件 + deploy/k8s（白名单四类、拓扑 dependsOn） | `skeletons/system/deploy/k8s` |
| R7 | 发布与回滚（RELEASE_CHECKLIST + 提测单材料） | `RELEASE_CHECKLIST.md`、docs/L8 |

## 每步验收（通用 checklist）

- [ ] `npm run check` 通过（URL 契约单测 + 全部 workspace 骨架可构建）
- [ ] `node tools/check-api-contract.mjs <包目录>` 双向对账通过；业务代码无本包服务 URL 字面量
- [ ] 产物仅 external import vue 等宿主依赖（grep dist 首行）
- [ ] 源码 grep：无 `viewer.entities.add`、无 `createApp`、无 `import.meta.env`、无 latest tag
- [ ] components 段与目录结构一致；版本五处一致；注释头合规（docs/L7.4）
- [ ] 管理页列表：撑满式布局（.app-container flex 撑满 calc(100vh-84px) + .table-container flex:1 +
      el-table height=100%，表体内部滚动、分页固定底部、整页不滚）；左树右表页树面板内部滚动
- [ ] 操作列：固定宽 fixed=right + 图标文字 tooltip；宽度按内容实测测算
      （width = Σ按钮 + (n-1)×12 + 24；2 字≈54/3 字≈68/4 字≈82/dropdown≈30px；宁宽勿折行，必须一行放下）
- [ ] 数据/图表弹窗：宽 70% + 高 70vh + 上下居中（`.el-dialog.类名{margin:0!important;transform:none!important}`
      必须带 .el-dialog 前缀压宿主 6vh 全局规则；overlay-dialog flex 居中；内容区 flex:1），tooltip 文字与按钮一致不加
- [ ] 浮层嵌套（docs/L10 A.3）：无 dialog 套 dialog；二次浮层一律 el-drawer（默认宽 55% 全高侧滑，内容放不下
      可放宽至 75% 或更宽；不套 dialog 居中 CSS），抽屉内至多再叠一层 dialog；分配/详情/多列表格场景走抽屉，轻表单/确认走弹窗，复杂多步才独立路由页
- [ ] **权限两层模型合规（docs/L6 权限节）**：页内只读接口注解=页面 view perms（整页共用，禁止按接口切碎）；
      写操作才建 xxx:add/edit/remove 按钮且注解 1:1 对应；禁止「有注解无按钮」（幽灵权限，非超管必撞 403）
      与「无意识裸奔」（无注解非豁免接口=登录即可调，安全缺口）
- [ ] **权限对账全绿**（平台方在发布链路执行，本仓无需跑脚本）：代码注解值必须命中本包菜单 perms
      （或平台侧豁免白名单），红灯阻塞发布；黄灯（悬空按钮）限期整改或报平台方入白名单分类登记
- [ ] 提测单要素齐：代码 + 版本 + CHANGELOG + 自测证据 + 依赖清单（docs/L8.2）

## data/sql 内容完整性与布实验收

- `data/sql/*.sql` 必须保持 UTF-8 原文；SHA-256 按原始文件字节计算，`dataSql[].content` 为同一份原文。
- 发布前执行 `node tools/publish.mjs <包目录> --check-only`，利用文件名、非空、大小与 UTF-8 原文摘要校验。
- SQL 注释中的 `<...>` 不得为绕过校验而手工转义或删改；摘要不符时核对服务端/客户端摘要，不得修改内容凑摘要。
- 原文与 MinIO 一致而服务端摘要不同时，按平台侧内容改写问题上报；附两端摘要与字符/字节数，不附敏感 SQL 原文。
- `dataResult.applied/skipped` 是 SQL 布设证据；`postgres.status=VERIFIED` 不代表业务表已创建。最终以业务表、真实接口和管理页 CRUD 验收，不以 Pod Ready 代替。
- 已应用的历史 SQL 不得改内容冒充原迁移；需变更时新增 SQL 文件并保留幂等语义。

## 速查

- ctx 全量 API：`packages/sdk-types/src/index.ts`；manifest schema（components 段）：docs/L6.2
- **权限对账机制（2026-09-16 根治后固化）**：由平台方在发布链路执行（对账脚本在平台仓，本仓不含）——
  静态扫描全仓 `@RequiresPermissions` 值，与「菜单 perms 全集（各包 data/menu.json + 存量 init SQL）」
  双向 diff：代码有清单无=**红灯阻塞发布**（幽灵权限）；清单有代码无=黄灯警告（悬空按钮）；豁免接口
  （纯辅助只读无敏感，@RequiresLogin 形态）必须注释标记 + 报平台方白名单登记。历史教训：幽灵权限让
  「角色全勾仍 403」，tianditu-tile 曾整服务无鉴权——对账是唯一能保证「勾选清单=真实权限」的机制
- UI 规范（管理页四段式/撑满式列表/操作列公式/面板几何 440-64-80-112/数据图表弹窗 70%×70vh 居中/
  浮层选用与弹窗嵌套禁忌——二次浮层用抽屉 55% 宽全高，含实拍正例/
  字号层级——EP 14px 基线：强调条标题 14/600、辅助说明 13、弱化 12，警示条模式显式 text-align:left）：docs/L10
- 菜单号段查询：dev-mcp `resource_list`（menu 资源位含本包实分段）/ `task_get`（注册发放任务回执）；越段 fail-fast、配额 PENDING 排错见 docs/L9 §9.4
- 排错：docs/L9（构建/球端/管理面/发布四组 FAQ）
