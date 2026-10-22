# 风场（wind-field-demo）

tool 轨能力包（track: tool，tier: business，delivery: optional）。
脚手架由 tools/create-extension.sh 生成（模板仓），本包是**官方全槽位示例**：
球端面板 + 管理页 + 后端微服务 + 菜单声明四槽位齐备，可作二次开发参照。

## 功能

- **球端面板**：加载样例风场数据（13×13 经纬度网格 u/v 分量），渲染风向箭头
  （杆 + 双翼折线）与网格粒子点，颜色按风速绿→红映射；面板含图层开关、
  风速图例、数据时间戳与统计概览；激活自动飞到数据范围。
- **管理页**：插件信息 / 运行状态 / 数据信息（数据更新时间等）三张卡片，
  数据经后端 `/wind-field-demo-server/wind/sample-meta` 拉取，后端不可达时降级展示。
- **后端**：`wind-field-demo-server` 微服务；`/info` 自检 + `/wind/sample-meta`
  样例数据元信息（读 classpath 下 `wind-sample.json`，与前端
  `frontend/src/assets/wind-sample.json` 同源同构）。

## 目录

- manifest.json      能力包清单（track/tier/delivery+components 显式段；发布时 entries.url 自动回填）
- VERSION            包版本唯一事实源
- frontend/          球端 Capability 工程（cd frontend && npm run build）
- admin-ui/          管理面远程页（cd admin-ui && npm run build）
- backend/wind-field-demo-server/   后端微服务（mvn package；com.ruoyi 构件由仓根 maven-repo/ 供给）
- container/wind-field-demo-server/   镜像构建（Dockerfile+build.sh+VERSION 组件版本轴）
- data/menu.json     管理面菜单声明（号段示意值 2004000 段，正式号段提测时管理员分配）

## 数据契约

- 样例数据：`frontend/src/assets/wind-sample.json`（打包内联进产物）与
  `backend/wind-field-demo-server/src/main/resources/wind-sample.json`（classpath）；
  两份由同一生成脚本产出，改数据时**两处同步改**（结构：meta + u/v 二维数组）。
- 合成数据仅作演示，非实况。

## 开发 → 发布

1. 仓根 npm install（workspace glob 自动覆盖本包 frontend/admin-ui）
2. 开发自测（RELEASE_CHECKLIST.md）
3. ./tools/check-extension-versions.sh
4. ./tools/publish.sh packages/wind-field-demo（仅测试底座；生产发布由平台管理员执行）
