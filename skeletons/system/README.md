# 示例系统（骨架）

> 系统轨能力包最小骨架（track: system / tier: business）：管理面远程页 + 多后端服务 +
> 组件版本轴 + k8s-bundle + 数据/菜单声明。建包使用脚手架，不整目录手抄。

**两轨判据是体量，不是形态**：工具轨至多一个自建后端；系统轨用于多服务、三方组件或子系统级需求。系统轨也可以有球端面板，需要时由脚手架生成或按当前工具链补齐，并把 `components.frontend` 置 true。

## 脚手架与实例化

- 使用 dev-mcp `package_scaffold` 或 `tools/create-extension.sh <pkg> --track system --tier <tier>`；
- 脚手架生成包目录、manifest、版本、管理页、后端/镜像骨架与部署样例，并替换占位符；
- `backend/<svc>/` 从 `backend/svc-placeholder/` 实例化，`container/<svc>/` 与 serviceId 一致；
- 根 workspace glob 自动覆盖 frontend/admin-ui，建包后在仓根执行 `npm install`。

## 目录

- `manifest.json`：track/tier + components 显式声明 + backendServices 多组件
- `VERSION`：包版本唯一事实源
- `admin-ui/`：管理面远程页，产物 admin.es.js/admin.umd.js/style.css
- `backend/`：可运行 Spring Boot 骨架，服务数与 backendServices 一致
- `container/<svc>/`：组件镜像构建目录与组件版本轴
- `deploy/k8s/`：k8s-bundle，白名单见 `deploy/k8s/README.md`
- `data/menu.json`：菜单声明样例

模板团队包需要菜单时，在首次 `package_register` 设置 `menu=true`，由 developer-center 自动分配本包号段；`task_get` 到 ACTIVE 后用 `resource_list` 实查并填写 menuId。不要照抄骨架示意号段。

## 多组件部署惯例

1. 包内组件互调走集群内 Service DNS，不经网关；
2. 非密共享配置用包级 ConfigMap，经 `envFrom.configMapRef` 引入；
3. 凭据用 `secretKeyRef` 引用平台方预建 Secret，只引用不创建。

## 开发

1. 后端本地构建和调试优先；镜像构建使用包内 `container/<svc>/`。
2. 前端与管理页依赖由仓根 npm workspace 统一安装。
3. 测试环境由团队经 developer-center 自助发布；自测通过后按 `docs/L8-提测与发布.md` 提测，生产由平台管理员发布。
