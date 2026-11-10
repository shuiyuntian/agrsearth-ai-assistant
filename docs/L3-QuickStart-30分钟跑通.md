# L3 Quick Start：30 分钟跑通首个能力包

> 版本：2.0.0 ｜ 更新日期：2026-11-10 ｜ 维护口径：模板仓首包 golden path；脚手架、注册、发布或验收链变化时同步

目标：从模板仓创建一个**纯球端、无后端、无管理页**的业务能力包，完成本地构建和预检；经你批准后注册并发布到共享开发调试环境，最后在球端工具栏点出面板。

AI 协作方式、需求模板和审批原则见 [L0 AI 辅助开发](./L0-AI辅助开发.md)。本篇只保留可执行步骤。

## 步骤 0：确认前置条件

- [ ] 已有 SSO 开发者账号、团队归属和开发环境入口，见 [L2](./L2-接入准备-SSO与开发环境.md)。
- [ ] 已以模板仓根目录打开 AI 工作区，并信任/批准项目级 MCP。
- [ ] 已在仓根完成首次安装与检查：

```bash
npm install
npm --prefix tools/dev-mcp install
node tools/agent-doctor.mjs --client kimi   # 按实际客户端替换
npm run check
```

- [ ] 让 AI 调用 `auth_status`；未登录则完成 `auth_login_start` → 浏览器登录 → `auth_login_wait`。
- [ ] 让 AI 用 `team_list` 确认团队。注册包要求你在该团队具有 TEAM_MAINTAINER 及以上角色；普通 DEVELOPER 可开发和发布已归属包，但不能代替团队负责人注册新包。

## 步骤 1：确认最小方案并建包

把下面需求发给 AI：

```text
请创建我的首个最小业务插件：
- 包 ID：my-first-tool
- 名称：我的第一个工具
- track/tier/delivery：tool/business/optional
- 只要球端面板，不需要后端、管理页、数据库和管理菜单
- 本轮只建包并做本地验证，不注册、不发布

请先阅读 AGENTS.md 和适用 Recipe，确认方案后使用 package_scaffold 建包。
```

AI 应说明只生成 `frontend`，并列出将写入的文件。你确认后，AI 调用 `package_scaffold`；等价 CLI 备用命令为：

```bash
./tools/create-extension.sh my-first-tool --track tool --tier business \
  --delivery optional --name 我的第一个工具
# Windows：tools\create-extension.cmd my-first-tool --track tool --tier business --delivery optional --name 我的第一个工具
```

**看到**：生成 `extensions/tool/business/my-first-tool/`。脚手架已替换包 ID、名称、版本、npm 包名和 UMD 全局名；根 `package.json` 的 workspace glob 自动覆盖新包，**不要再手抄骨架或修改 workspaces**。

## 步骤 2：完成一个最小业务修改

让 AI 把骨架面板改为一个可见的业务结果，例如：

```text
请把面板改成“我的首个业务面板”，显示一条静态示例记录，并保留现有面板定位、
contentPadding、AppIcon 和资源清理契约。只修改本包，完成后说明改动文件。
```

骨架入口为 `frontend/src/index.ts`，当前面板组件是其中的 `ExamplePanel`。不要额外引入后端、地图实体或新依赖；本篇先验证完整交付通路。

## 步骤 3：本地构建与发布预检

让 AI 在仓根执行：

```bash
npm install
npm run build -w @agrsearth/ext-my-first-tool
node tools/check-api-contract.mjs extensions/tool/business/my-first-tool
node tools/publish.mjs extensions/tool/business/my-first-tool --check-only
```

使用 dev-mcp 时，预检可改由 `package_precheck` 执行；无公开后端时，URL 对账工具会按实际结构给出跳过或检查结果，不应伪造后端接口。

**验收点**：

- `frontend/dist/tool.es.js`、`tool.umd.js` 和 `tool.css` 存在；
- ESM 产物没有打包宿主共享依赖；
- manifest、VERSION、frontend/package.json、frontend/src/manifest.ts 和 CHANGELOG 最新段均为 `0.1.0`；
- 发布预检通过。

## 步骤 4：批准注册并等待发放完成

让 AI 先展示注册参数：包 ID、名称、分类、归属团队，以及 `postgres=false`、`menu=false`。确认后回复：

```text
批准将 my-first-tool 注册到当前团队，不申请 PostgreSQL 和菜单资源位。
```

AI 调用 `package_register` 后，必须用返回的 `provisionTaskId` 调用 `task_get`，直到任务为 `ACTIVE`。HTTP 200 只表示受理；`PENDING/PARTIAL/ERROR` 都不能当作注册完成。

> 如果以后需要管理菜单或 PostgreSQL，必须在首次注册时把对应资源开关设为 true。注册后不能直接重注册补资源位；处置方式见 L8/L9，不要擅自删除已有包。

## 步骤 5：批准发布到共享开发调试环境

让 AI 再次预检并说明将发布的包目录、版本和目标环境。确认后回复：

```text
批准将 my-first-tool 0.1.0 发布到共享开发调试环境；本次无后端，不执行部署。
```

AI 调用 `package_publish`。等价 CLI 备用命令为：

```bash
# 已配置 AGRSEARTH_TOKEN 时使用；交互开发优先让 AI 复用 dev-mcp 登录态
./tools/publish.sh extensions/tool/business/my-first-tool
# Windows：tools\publish.cmd extensions\tool\business\my-first-tool
```

发布器只连接 developer-center，不接受生产参数。发布后应看到产物上传、release-complete 和发布冒烟成功。

## 步骤 6：真实球端验收

打开开发支撑环境的球平台，入口见 `test-env/README.md`：

- [ ] 工具栏出现“我的第一个工具”；
- [ ] 点击后显示步骤 2 的面板内容；
- [ ] 再次点击停用，面板隐藏；重复激活/停用无异常；
- [ ] 浏览器控制台无远程加载或裸依赖解析错误。

AI 有浏览器能力时可执行并附证据；没有能力时必须给出上述人工步骤并标注“待人工验证”，不能用发布冒烟替代业务验收。

## 步骤 7：继续迭代或提测

- 继续改前端：按 `test-env/README.md` 的 HMR 回路，用 watch + vite preview 和 `--dev-url`；有随包 CSS 时同时传 `--dev-css-url`，结束后恢复正式入口。
- 准备提测：按 `RELEASE_CHECKLIST.md` 和 [L8](./L8-提测与发布.md) 整理代码、CHANGELOG、实测证据和依赖清单。
- 生产发布由平台管理员执行；团队自助发布不会触发生产。

## 常见卡点

- **doctor FAIL**：先按输出安装 dev-mcp 依赖、同步 Skill 或修正客户端接入。
- **构建找不到 `@agrsearth/*`**：在仓根重新执行 `npm install`，确认包目录符合 workspace glob；不要新增分包 lockfile。
- **注册提示团队角色不足**：让 TEAM_OWNER/TEAM_MAINTAINER 完成注册，再授权开发者发布。
- **注册后没有菜单号段**：本例 `menu=false` 属预期；需要菜单的包必须在注册时声明。
- **工具栏没有图标**：按 [L9](./L9-FAQ与排错.md) 检查发布结果、清单、产物 URL 和浏览器控制台。
- **国际依赖下载失败**：保留原始错误，按 L9 检查并复用本机已有代理；团队默认 Clash，但不假定固定端口，不擅自修改系统代理。
