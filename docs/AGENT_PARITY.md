# 跨 Coding Agent 能力一致性

> 目标：Kimi Code、Codex、Claude Code、Qoder、OpenCode、Trae、CodeBuddy 使用本项目完成插件开发时，**任务结果与验收标准一致**。
> 不要求各产品的界面、权限审批交互或模型推理过程完全相同。

## 1. 权威源与适配入口

| 能力 | 权威源 | 客户端入口 |
|---|---|---|
| 项目契约与常用命令 | 仓根 `AGENTS.md` | Claude Code 经 `CLAUDE.md` 指针读取；其余工具按各自项目规则机制读取 |
| 插件开发 Skill | `.kimi-code/skills/agrsearth-plugin-dev/SKILL.md` | Kimi=权威源；Codex/OpenCode=`.agents/skills/`；Claude=`.claude/skills/`；Qoder/Trae/CodeBuddy 分别用各自项目目录 |
| MCP 工具 | `tools/dev-mcp/server.mjs`（平台仓源头 `mcps/agrsearth-dev/`） | 全部客户端共享同一 stdio server 与工具清单 |
| 开发/排错/验收知识 | `docs/L1-L10`、`RELEASE_CHECKLIST.md` | 所有客户端直接读取，不依赖 Skill 才能获取 |

六个 Skill 实体文件内容必须逐字节一致。不要单独修改 `.agents/`、`.claude/`、`.qoder/`、`.trae/`
或 `.codebuddy/` 下的副本；先改 Kimi Code 权威源，再同步副本并运行 `node tools/check-agent-parity.mjs`。

## 2. 目录收敛原则

- **能共享就不新建**：OpenCode 官方兼容 `.agents/skills` 与 `.claude/skills`，所以不新增 `.opencode/skills`。
- **MCP 同理**：Claude Code 与 CodeBuddy 共用仓根 `.mcp.json`，不维护两份同内容配置。
- **固定目录只做发现适配**：Kimi/Codex/Qoder/Trae/CodeBuddy 的目录由客户端自动发现机制决定，不能强行合并；
  它们只是同内容副本，不是独立事实源。
- **不以 symlink 为默认方案**：Windows 开发机权限和 Git 对 symlink 的支持不一致，当前采用同内容文件 + 一致性闸口。
- **若未来客户端支持自定义共享目录**，再优先收敛到 `.agents/`；不为品牌展示额外制造根目录。

## 2. MCP 接入

先执行 `cd tools/dev-mcp && npm install`，然后在模板仓根选择客户端：

项目级配置已随仓提供，客户端信任/批准项目后即可使用：

| 客户端 | MCP 配置文件 |
|---|---|
| Kimi Code | `.kimi-code/mcp.json` |
| Codex | `.codex/config.toml` |
| Claude Code / CodeBuddy | 共用 `.mcp.json` |
| Qoder | `.qoder/settings.json` |
| OpenCode | `opencode.json` |
| Trae | `.trae/mcp.json`（IDE 中启用项目级 MCP） |

仍可使用各客户端的 `mcp add` 命令配置用户级入口，但不得与项目级配置形成不同实现。
不要把 token 写进 MCP 配置；登录统一使用 `auth_login_start` / `auth_login_wait`，CI 才使用
`AGRSEARTH_TOKEN` 覆盖。

## 3. 接入自检

```bash
# 检查全部客户端；缺配置或未同步 Skill 会列出具体原因
node tools/agent-doctor.mjs

# 只检查当前使用的客户端
node tools/agent-doctor.mjs --client kimi
node tools/agent-doctor.mjs --client codex
node tools/agent-doctor.mjs --client claude
node tools/agent-doctor.mjs --client qoder
node tools/agent-doctor.mjs --client opencode
node tools/agent-doctor.mjs --client trae
node tools/agent-doctor.mjs --client codebuddy

# 自动化读取结构化结果
node tools/agent-doctor.mjs --client qoder --json
```

doctor 只读，不修改用户配置。优先检查仓内项目级配置；缺失时才尝试客户端 `mcp list`，Codex 还会
回查 `CODEX_HOME/config.toml`。任一客户端缺 MCP 或 Skill 漂移都会返回非零退出码。

## 4. 统一任务验收矩阵

| 任务 | 统一操作/判定 | 副作用 |
|---|---|---|
| 读取规则 | agent 能说明目录约定、六条红线和验收入口 | 无 |
| 创建插件 | 使用 `package_scaffold` 或 `create-extension.sh`，产物落在 `extensions/<track>/<tier>/<id>/` | 本地可逆 |
| 构建预检 | `npm run check`、`package_precheck`、URL 契约对账全部通过 | 无 |
| 原生登录 | `auth_login_start` 返回完整链接和 loginId；`auth_login_wait` 落盘；`auth_status` 复核身份 | 本地凭据 |
| 实例诊断 | `instance_list` / `instance_logs` 可访问已授权实例，中文正常，`tailLines` 生效 | 无 |
| 发布 | 经 `package_publish` 走 DC 标准链，不要求手工复制 token | **有，需审批** |
| 业务验收 | 管理页、球端、权限、读写链路符合 `RELEASE_CHECKLIST.md` | 按环境授权 |

同一任务允许使用客户端各自的原生命令或 Skill 触发方式，但不允许绕过共享 MCP/脚本而使用一套私有实现。

## 5. 提交前闸口

```bash
node tools/check-agent-parity.mjs
node --test tests/unit/agent-parity.test.mjs
npm run check
npm run test:publish
```

修改 Skill 后必须同步六份实体文件并覆盖七端；修改 MCP 工具后必须重跑 doctor 与任务矩阵。Windows 至少使用真实 Qoder
完成一次登录、预检和发布验收；Mac/Linux 通过不能替代 Windows 结论。
