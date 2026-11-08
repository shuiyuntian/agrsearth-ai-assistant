# 示例工具（骨架）

> 工具轨能力包最小骨架（track: tool / tier: business / delivery: optional）：球平台面板能力，零/薄后端。
> 使用方式：**整目录复制**为团队仓库中的包目录（如 `packages/my-tool/` 或平台仓 `extensions/<track>/<tier>/<pkg>/`），
> 然后按下文「改名清单」替换占位符。骨架本身可 `npm install && npm run build`。

## 改名清单（复制后必改）

| 位置 | 占位值 | 改为 |
|:---|:---|:---|
| `manifest.json` | `id: "example-tool"`、`name`、`description`、`author` | 包 id（小写字母/数字/中划线）与团队信息 |
| `manifest.json` | `components.*` | 按包真实构成显式声明（见下） |
| `VERSION` | `0.1.0` | 初始版本（唯一事实源） |
| `frontend/package.json` | `name: "agrsearth-plugin-tool-example"` | 包名（平台仓惯例 `@agrsearth/<pkg>`） |
| `frontend/src/manifest.ts` | `id/name/version/description` | 与 manifest.json 一致 |
| `frontend/vite.config.ts` | `name: 'Capability_example'` | `Capability_<pkg-id 去中划线>`，全局唯一 |
| `deploy/k8s/10-example-server.yaml` | `example-server`/`example-tool` 资源名与镜像路径 | 与 `--backend` 服务 id / 包 id 一致（仅带后端的包需要本目录） |

## components 显式声明段（契约，禁止推导）

`components` 与包内实际结构必须一致（publish 时校验），缺省 false：

| 字段 | 含义 |
|:---|:---|
| `frontend` | 有球端面板（本骨架 = true） |
| `backend` | 后端服务 serviceId 数组（无后端 = []） |
| `adminUi` | 有管理面远程页（复制 `skeletons/admin-ui` 进包后置 true） |
| `menu` | `{ "enabled": bool, "menuPath": "..." }`：注册管理面菜单（enabled=true 必须带 menuPath 并配套 `data/menu.json`，菜单号段由平台方分配） |
| `data` | 有数据资产（`data/` 下有建表/种子 SQL、菜单声明 `menu.json`） |

## 目录

- `manifest.json`      能力包清单（components 显式声明段 + entries，发布时 url 自动回填）
- `VERSION`            包版本唯一事实源
- `frontend/`          球端 Capability 工程（可构建骨架，依赖 @agrsearth/* workspace 包）
- `frontend/src/panel.css`  包级随包样式（构建产出 tool.css，发布时自动回填 entries.css.url）；
  标准内容区留白由 `contentPadding: 'default'` 提供，关键布局不只依赖宿主 Tailwind
- `frontend/src/utils/cesium.ts`  Cesium 取用工具（window.Cesium；**禁止裸 import 'cesium'**——
  宿主 import map 无 cesium 键，ESM 产物裸引用会运行时加载失败）
- `data/menu.json`     管理面菜单声明样例（adminUi + menu.enabled=true 时启用；号段须平台方分配，publish 时 menu-provision 幂等落地）
- `deploy/k8s/`        【仅带后端的包】后端部署样例（`10-<svc>.yaml`：ConfigMap+Deployment+Service；
  脚手架 `--with-backend` 自动生成，publish 打包 k8s-bundle；基线见 deploy/k8s/README.md）

## 开发

1. `cd frontend && npm install && npm run dev`（watch 构建；共享包 `@agrsearth/sdk-types`/`@agrsearth/ui-utils`/`@agrsearth/vite-config` 经 npm workspace 本地引用，无需相对路径）
2. 契约红线见 `docs/L5-开发Recipes.md` 与 `.kimi-code/skills/agrsearth-plugin-dev/SKILL.md`
3. 自测通过 → 按 `docs/L8-提测与发布.md` 提交提测单（平台方统一集成发布）
