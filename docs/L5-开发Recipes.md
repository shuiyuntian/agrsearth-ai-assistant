# L5 开发 Recipes（任务级 how-to，每条带验收 checklist）

> 用法：按任务对号入条；每条的「验收」必须全勾才能进下一条。契约红线贯穿全部：
> 默认导出实例 / 实体走 ctx.entities / 宿主依赖 external / UI 遵 L10。

## R1 新建插件（选轨与骨架）

1. 按体量判轨（L1.3）：≤1 个自建后端微服务 → 工具轨（`skeletons/tool`）；多服务/子系统级 → 系统轨（`skeletons/system`）。
2. 脚手架生成 `./tools/create-extension.sh <pkg-id> --track <track> --tier <tier>`（落位 `extensions/<track>/<tier>/<pkg-id>/`），按骨架 README「改名清单」替换占位符。
3. 包目录加入仓根 `package.json` 的 `workspaces` 后 `npm install`。

**验收**：`npm run check` 通过；manifest `track`/`tier`（+按需 `delivery`）与轨一致；`components` 段与实际结构一致。

## R2 球端面板与地图联动

1. 面板：`ctx.ui.createPanel({ mode:'native', ...computePanelRect() })`（几何约定见 L10，骨架已内置）；
2. 实体：站点/标记一律 `ctx.entities.add(...)`；弹窗内聚插件内部；
3. Cesium 对象（Cartesian3/Color/Rectangle…）：一律经骨架内置 `src/utils/cesium.ts` 的
   `getCesium()` 取 **window.Cesium**——宿主 import map 无 cesium 键，
   **禁止裸 `import ... from 'cesium'`**（ESM 产物宿主运行时加载失败，且构建期缺类型）；
4. 联动：面板↔地图走 `ctx.emit/on`；跨面板状态用模块级 reactive store；
5. 后端请求：URL 集中在 `frontend/src/api/index.ts` 的 `API` 常量表，面板与业务模块只引用常量；
6. 清理：`deactivate` 判挂起态 + 清实体，`destroy` removeEventListener + close 面板。

**验收**：
- [ ] 停用插件后现场整组不可见（无 viewer.entities 直加，评审 grep 源码确认）
- [ ] 反复激活/停用 5 次无句柄泄漏、无重复面板（createPanel 前判重）
- [ ] 窗口 resize 面板跟随且无抖动；ESM/UMD 双产物行为一致
- [ ] UI 走查符合 L10 球端面板规范
- [ ] `node tools/check-api-contract.mjs <包目录>` 通过，业务文件无散落服务 URL

## R3 加管理页（admin-ui + 菜单注册）

1. 脚手架 `--with-admin-ui` 生成包内 `admin-ui/`（或 `cp -R skeletons/admin-ui extensions/<track>/<tier>/<pkg>/admin-ui`），改名（UMD 名 `AdminUI_<pkg>`、manifest.id）；
2. 页面：`src/views/<view>/index.vue`（骨架 = 查询区/工具栏/表格/分页/对话框，风格见 L10-A）；
3. API：URL 集中在 `src/api/index.ts` 的 `API` 常量表；`src/api/*.ts` 只引用常量并用 `@/utils/request` 封装请求，业务页面禁止散落 `/<serviceId>/...` 字面量；类型 `import type ... from '@/types'`；
4. 入口：`src/index.ts` 的 `adminViews` 键 = viewPath；
5. 菜单：`data/menu.json` 样例改 packageId/号段/权限串为本包（号段向平台方申请，批4 通道，publish 时 menu-provision 幂等落地）；
6. manifest：`components.adminUi=true`、`components.menu={enabled:true, menuPath:<顶层 path>}`。

**验收**：
- [ ] `npm run build` 产出 `admin.es.js/admin.umd.js`，其中 `@/utils/request` 与 vue 均为 external import
- [ ] 无 `createApp`、无 `import.meta.env`（grep 源码）
- [ ] `data/menu.json` 通过 `menujson.py validate` 校验，menuId 落平台方分配的本包号段（menu-provision 幂等 upsert，重复发布计数 unchanged）
- [ ] 页面验收走查符合 L10-A（权限按钮显隐、空态/加载态）

## R4 加后端服务

1. 工具轨：≤1 个服务；系统轨：每服务一个目录（`create-extension.sh --backend <svc>` 从 `backend/svc-placeholder` + `container/svc-placeholder` 实例化可运行骨架）；
2. 应用名 = `backendServices[].serviceId`；声明 `apiPrefix/healthEndpoint/minVersion`；
3. 镜像构建目录 `container/<svc>/`（Dockerfile + build.sh，OCI Label 规范平台方把关）；
4. 时区：容器与 deployment 显式 `TZ=Asia/Shanghai`；
5. **本地联调回路**：骨架 `bootstrap.yml` 的 Nacos 默认直指 aiearth01 开发支撑环境且配置 import 为
   `optional:`，`mvn spring-boot:run` 起服务即注册进底座 Nacos、网关按 `apiPrefix` 路由回本机——
   调代码/接口/前后端联调本地跑，验镜像与 k8s 形态才 `publish --deploy` 推底座（两态分工详见 L8 §8.6）。

**验收**：
- [ ] `components.backend[]` 与 `backendServices[].serviceId` 完全一致
- [ ] 本地 `mvn package` 通过；`mvn spring-boot:run` 起服务注册成功，`curl localhost:<port>/<svc>/actuator/health` 可达
- [ ] deployment 有 TZ、有 resources requests/limits、探针就绪
- [ ] 第三方密钥零入库（依赖清单注明注入需求）

## R5 数据初始化

1. `data/` 放建表/种子 SQL 与菜单声明 `menu.json`（菜单登记 SQL 通道已废止，存量归档
   `archives/menu-sql-legacy-20261004/`，批4 起由 menu-provision 幂等落地），SQL 文件头注明用途与执行方式；
2. 发布时 `data/sql/*.sql` 以 UTF-8 原文进入 `dataSql[].content`，摘要取原始文件字节；publish 预检会提前校验文件名、非空、大小与摘要一致性；
3. 含中文 SQL 一律**文件方式执行**（`kubectl exec -i ... mysql --default-character-set=utf8mb4 < x.sql`），禁止多层嵌套内联 `-e` 传中文；
4. 菜单号段向平台方申请（两段制台账 `sys_config` 的 `menu.segment.<pkg>`：core/tool/system 百万段为
   **菜单 band 分类**，包级千段预发；menuId 必须落本包段内，publish pre-check 服务端 fail-fast）。

**验收**：
- [ ] SQL 幂等可重跑；`components.data=true` 与 data/ 实际内容一致；`menu.enabled=true` 时 `data/menu.json` 齐备且过校验
- [ ] 文件头含执行命令样例

## R6 多组件 + deploy/k8s（系统轨）

1. `deploy/k8s/` 每组件一组 yaml（参考 `skeletons/system/deploy/k8s/` 样例）；
2. 白名单：仅 Deployment/StatefulSet/Service/ConfigMap；namespace 不写（部署服务端强制覆写为目标环境命名空间）；
   **禁** Secret/RBAC/CRD/Namespace；凭据 secretKeyRef 只引用；
3. 每个 workload 显式 TZ + 探针 + resources；镜像 tag = 组件版本轴；
4. `backendServices[].dependsOn` 声明拓扑（publish 部署按拓扑序滚动）。

**验收**：
- [ ] `kubectl apply --dry-run=client -f deploy/k8s/` 全量通过（本地即可验）
- [ ] 白名单 grep 无 Secret/Role/ClusterRole/Binding
- [ ] 拓扑序与实际依赖一致（如 worker dependsOn server）

## R7 发布与回滚（团队侧材料）

> 发布权在平台方（L8）；团队侧负责把材料备齐。

1. 按 `RELEASE_CHECKLIST.md` 完成自检；
2. 四必备文档齐备，最新版 CHANGELOG 段写明本版变更；
3. 自测证据：构建产物清单 + 测试底座实测截图（球端面板/管理页/接口）；
4. 依赖清单：跨包 dependsOn、第三方服务/密钥注入需求。

**验收**：
- [ ] 版本五处一致（VERSION/manifest.json/frontend package.json/manifest.ts/container build.sh）
- [ ] 注释头合规（L7），署名团队真实邮箱
- [ ] 提测单要素齐全，平台方受理无补件
