# 插件开发指南（L1-L10）

> 航遥业务中台 · 插件多团队并行开发支撑体系（专项 5）· 双受众分层文档
>
> - **给人看的**：本目录 L1-L10 图文并茂（截图素材随批次 2 实拍替换，占位图已标注）；
> - **给 AI Coding 看的**：`.kimi-code/skills/agrsearth-plugin-dev/SKILL.md`（触发条件 + 契约红线 + recipe 索引 + 每步验收 checklist）。
>
> 权威详版始终是平台仓 `docs/插件开发指南/4-契约参考/PLUGIN_DEVELOPMENT.md`；本文档面向插件开发团队，冲突时以平台仓最新版为准。

## 分层索引

| 层 | 文档 | 内容 | 什么时候读 |
|:---|:---|:---|:---|
| L1 | [L1-平台介绍.md](./L1-平台介绍.md) | 定位/架构/环境拓扑/双轨模型/名词表 | 首次接触平台 |
| L2 | [L2-接入准备-SSO与开发环境.md](./L2-接入准备-SSO与开发环境.md) | SSO 开发者账号、角色、登录、API token | 开工前 |
| L3 | [L3-QuickStart-30分钟跑通.md](./L3-QuickStart-30分钟跑通.md) | 对着 aiearth02 ext-dev 共享调试环境跑通样例 | 第一个插件 |
| L4 | [L4-概念手册.md](./L4-概念手册.md) | capability 框架/生命周期/分组隔离/远程页 | 理解机制 |
| L5 | [L5-开发Recipes.md](./L5-开发Recipes.md) | 任务级 how-to（7 条），每条带验收 checklist | 干活时随查 |
| L6 | [L6-参考契约.md](./L6-参考契约.md) | ctx API 表/manifest schema（含 components 段）/SDK 包 | 查契约 |
| L7 | [L7-工程规范.md](./L7-工程规范.md) | 分支/提交/CHANGELOG/版本五处一致/注释头规范 | 写代码全程 |
| L8 | [L8-提测与发布.md](./L8-提测与发布.md) | 提测制流程/提测单模板/回滚 | 自测通过后 |
| L9 | [L9-FAQ与排错.md](./L9-FAQ与排错.md) | 常见坑与定位路径 | 出问题时 |
| L10 | [L10-UI规范.md](./L10-UI规范.md) | 18850 管理页规范 + 球端面板规范（正/反例） | 写任何 UI 前 |

## 生成 HTML 评审件

四必备文档（README/CHANGELOG/DESIGN/REPORT）可用公共工具一键转 HTML（默认页脚「航遥业务中台」）：

```bash
python3 tools/md-to-html.py README.md README.html                 # 默认页脚
python3 tools/md-to-html.py README.md README.html --footer "XX团队提测件"
npm run docs:html                                                  # 本指南全部 L*.md → docs/html/
```

## 模板仓结构

```text
├── packages/          @agrsearth/* 本地 workspace 共享包（sdk-types/vite-config/ui-utils/admin-sdk）
├── skeletons/         tool / system 双轨最小骨架 + 通用 admin-ui 骨架（复制即用）
├── tools/             md-to-html.py 公共文档工具
├── docs/              本指南（images/ 为截图素材目录）
└── .kimi-code/skills/ agrsearth-plugin-dev（AI Coding 契约红线与 recipe 索引）
```
