# L5 开发 Recipes（任务级 how-to，每条带验收 checklist）

> 用法：按任务对号入条；每条的「验收」必须全勾才能进下一条。契约红线贯穿全部：
> 默认导出实例 / 实体走 ctx.entities / 宿主依赖 external / UI 遵 L10。

## R1 新建插件（选轨与骨架）

1. 按体量判轨（L1.3）：≤1 个自建后端微服务 → 工具轨（`skeletons/tool`）；多服务/子系统级 → 系统轨（`skeletons/system`）。
2. AI 优先调用 dev-mcp `package_scaffold`；CLI 备用 `./tools/create-extension.sh <pkg-id> --track <track> --tier <tier>`。脚手架自动落位 `extensions/<track>/<tier>/<pkg-id>/` 并替换包名、版本、全局名等占位符。
3. 根 `package.json` 的 workspace glob 已覆盖 `extensions/*/*/*/{frontend,admin-ui}`；建包后在仓根执行 `npm install`，不要手改 workspaces 或新建分包 lockfile。

**验收**：`npm run check` 通过；manifest `track`/`tier`（+按需 `delivery`）与轨一致；`components` 段与实际结构一致。

## R2 球端面板与地图联动

1. 面板：`ctx.ui.createPanel({ mode:'native', contentPadding:'default', ...computePanelRect() })`
   （几何与内容区留白约定见 L10，骨架已内置；自管理留白时不传 contentPadding）；
2. 样式：关键布局使用随包 CSS，Vue 组件优先 `<style scoped>`，非 SFC 使用包级根类；
   当前球端骨架产出 `tool.css`，发布会自动回填 `entries.css.url`；不要只依赖宿主 Tailwind 工具类；
3. 实体：站点/标记一律 `ctx.entities.add(...)`；弹窗内聚插件内部；
4. Cesium 对象（Cartesian3/Color/Rectangle…）：一律经骨架内置 `src/utils/cesium.ts` 的
   `getCesium()` 取 **window.Cesium**——宿主 import map 无 cesium 键，
   **禁止裸 `import ... from 'cesium'`**（ESM 产物宿主运行时加载失败，且构建期缺类型）；
5. 联动：面板↔地图走 `ctx.emit/on`；跨面板状态用模块级 reactive store；
6. 后端请求：URL 集中在 `frontend/src/api/index.ts` 的 `API` 常量表，面板与业务模块只引用常量；
7. 清理：`deactivate` 判挂起态 + 清实体，`destroy` removeEventListener + close 面板。

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
5. 菜单：`data/menu.json` 样例改 packageId/号段/权限串为本包。号段**不需要向平台方申请**——dev-mcp `package_register`（resources.menu=true）发放任务自动从团队池切出本包专属千段，`task_get` 跟踪到 ACTIVE 后 `resource_list` 查本包实分段 [start-end]，把 menu.json 全部 menuId（含 parentId 引用）改成段内值；publish 时 menu-provision 幂等落地，越段服务端 fail-fast（报错自带本包实分段）；
6. manifest：`components.adminUi=true`、`components.menu={enabled:true, menuPath:<顶层 path>}`。

**验收**：
- [ ] `npm run build` 产出 `admin.es.js/admin.umd.js`，其中 `@/utils/request` 与 vue 均为 external import
- [ ] 无 `createApp`、无 `import.meta.env`（grep 源码）
- [ ] `data/menu.json` 通过 `node tools/publish.mjs <包目录> --check-only` 内置菜单校验，menuId 全部落 `resource_list` 实查的本包号段（menu-provision 幂等 upsert，重复发布计数 unchanged）
- [ ] 页面验收走查符合 L10-A（权限按钮显隐、空态/加载态）

## R4 加后端服务

1. 工具轨：≤1 个服务；系统轨：每服务一个目录（`create-extension.sh --backend <svc>` 从 `backend/svc-placeholder` + `container/svc-placeholder` 实例化可运行骨架）；
2. 应用名 = `backendServices[].serviceId`；声明 `apiPrefix/healthEndpoint/minVersion`；
3. 镜像构建目录 `container/<svc>/`（Dockerfile + build.sh，OCI Label 规范平台方把关）；
4. 时区：容器与 deployment 显式 `TZ=Asia/Shanghai`；
5. **本地优先、人工确认后部署**：先 `mvn spring-boot:run` 做本地接口验证；需要全链时再接共享 Nacos。
   Nacos 注册不会自动创建网关路由，已有路由也不会只转发到本机；首次服务需经批准后完成一次受控部署建立基线。
   `deploy=true` 会改变平台工作负载，必须在本地/联调证据经人工确认后使用。完整边界见 L8 §8.6。

**验收**：
- [ ] `components.backend[]` 与 `backendServices[].serviceId` 完全一致
- [ ] 本地 `mvn package` 通过；`mvn spring-boot:run` 起服务注册成功，应用内 `curl localhost:<port>/actuator/health` 可达；经网关另验 `/<svc>/actuator/health`
- [ ] deployment 有 TZ、有 resources requests/limits、探针就绪
- [ ] 第三方密钥零入库（依赖清单注明注入需求）

## R5 数据初始化

1. `data/` 放建表/种子 SQL 与菜单声明 `menu.json`。SQL 文件头注明用途和“随 release-complete 幂等落库”，不写服务器直连执行命令；
2. 发布时 `data/sql/*.sql` 以 UTF-8 原文进入 `dataSql[].content`，摘要取原始文件字节；publish 预检提前校验文件名、非空、大小与摘要一致性；
3. 团队不通过 SSH/kubectl/数据库直连执行 SQL。含中文也保持文件原文，由 DC 发布链应用并核对 `applied/skipped` 回执；历史 SQL 不得原地改写冒充新迁移；
4. 菜单号段零申请：`package_register` 自动从本团队 band 池切千段包级号段并写台账 `menu.segment.<pkg>`，
   `task_get` 跟踪到 ACTIVE 后用 `resource_list` 实查。menuId 必须落本包段内，越段 fail-fast 时按报错分段修正，
   不要误走 quota_request；仅团队池真用尽才走配额审批。

**验收**：
- [ ] SQL 幂等可重跑；`components.data=true` 与 data/ 实际内容一致；`menu.enabled=true` 时 `data/menu.json` 齐备且过校验
- [ ] 文件头注明用途与发布执行方式；发布回执和真实业务表/接口验证一致

### R5.1 开发机查看与调试数据库

1. 先调 `auth_status` 确认本人开发者身份。资源签发属于写操作，说明包、环境和用途并取得本次批准后，调用：

   ```text
   resource_issue(packageId="<包 ID>", scope="pg-dev", reason="开发机查看本包数据库")
   ```

   团队 OWNER/MAINTAINER 确需团队级查看时使用 `scope="pg-admin"` 并传 `teamId`；普通插件开发不得用管理员或 runtime 凭据替代。
2. 保存响应中的 `roleName/database/schema/jdbcUrl/password/expireTime`。`password` 只在新签发或轮换时一次性返回，不入仓、不写日志；`jdbcUrl` 形如 `jdbc:postgresql://<host>:<port>/<database>`，由 DC 返回开发机可访问的外部地址。
3. psql 按 JDBC 地址拆解 host/port，并从响应取库名和账号：

   ```bash
   PGPASSWORD='<一次性 password>' psql -h '<host>' -p '<port>' -U '<roleName>' -d '<database>'
   ```

   DBeaver/DataGrip 使用同一组 host、port、database、username、password。连接后将本包 schema 与 PostGIS 公共 schema 加入搜索路径：

   ```sql
   SET search_path TO <schema>, public;
   ```

4. 默认有效期为 8 小时，可按需传 `ttlSeconds=300-86400`。重复 `issue` 命中有效账号时 `newlyIssued=false`，不会再次返回密码；忘记密码或需要续期时经批准调用 `resource_rotate`，结束调试时调用 `resource_revoke`。
5. PostGIS 与 TimescaleDB 由 DC 数据布设链自动幂等提供；普通开发角色不得自行安装其他扩展。直连仅用于授权范围内的查看和调试，正式建表/迁移仍写入 `data/sql/*.sql` 随发布执行。

**验收**：
- [ ] 使用本人临时账号从开发机连接成功，只能访问获授权的团队/包范围；响应地址为外部可连地址
- [ ] 重复 issue 不泄露密码，rotate 后旧密码失效，revoke 后账号不可登录；凭据未进入 Git、日志或截图
- [ ] 空间类型/函数与 TimescaleDB 可按需使用；正式表结构和数据迁移仍由发布回执及真实业务接口验证

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

> 团队经 DC 自助发布到共享开发调试环境，并在本地/联调证据经人工确认后批准后端部署；生产发布由平台管理员执行。团队提测时负责把材料备齐（L8）。

1. 按 `RELEASE_CHECKLIST.md` 完成自检；
2. 四必备文档齐备，最新版 CHANGELOG 段写明本版变更；
3. 自测证据：构建产物清单 + 测试底座实测截图（球端面板/管理页/接口）；
4. 依赖清单：跨包 dependsOn、第三方服务/密钥注入需求。

**验收**：
- [ ] 版本五处一致（VERSION/manifest.json/frontend package.json/manifest.ts/container build.sh）
- [ ] 注释头合规（L7），署名团队真实邮箱
- [ ] 提测单要素齐全，平台方受理无补件


## R8 使用平台图标

1. 确认 dev-mcp 已登录（`auth_status`；未登录走 `auth_login_start` + `auth_login_wait`）；
2. 调 `icon_search`，用业务中文名/英文名/关键词查找，例如 `{"keyword":"测量"}`；从结果中选 `iconRef`，不要猜名字；
3. 需要核对样式时调 `icon_get`，传 `icon_search` 返回的资产 `name`；`includeSvg=true` 可看 SVG 原文，`includePalette=true` 可取平台色板；
4. 写入代码：工具栏 `manifest.icon` 使用 `iconRef`；普通 Vue 内容用 `AppIcon`；需要临时着色/多图层效果时调 `icon_bake`（只返回 SVG，不保存）；
5. 返回 `requiresInstance=true` 的自定义资产，由使用者在管理面 IconPicker 确认签发后使用 `iconlib:<instanceId>`，Coder 不调用写库接口。

```ts
// frontend/src/manifest.ts
export const manifest = {
  // 其余字段略
  icon: 'calcite:measure'
}
```

```vue
<script setup lang="ts">
import { AppIcon } from '@agrsearth/icon-kit'
</script>

<template>
  <AppIcon name="calcite:measure" :size="20" />
</template>
```

**验收**：
- [ ] 图标名来自 `icon_search` 实查，未猜名；普通 Vue 内容使用 `AppIcon`
- [ ] 需要颜色时优先使用平台色板；`icon_bake` 仅做无状态预览
- [ ] 无图标上传/派生/删除/副本签发调用；自定义副本经用户 IconPicker 确认
- [ ] 实际球端面板中图标可见，深色/浅色场景无方块或布局跳动
