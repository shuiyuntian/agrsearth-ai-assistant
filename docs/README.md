# 插件开发指南（L0-L10）

> 版本：1.1.0 ｜ 更新日期：2026-11-10 ｜ 维护口径：模板仓文档门户；新增、改名或调整文档职责时同步目录
>
> - **给人看的**：L0 教用户如何指挥 AI；L1-L10 提供平台知识、实操、契约和排错。
> - **给 AI Coding 看的**：`AGENTS.md` + 七端同源 Skill + [跨 Agent 能力一致性](./AGENT_PARITY.md)。

平台契约的权威详版在平台仓 `docs/插件开发指南/4-契约参考/PLUGIN_DEVELOPMENT.md`。本仓文档和示例应与当前源码同步；平台仓路径用于维护者溯源，外部团队只克隆本仓也可按 L0-L10 完成开发。

## 阅读顺序

| 层 | 文档 | 内容 | 什么时候读 |
|:---|:---|:---|:---|
| L0 | [L0-AI辅助开发.md](./L0-AI辅助开发.md) | 首次接入、需求模板、对话示例、审批关卡、完成证据 | **新用户先读** |
| L1 | [L1-平台介绍.md](./L1-平台介绍.md) | 定位/架构/环境拓扑/双轨模型/名词表 | 首次接触平台 |
| L2 | [L2-接入准备-SSO与开发环境.md](./L2-接入准备-SSO与开发环境.md) | 开发者账号、工具链、模板获取、登录与网络 | 开工前 |
| L3 | [L3-QuickStart-30分钟跑通.md](./L3-QuickStart-30分钟跑通.md) | 首个最小能力包：建包、预检、注册、发布、验收 | 第一个插件 |
| L4 | [L4-概念手册.md](./L4-概念手册.md) | Capability 框架/生命周期/分组隔离/远程页 | 理解机制 |
| L5 | [L5-开发Recipes.md](./L5-开发Recipes.md) | 任务级 how-to（R1-R8），每条带验收 checklist | 干活时随查 |
| L6 | [L6-参考契约.md](./L6-参考契约.md) | ctx API 表/manifest schema/SDK 包 | 查契约 |
| L7 | [L7-工程规范.md](./L7-工程规范.md) | 分支/提交/CHANGELOG/版本一致/注释头 | 写代码全程 |
| L8 | [L8-提测与发布.md](./L8-提测与发布.md) | 测试自助发布、生产提测、HMR、回滚 | 自测通过后 |
| L9 | [L9-FAQ与排错.md](./L9-FAQ与排错.md) | 构建/运行/发布/网络问题定位 | 出问题时 |
| L10 | [L10-UI规范.md](./L10-UI规范.md) | 管理面与球端 UI 规范 | 写任何 UI 前 |

**最小路径**：L0 → L3。后续按任务查 L5/L6/L9，不必线性通读全部篇章。

## 生成 HTML 评审件

四必备文档（README/CHANGELOG/DESIGN/REPORT）可用公共工具一键转 HTML（默认页脚「航遥业务中台」）：

```bash
python3 tools/md-to-html.py README.md README.html
python3 tools/md-to-html.py README.md README.html --footer "XX团队提测件"
npm run docs:html   # 本指南 L*.md → docs/html/
```

## 模板仓结构

```text
├── packages/          @agrsearth/* 本地 workspace 共享包（平台同步，勿改）
├── extensions/        团队能力包工作区 + wind-field-demo 示例
├── skeletons/         tool / system / admin-ui 骨架
├── tools/             建包、检查、发布、agent-doctor 与 dev-mcp
├── test-env/          共享开发调试环境说明
├── docs/              L0-L10 + AGENT_PARITY.md
└── .kimi-code/skills/ Skill 权威源（七端副本由 parity 工具同步）
```
