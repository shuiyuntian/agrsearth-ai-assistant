# 跨 Coding Agent 能力一致性

> 目标：Kimi Code、Codex、Claude Code、Qoder、OpenCode、Trae、CodeBuddy 使用本项目完成插件开发时，**任务结果与验收标准一致**。
> 不要求各产品的界面、权限审批交互或模型推理过程完全相同。

## 1. 权威源与适配入口

| 能力 | 权威源 | 客户端入口 |
|---|---|---|
| 项目契约与常用命令 | 仓根 `AGENTS.md` | Claude Code 经 `CLAUDE.md` 指针读取；其余工具按各自项目规则机制读取 |
| 插件开发 Skill | `.kimi-code/skills/agrsearth-plugin-dev/SKILL.md` | Kimi=权威源；Codex=`.codex/skills/`；OpenCode=`.opencode/skills/`；Claude=`.claude/skills/`；Qoder/Trae/CodeBuddy 分别用各自项目目录；`.agents/skills/` 为 agentskills.io 通用入口 |
| CesiumJS 技能（14 领域+orientation，平台仓 vendor 同步） | `.kimi-code/skills/cesiumjs-*`、`.kimi-code/skills/using-cesiumjs-skills/`（源头：平台仓 `scripts/build/sync-template.sh` 单向同步，pin 见 `.kimi-code/skills/.cesiumjs-skills-upstream`，**勿手改**） | 与插件开发 Skill 同通道分发 7 端副本 |
| MCP 工具 | `tools/dev-mcp/server.mjs`（平台仓源头 `mcps/agrsearth-dev/`） | 全部客户端共享同一 stdio server 与工具清单 |
| 开发/排错/验收知识 | `docs/L1-L10`、`RELEASE_CHECKLIST.md` | 所有客户端直接读取，不依赖 Skill 才能获取 |

权威源 `.kimi-code/skills/` 下全部技能（含 cesiumjs-*）与 7 端副本目录树必须逐字节一致。
不要单独修改任何客户端目录下的副本；改 Skill 只改 `.kimi-code/skills/` 权威源
（cesiumjs-* 源头在平台仓，须报平台方），然后运行 `node tools/check-agent-parity.mjs --fix`
单向同步副本，再以 `node tools/check-agent-parity.mjs` 复核。

## 2. 目录收敛原则

- **每端用各自官方自动发现目录**：Codex=`.codex/skills`、OpenCode=`.opencode/skills`、Claude=`.claude/skills`、
  Qoder/Trae/CodeBuddy 同理；`.agents/skills` 保留为 agentskills.io 通用入口，覆盖其余兼容客户端。
  不依赖任何「跨目录兼容发现」的隐式行为。
- **MCP 同理收敛**：Claude Code 与 CodeBuddy 共用仓根 `.mcp.json`，不维护两份同内容配置。
- **固定目录只做发现适配**：各端目录由客户端自动发现机制决定，不能强行合并；
  它们只是同内容副本，不是独立事实源。
- **不以 symlink 为默认方案**：Windows 开发机权限和 Git 对 symlink 的支持不一致，当前采用同内容文件 +
  `check-agent-parity.mjs --fix` 同步 + 一致性闸口。
- **docs/ 与 LICENSE 只留权威源**：`.kimi-code/skills/docs/`（DOMAINS.md 等参考件）与
  `cesiumjs-skills.LICENSE` 不做 7 端副本——Skill 内引用为仓根相对路径，从任一端加载均可解析。

## 3. MCP 接入

先执行 `cd tools/dev-mcp && npm install`（`agent-doctor` 会把缺依赖判为 FAIL 并给出该修复命令），然后在模板仓根选择客户端：

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

各端 MCP 配置使用仓根相对路径（Trae 已用 `${workspaceFolder}`），**须以模板仓根目录为工作区打开**；
嵌套为子目录打开会导致 MCP server 启动失败。Windows 建包入口为 `tools\create-extension.cmd`
（Node 薄 shim，无需 Git Bash；dev-mcp 1.6.2 起 `package_scaffold` 也直调 node，Windows 全链零 bash 依赖）。

## 4. 接入自检

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
回查 `CODEX_HOME/config.toml`。任一客户端缺 MCP、Skill 漂移或 dev-mcp 依赖未安装都会返回非零退出码。
当前 dev-mcp 本地通道已全量 Node 化，Windows 不再额外要求 Git Bash。

## 5. 统一任务验收矩阵

| 任务 | 统一操作/判定 | 副作用 |
|---|---|---|
| 读取规则 | agent 能说明目录约定、八条红线、默认工作流和验收入口 | 无 |
| 需求与方案 | 新包先澄清业务与验收，给出分类/槽位/范围；用户确认后才实施 | 无 |
| 创建插件 | 使用 `package_scaffold` 或 `create-extension.sh`，产物落在 `extensions/<track>/<tier>/<id>/` | 本地可逆 |
| 构建预检 | `npm run check`、`package_precheck`、URL 契约对账全部通过 | 无 |
| 原生登录 | `auth_login_start` 返回完整链接和 loginId；`auth_login_wait` 落盘；`auth_status` 复核身份 | 本地凭据 |
| 本地/共享联调 | 后端先本机验证；接共享 Nacos 时说明路由、负载均衡、双向可达与注销责任 | 共享注册需告知 |
| 注册 | 经批准调用 `package_register`，`task_get` 到 ACTIVE 后才视为完成 | **有，需审批** |
| 实例诊断 | `instance_list` / `instance_logs` 可访问已授权实例，中文正常，`tailLines` 生效 | 无 |
| 发布与部署 | 经批准调用 `package_publish`；后端 deploy=true 须在本地证据人工确认后另行批准 | **有，需审批** |
| 业务验收 | 管理面、球端、权限、读写链路符合 `RELEASE_CHECKLIST.md`，并报告未验证项 | 按环境授权 |

同一任务允许使用客户端各自的原生命令或 Skill 触发方式，但不允许绕过共享 MCP/脚本而使用一套私有实现。

## 6. 提交前闸口

```bash
node tools/check-agent-parity.mjs
node --test tests/unit/agent-parity.test.mjs
npm run check
npm run test:publish
```

修改 Skill 后必须运行 `node tools/check-agent-parity.mjs --fix` 同步 7 端副本；修改 MCP 工具后必须重跑
doctor 与任务矩阵。Windows 至少使用真实 Qoder
完成一次登录、预检和发布验收；Mac/Linux 通过不能替代 Windows 结论。
