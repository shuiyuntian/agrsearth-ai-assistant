# packages/ 目录：你的扩展包住这里

`packages/` 下有两类目录，规则只有一条：**`@cesiumai/` 前缀目录是平台供给物，勿改勿删**。

| 目录 | 归属 | 说明 |
|:---|:---|:---|
| `@cesiumai/sdk-types` / `@cesiumai/vite-config` / `@cesiumai/ui-utils` / `@cesiumai/admin-sdk` | 平台供给（vendored） | Capability 类型契约 / 双端构建工厂（含宿主 host-contract 快照）/ 简繁工具 / 管理页运行时契约。与平台仓 `extensions/_shared/*` 同源同步，升级随模板仓重发 |
| `<你的包 id>/` | 你的团队 | 用 `tools/create-extension.sh` 生成（工具轨/系统轨骨架 + 可选后端/管理页）， npm workspace glob（`packages/*/frontend`、`packages/*/admin-ui`）自动覆盖，无需手改仓根 workspaces |

## 建包

```bash
./tools/create-extension.sh <pkg-id> --track tool|system --tier platform|business \
    [--delivery bundled|optional] [--name <中文名>] [--with-backend] [--with-admin-ui]
```

包 id 规则：小写字母 / 数字 / 中划线（如 `wind-field`）；track/tier 语义见 `docs/L1-平台介绍.md`。

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
5. **@cesiumai/* 供给物零改动**：PR 中 `packages/@cesiumai/` 必须无 diff。
