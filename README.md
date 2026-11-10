# AGRSEarth Plugin Template（航遥业务中台插件开发模板仓）

> 本仓是**纯模板**（fork 模型）：各团队经 GitHub「Use this template」生成自己的仓库，
> 在 `extensions/<track>/<tier>/<pkg>/` 自管自开发。测试环境由团队经 developer-center 自助发布；
> 提测后由平台管理员移植验收并执行生产发布。
>
> 套件版本见 `VERSION`，变更见 `CHANGELOG.md`。平台供给物的精确来源见 `.upstream`。

## AI 辅助开发快速开始（推荐）

你不需要先读完所有文档，也不需要先手写脚手架命令。目标流程是：

**接入 AI → 描述业务需求 → 审查方案 → 本地开发与预检 → 批准注册/发布 → 真实页面验收。**

### 1. 准备与自检

先按 [L2 接入准备](docs/L2-接入准备-SSO与开发环境.md) 准备 Node.js、Git 和开发者账号；只有带后端的包才需要 Java 17、Maven 和 Docker。

在仓根执行：

```bash
npm install
npm --prefix tools/dev-mcp install
node tools/agent-doctor.mjs --client kimi   # 可替换 codex/claude/qoder/opencode/trae/codebuddy
npm run check
```

再用 AI 工具**以模板仓根目录为工作区**打开本仓，并信任/批准项目级 MCP。不要只把本仓作为更大工作区的子目录打开；仓内 MCP 配置使用仓根相对路径。

### 2. 把第一段需求发给 AI

```text
请先阅读本仓 AGENTS.md，使用 agrsearth-plugin-dev Skill 和 agrsearth-dev MCP。
先检查 agent-doctor 与 auth_status，有问题先指导我修复。

我要开发 [业务目标]，使用者是 [目标用户]，需要 [球端面板/管理页/后端/数据库]，
数据来自 [数据来源]，验收标准是 [可见、可操作的结果]。

请先追问缺失信息并给出分类、槽位、实现步骤和验收清单。
本轮只做调研和方案；未经我明确确认，不要建包、注册、发布或修改远程环境。
```

还不知道完整需求时，可以说：**“我想做[业务目标]，请通过提问帮我补齐可实现、可验收的需求说明。”**

完整需求模板、对话示例、审批边界和常用提示词见 **[L0 AI 辅助开发](docs/L0-AI辅助开发.md)**。

### 3. 让 AI 登录并检查环境

让 AI 调用 `auth_status`。未登录时走 `auth_login_start` → 浏览器完成统一身份登录 → `auth_login_wait`；登录后用 `team_list` 确认团队。

交互开发不需要手工复制 token；`AGRSEARTH_TOKEN` 主要用于 CI 或命令行发布。网络隔离时的 SOCKS5 通道见 [开发支撑环境说明](test-env/README.md)。

### 4. 按关卡推进

- **方案关卡**：确认 track/tier/delivery、槽位和验收标准后再建包。
- **本地关卡**：AI 完成编码、构建、URL 对账和发布预检，报告真实结果。
- **注册关卡**：你批准后才调用 `package_register`；AI 必须用 `task_get` 跟踪到 ACTIVE。
- **发布关卡**：你批准包、版本、环境和 deploy 选择后才调用 `package_publish`。
- **验收关卡**：构建通过不等于业务通过；必须验证真实球端/管理面/后端行为，并列出未验证项。

首个最小包的逐步实操见 [L3 Quick Start](docs/L3-QuickStart-30分钟跑通.md)。

## 命令行备用路径

不使用 MCP 时，可用同一套 Node 工具完成本地建包、检查和测试环境发布：

```bash
# macOS / Ubuntu
./tools/create-extension.sh my-tool --track tool --tier business --name 我的工具
node tools/publish.mjs extensions/tool/business/my-tool --check-only
./tools/publish.sh extensions/tool/business/my-tool

# Windows CMD / PowerShell
# tools\create-extension.cmd my-tool --track tool --tier business --name 我的工具
# node tools\publish.mjs extensions\tool\business\my-tool --check-only
# tools\publish.cmd extensions\tool\business\my-tool
```

首次发布前仍需完成登录、包注册和发放任务检查。详细流程见 [L3](docs/L3-QuickStart-30分钟跑通.md) 与 [L8 提测与发布](docs/L8-提测与发布.md)。

## 工作模型

1. 用本模板生成团队仓库，不直接向模板仓提交业务插件。
2. 在 `extensions/<track>/<tier>/<id>/` 开发；官方演示包 `wind-field-demo` 禁止提测。
3. 本地执行 `npm run check`、版本校验和发布预检。
4. 经 developer-center 自助发布到共享开发调试环境，完成真实业务验收。
5. 按 [提测规范](extensions/README.md) 提交代码、版本、CHANGELOG、自测证据和依赖清单。
6. 模板升级时将本仓加为 upstream 后合并模板 diff；上游通常不触碰团队包目录，但仍须逐次审查合并结果。

## 仓库组成与维护边界

| 目录/文件 | 内容 | 维护方 |
|:---|:---|:---|
| `extensions/` | 团队能力包工作区、提测规范、官方演示包 | 团队包由团队维护；演示包由模板仓维护 |
| `packages/` | `@agrsearth/*` 共享包：sdk-types/vite-config/ui-utils/admin-sdk/icon-kit/layer-factory/ts-config | **平台同步，勿改** |
| `skeletons/` | tool/system/admin-ui 骨架；建包走脚手架，不手抄 | 模板仓 |
| `tools/` | create-extension、publish、check-extension-versions、agent-doctor 等 Node 工具 | 模板仓；`tools/dev-mcp/` 除外 |
| `tools/dev-mcp/` | 28 个 AI 开发工具的 stdio MCP server | **平台同步，勿改** |
| `backend/`、`container/` 的 `svc-placeholder/` | 后端与镜像骨架占位件 | **平台同步，勿改** |
| `maven-repo/` | vendored com.ruoyi 依赖闭包，后端构建免平台仓 | **平台同步，勿改** |
| `test-env/` | 共享开发调试环境地址、账号、发布与 HMR 说明 | 模板仓 |
| `docs/` | L0 AI 辅助开发 + L1-L10 分层指南 | 模板仓 |
| `AGENTS.md` / `CLAUDE.md` | 跨工具 AI 编码契约 | 模板仓 |
| `.kimi-code/skills/` | 插件开发与 CesiumJS Skill 权威源；七端副本由 parity 工具同步 | 插件 Skill 归模板仓；CesiumJS Skill 由平台同步 |

平台同步内容由平台仓 `scripts/build/sync-template.sh` 单向覆盖；发现问题应回报平台方并修改源头。模板仓与平台仓独立 SemVer，联合验收不要求版本号相同；当前模板版本为 `2.4.0`，精确供给物提交以 `.upstream` 为准。

本仓为公开仓。启用 `git config core.hooksPath .githooks` 后，pre-push 会扫描内网地址与凭据；平台同步脚本也执行泄漏闸口。任何 token、密码、密钥和本机私有配置都不得提交。
