# extensions/ 目录：你的扩展包工作区

`extensions/` 是 fork 模型下**你团队的插件工作区**，目录规则与平台仓完全同构：

```
extensions/<track>/<tier>/<pkg-id>/
```

- `track`：`tool`（工具轨，轻量：≤1 自建后端、不引入复杂三方组件）｜ `system`（系统轨，子系统级）
- `tier`：`platform`（平台归属）｜ `business`（业务归属）
- `pkg-id`：小写字母 / 数字 / 中划线（如 `my-tool`）

与 manifest.json 的 `track`/`tier`/`id` 三字段逐段一致——`tools/publish.sh` 发布时硬校验
（「目录==track/tier」闸口）。验收通过后，平台管理员把你的包目录**纯拷贝**移植进平台仓
同名路径，零映射零改写。

本目录下的官方内容：`tool/business/wind-field-demo/`（演示包，可发开发支撑环境验证环境通路，
**禁止提测**）。

## 建包

```bash
./tools/create-extension.sh <pkg-id> --track tool|system --tier platform|business \
    [--delivery bundled|optional] [--name <中文名>] [--with-backend] [--with-admin-ui]
```

## 提测规范（PR / 提测单模板）

向平台方提交提测（PR 或压缩包）时，正文按此模板填写：

```markdown
# 提测单：<pkg-id> v<x.y.z>

- 团队/负责人：<团队名> / <姓名>
- 包 id / track / tier（/ delivery）：<pkg> / tool|system / platform|business（/ bundled|optional，仅 tool·business）
- 版本：<x.y.z>（VERSION / manifest.json / frontend/package.json / manifest.ts 一致，附
  ./tools/check-extension-versions.sh 输出截图）
- manifest 关键段截图：components 显式段 + backendServices（管理面「扩展详情」页截图亦可）
- 自测清单（逐项勾选， evidence 附截图/输出）：
  - [ ] npm install && npm run check 通过
  - [ ] 球端面板在测试底座可打开、可交互（附截图）
  - [ ] 管理页（如有）列表/表单可用（附截图）
  - [ ] 后端接口（如有）关键路径 200
  - [ ] 反复激活/停用 5 次无泄漏；停用后现场整组不可见
  - [ ] 契约红线 grep：无 viewer.entities.add / createApp / import.meta.env（admin-ui 内）/ 硬编码密钥
  - [ ] data/menu.json 通过 tools/menujson.py validate（如声明菜单）
- 依赖清单：跨包 dependsOnPackages / 第三方服务与密钥注入需求 / 网关路由新增 / 菜单号段申请
- 已知问题与限制：…
```

## 验收清单（平台方按此复核，团队先自查）

1. **元数据**：四必备（manifest/VERSION/README/CHANGELOG）齐备；track/tier（+delivery）显式必填合法。
2. **components 显式段**与实际结构逐字段一致（frontend/backend[]/adminUi/menu{enabled,menuPath}/data）。
3. **产物**：external 干净（vue/@/utils/request 等宿主依赖未被打进）；无 `latest` 镜像 tag。
4. **红线**：实体只走 ctx.entities；admin-ui 不自建 createApp、不烘焙 import.meta.env；
   k8s workload 显式 `TZ=Asia/Shanghai`；deploy/k8s 无 Secret/RBAC/CRD/Namespace。
5. **目录闸口**：包路径 == `extensions/<track>/<tier>/<id>`（publish.sh 会校验，提测前自查）。
6. **@agrsearth/* 供给物零改动**：PR 中 `packages/` 必须无 diff。
