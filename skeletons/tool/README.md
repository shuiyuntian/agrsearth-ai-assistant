# 示例工具（骨架）

> 工具轨能力包最小骨架（track: tool / tier: business / delivery: optional）：球平台面板能力，零/薄后端。
> 建包一律使用 dev-mcp `package_scaffold` 或 `tools/create-extension.sh`，不要整目录手抄。

## 脚手架自动完成

- 落位 `extensions/<track>/<tier>/<pkg>/`，替换包 ID、名称、作者占位、版本、npm 包名和 UMD 全局名；
- 按 `--with-backend` / `--with-admin-ui` 生成对应槽位；
- 根 workspace glob 自动覆盖新包 frontend/admin-ui，建包后在仓根执行 `npm install` 即可。

手工复制只用于平台维护者调试骨架，不是团队建包路径。骨架自身可通过 `npm run check` 验证。

## components 显式声明段（契约，禁止推导）

`components` 与包内实际结构必须一致，publish 时校验：

| 字段 | 含义 |
|:---|:---|
| `frontend` | 有球端面板（本骨架 = true） |
| `backend` | 后端服务 serviceId 数组（无后端 = []） |
| `adminUi` | 有管理面远程页（`--with-admin-ui` 时生成并置 true） |
| `menu` | `{ "enabled": bool, "menuPath": "..." }`；enabled=true 必须配套 `data/menu.json` |
| `data` | 有数据资产（建表/种子 SQL、菜单声明等） |

需要菜单的模板团队包在首次 `package_register` 时设置 `menu=true`，developer-center 自动分配本包号段；用 `task_get` 跟踪到 ACTIVE，再以 `resource_list` 实查结果填写 menuId。不要照抄骨架示意号段。

## 目录

- `manifest.json`：能力包清单（components 显式段 + entries，发布时 url 自动回填）
- `VERSION`：包版本唯一事实源
- `frontend/`：球端 Capability 工程
- `frontend/src/panel.css`：包级样式，构建产出 `tool.css`，发布时回填 `entries.css.url`
- `frontend/src/utils/cesium.ts`：经 `window.Cesium` 取用 Cesium，禁止裸 `import 'cesium'`
- `data/menu.json`：菜单声明样例，仅 adminUi + menu.enabled=true 时启用
- `deploy/k8s/`：仅带后端的包使用；脚手架生成，publish 打包 k8s-bundle

## 开发

1. 仓根 `npm install`；包内 `npm run dev` 为 watch 构建，真实球端联调按 `test-env/README.md` 配置 HMR。
2. 契约红线见 `docs/L5-开发Recipes.md` 与 `.kimi-code/skills/agrsearth-plugin-dev/SKILL.md`。
3. 测试环境由团队经 developer-center 自助发布；自测通过后按 `docs/L8-提测与发布.md` 提测，生产由平台管理员发布。
