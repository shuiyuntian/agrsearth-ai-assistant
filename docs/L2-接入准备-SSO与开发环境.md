# L2 接入准备：SSO 与开发环境

> 版本：1.1.0 ｜ 更新日期：2026-11-10 ｜ 维护口径：开发者账号、工具链、模板获取与网络入口；账号或工具版本要求变化时同步

## 2.1 开发者账号与团队

平台用户由 **SSO 统一身份**集中管理，插件开发者账号不走自助注册：

1. **申请**：向平台管理方提交团队、姓名、邮箱、项目和所需角色；
2. **开通**：管理员创建用户并分配开发者角色与初始密码，按提示完成首登改密和 MFA；
3. **团队**：确认自己已加入开发团队。新包注册要求 TEAM_MAINTAINER 及以上；DEVELOPER 可开发并发布已归属团队且有权限的包；
4. **入口**：获取共享开发调试环境的管理面、球平台和网关地址，详见 `test-env/README.md`。

账号锁定、密码重置或 MFA 换机联系统一身份管理员，不在应用侧尝试绕过。

## 2.2 登录与凭据

- 浏览器登录开发环境时，按统一身份页面完成账号、密码和 MFA。
- AI 交互开发优先用 dev-mcp：`auth_status` 检查 → `auth_login_start` → 浏览器登录 → `auth_login_wait`。
- 令牌由 dev-mcp 安全落盘，AI 发布时自动复用；不要把 token 贴进对话、代码、日志或提测单。
- `AGRSEARTH_TOKEN` 用于 CI 或命令行发布覆盖；不要把凭据写入 MCP 配置。

插件前端通过 `ctx.http` 或宿主请求桥自动继承鉴权，业务代码不手工处理 token。第三方密钥不进仓库，由发布和部署通道按声明注入。

## 2.3 开发机准备

| 依赖 | 版本要求 | 适用范围 |
|:---|:---|:---|
| Node.js | ≥ 20，建议 22 | npm workspaces、Node 工具链与 dev-mcp |
| Git | 近期稳定版 | 获取与升级模板仓；`.gitattributes` 固定脚本 LF |
| Java 17 + Maven | JDK 17 + Maven 3.8+ | 仅带后端的包 |
| Docker | 近期稳定版 | 仅自构后端镜像需要 |
| Python 3 | ≥ 3.9 | 仅文档转 HTML 工具需要 |

建包、版本校验、菜单校验和发布均已 Node 化，不需要 jq，也不依赖 Git Bash。Windows 使用 `tools\create-extension.cmd`、`tools\check-extension-versions.cmd` 和 `tools\publish.cmd`。

## 2.4 获取模板仓并完成首次检查

```bash
# 方式 A：平台方下发压缩包
unzip AGRSEarth-plugin-template.zip && cd AGRSEarth-plugin-template

# 方式 B：GitHub「Use this template」生成团队仓，或克隆团队既有仓
git clone <团队模板生成仓地址> && cd AGRSEarth-plugin-template

npm install
npm --prefix tools/dev-mcp install
node tools/agent-doctor.mjs --client kimi   # 按实际客户端替换
npm run check
```

`npm run check` 的 Agent 回归会检查 dev-mcp 依赖，因此第二条安装命令不可省略。之后用 AI 工具**以模板仓根目录为工作区**打开项目，信任或批准项目级 MCP，再按 [L0](./L0-AI辅助开发.md) 开始。

模板采用 fork 模型，团队定制只发生在自己的 `extensions/<track>/<tier>/<pkg>/`。平台同步目录不要手改；模板升级通过 upstream 合并，并逐次审查 diff。

## 2.5 国内开发机访问国际资源

访问国际包仓库、镜像源或文档站点出现超时、连接重置、TLS 或下载失败时，先保留原始错误并排除 URL、凭据、DNS、版本和服务端问题，再检查本机网络。

开发团队默认代理为 Clash。AI 应优先只读检查并复用本机已有 Clash 或其他代理的实际配置，不硬编码端口，不擅自启停代理或修改系统配置。代理仅作用于当前国际资源请求，内网和环回地址保持直连；需要持久配置时由用户确认。

这与访问开发底座时使用的 `AGRSEARTH_SOCKS_PROXY` SSH 动态转发是不同通道，不要混用。详细排错见 [L9](./L9-FAQ与排错.md)。
