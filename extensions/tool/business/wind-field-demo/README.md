# 风场（wind-field-demo）

tool 轨能力包（track: tool，tier: business，delivery: optional）。本包是**官方全槽位示例**：球端面板 + 管理页 + 后端微服务 + 菜单声明齐备，供二次开发参照，禁止作为业务包提测。

## 功能

- **球端面板**：加载样例风场数据（13×13 经纬度网格 u/v 分量），渲染风向箭头与网格粒子点，颜色按风速绿→红映射；含图层开关、风速图例、数据时间戳与统计概览。
- **管理页**：插件信息、运行状态、数据信息三张卡片；数据经后端 `/wind-field-demo-server/wind/sample-meta` 拉取，后端不可达时降级展示。
- **后端**：`wind-field-demo-server` 微服务；`/info` 自检与 `/wind/sample-meta` 样例数据元信息。

## 目录

- `manifest.json`：能力包清单，发布时回填 entries
- `VERSION`：包版本唯一事实源
- `frontend/`：球端 Capability 工程
- `admin-ui/`：管理面远程页
- `backend/wind-field-demo-server/`：后端微服务
- `container/wind-field-demo-server/`：镜像构建与组件版本轴
- `data/menu.json`：菜单声明；其中 2004000 段仅为演示示意值，禁止复制到业务包

模板团队业务包的菜单号段由 `package_register`（menu=true）自动分配，并经 `resource_list` 实查；不要照搬本演示值。本演示包的发布和清理由平台维护者按环境授权执行。

## 数据契约

样例数据位于 `frontend/src/assets/wind-sample.json` 与后端 classpath 的 `wind-sample.json`，两处结构同构。合成数据仅作演示，非实况。

## 开发 → 发布

1. 仓根 `npm install`，workspace glob 自动覆盖本包 frontend/admin-ui；
2. 按 `RELEASE_CHECKLIST.md` 自测；
3. `./tools/check-extension-versions.sh`；
4. 经授权发布时使用 `./tools/publish.sh extensions/tool/business/wind-field-demo`，仅共享开发调试环境；生产发布由平台管理员执行。
