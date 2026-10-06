# 发布前自检清单（RELEASE CHECKLIST）

> 团队自测通过后、提交提测单**之前**逐项勾选。平台方将按本清单 + 平台仓
> `docs/运维手册/2-部署与变更/PLUGIN_ACCEPTANCE.md` 复核，任一项不过即退回补件。

## 1. 元数据与版本

- [ ] 四必备齐备：`manifest.json` / `VERSION` / `README.md` / `CHANGELOG.md`（最新段写明本版变更）
- [ ] 版本五处一致：`VERSION` ↔ `manifest.json` ↔ `frontend/package.json` ↔ `frontend/src/manifest.ts` ↔ `container/<svc>/build.sh`
- [ ] manifest `track`/`tier`（+按需 `delivery`）显式必填，且与包目录 `extensions/<track>/<tier>/<pkg>/` 一致
- [ ] `components` 段与实际结构一致：frontend/backend[]/adminUi/menu{enabled,menuPath}/data 逐字段核对
- [ ] `backendServices[].serviceId` 与 `components.backend[]` 完全一致；apiPrefix/healthEndpoint 可访问

## 2. 构建与产物

- [ ] `npm install && npm run check` 通过（无类型错误、无构建失败）
- [ ] 球端产物 `tool.es.js/tool.umd.js` 存在；管理页产物 `admin.es.js/admin.umd.js` 存在（如有）
- [ ] 产物 grep：仅 external import `vue`/`@/utils/request` 等，无 element-plus/cesium/echarts 被打进

## 3. 契约红线自查（源码 grep）

- [ ] 无 `viewer.entities.add` / `scene.primitives.add`（实体/Primitive 走 ctx）
- [ ] 无 `createApp`、无 `import.meta.env`（admin-ui 内）
- [ ] 无 `latest` 镜像 tag；无硬编码密钥/token/密码
- [ ] 每个 k8s workload 显式 `TZ=Asia/Shanghai`；deploy/k8s 无 Secret/RBAC/CRD/Namespace

## 4. 文档与规范

- [ ] 代码文件注释头合规（五要素 + 版权行；.vue 头部邮箱用全角括号，不用尖括号）
- [ ] README 与实现一致（结构/后端服务/数据脚本/构建命令）
- [ ] UI 走查符合 docs/L10（管理页四段式 / 面板几何约定与深色主题）
- [ ] 含中文 SQL 均文件方式执行，脚本头部有命令样例

## 5. 自测证据（随提测单提交）

- [ ] 测试底座实测截图：球端面板打开/交互、管理页列表/表单、关键接口 200
- [ ] 反复激活/停用 5 次无泄漏；停用后现场整组不可见
- [ ] 依赖清单：跨包 dependsOn / 第三方服务与密钥注入需求 / 网关路由新增 / 菜单号段申请
- [ ] 回滚说明：上一稳定版验证点；数据变更有反向 SQL 或声明不可回滚点
