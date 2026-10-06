---
name: cesiumai-plugin-dev
description: Use when developing CesiumAI 航遥业务中台 plugins (tool/system capability packages) — skeleton scaffolding, CapabilityContext contracts, admin-ui remote pages, backend services, k8s deploy, and 提测 (submit-for-test) preparation. Enforces plugin contract red lines (default-export instance, ctx.entities only, host deps external) and per-recipe acceptance checklists.
---

# CesiumAI Plugin Development（航遥业务中台插件开发）

Template repo: `packages/` (@cesiumai/* workspace packages) + `skeletons/` (tool/system/admin-ui skeletons) + `docs/L1-L10` (layered guides; authoritative detail lives in the platform repo `docs/插件开发指南/4-契约参考/PLUGIN_DEVELOPMENT.md`).

## 触发条件

- 新建/改造能力包（manifest.json、frontend Capability、admin-ui、backend、deploy/k8s、data SQL）
- 插件构建失败、远程加载失败、publish 校验失败排查
- 提测前自检与材料准备

## 契约红线（违反即验收打回，先 grep 再交付）

1. **默认导出契约**：`frontend/src/index.ts` 必须默认导出 `CapabilityPackage` **实例**（`{ manifest, activate, deactivate?, destroy? }`），禁止工厂函数；admin-ui 入口导出 `{ manifest, adminViews }`。
2. **现场分组隔离（ADR-006）**：实体只走 `ctx.entities.add/remove/...`；**禁止 `viewer.entities.add()` 直加**；Primitive 只走 `ctx.primitives` 并自清理；帧回调/键盘/定时器触发重建前先判挂起态。
3. **宿主依赖 external**：`vue/vue-router/pinia/element-plus/@element-plus/icons-vue/cesium/echarts`（及 `opencc-js`、`@/utils/request`）一律不打进产物——构建必须经 `@cesiumai/vite-config` / `@cesiumai/vite-config/admin`。
4. **管理页红线（ADR-007）**：不自建 `createApp`；不用 `import.meta.env`（用 `@cesiumai/admin-sdk` 的 `getBaseApi()`）；不 import 宿主内部组件/store。
5. **显式声明零推断**：manifest `track`/`tier` 必填（tool|system / platform|business；`delivery` 仅 tool·business 象限用，旧 `class` 字段已全退役勿再填）；`components` 段（frontend/backend[]/adminUi/menu{enabled,menuPath}/data）与包内实际结构一致；禁止 latest 镜像 tag；时区 `TZ=Asia/Shanghai` 一票否决。

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

- [ ] `npm run check` 通过（全部 workspace 骨架可构建）
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
- [ ] **权限对账全绿**：`scripts/check-perms-parity.sh` 红灯=0（代码注解值必须命中菜单 perms 或豁免白名单
      scripts/build/perms-allowlist.txt）才可 publish；黄灯（悬空按钮）限期整改或入白名单分类登记
- [ ] 提测单要素齐：代码 + 版本 + CHANGELOG + 自测证据 + 依赖清单（docs/L8.2）

## 速查

- ctx 全量 API：`packages/sdk-types/src/index.ts`；manifest schema（components 段）：docs/L6.2
- **权限对账机制（2026-09-16 根治后固化）**：`scripts/check-perms-parity.sh` 静态扫描全仓
  `@RequiresPermissions` 值，与「菜单 perms 全集（各包 data/menu.json + 存量 init SQL）」双向 diff——
  代码有清单无=**红灯阻塞发布**（幽灵权限）；清单有代码无=黄灯警告（悬空按钮）；豁免接口
  （纯辅助只读无敏感，@RequiresLogin 形态）必须注释标记 + 白名单登记。publish 前置强制
  （--skip-perms-check 仅限应急）。历史教训：幽灵权限让「角色全勾仍 403」，tianditu-tile
  曾整服务无鉴权——对账是唯一能保证「勾选清单=真实权限」的机制
- UI 规范（管理页四段式/撑满式列表/操作列公式/面板几何 440-64-80-112/数据图表弹窗 70%×70vh 居中/
  浮层选用与弹窗嵌套禁忌——二次浮层用抽屉 55% 宽全高，含实拍正例/
  字号层级——EP 14px 基线：强调条标题 14/600、辅助说明 13、弱化 12，警示条模式显式 text-align:left）：docs/L10
- 排错：docs/L9（构建/球端/管理面/发布四组 FAQ）
