# AGRSEarth Plugin Template（航遥业务中台插件开发模板仓）

> 插件多团队并行开发支撑体系（专项 5）之 C2/C3 交付物。
> 本仓是**纯模板**（fork 模型）：各团队经 GitHub「Use this template」生成自己的仓库，
> 在 `extensions/<track>/<tier>/<pkg>/` 自管自开发；测试通过后按提测单提交平台管理员，
> 验收后由管理员纯拷贝移植进平台仓同名路径，生产发布由平台管理员执行。
> 平台供给物（`packages/` 等）由平台仓经 `scripts/build/sync-template.sh` 单向同步下发。
> 套件版本见 `VERSION`，变更见 `CHANGELOG.md`。

## 工作模型（fork 模型六步）

1. 用本模板生成你的仓库（GitHub「Use this template」；不要直接向本仓提交插件包）
2. `./tools/create-extension.sh <id> --track tool|system --tier platform|business ...`
   建包到 `extensions/<track>/<tier>/<id>/`
3. 开发自验：`npm install && npm run check`、`./tools/check-extension-versions.sh`
4. `./tools/publish.sh extensions/<track>/<tier>/<id>` 发共享调试环境（aiearth02 ext-dev）实测
5. 按 `extensions/README.md` 提测单模板提交平台管理员（PR 或压缩包）
6. 模板升级：把本仓加为 upstream 后 `git merge` 拉取模板 diff——你的 `extensions/<你的包>/`
   上游从不触碰，合并零冲突

演示包：`extensions/tool/business/wind-field-demo/`（官方 Demo，可发 ext-dev 验证通路，**禁止提测**）。

## 组成

| 目录 | 内容 | 归属 |
|:---|:---|:---|
| `extensions/` | **你的扩展包工作区**（`extensions/<track>/<tier>/<id>/`，与平台仓布局同构）+ 提测规范（`extensions/README.md`）+ 官方演示包 | 你的团队 |
| `packages/` | `@agrsearth/*` 平台供给包（sdk-types / vite-config / ui-utils / admin-sdk / icon-kit / layer-factory / ts-config，平台仓 `packages/` 同步下发，**勿改**），规则见 `packages/README.md` | 平台同步 |
| `tools/create-extension.sh` | 本地脚手架：`./tools/create-extension.sh <id> --track tool\|system --tier platform\|business [--with-backend] [--with-admin-ui]`，生成到 `extensions/<track>/<tier>/<id>/` | 本仓自有 |
| `tools/publish.sh` | 一键发布（**仅测试底座**）：构建 → MinIO SigV4 直传 → resource-manager 注册；含「目录==track/tier」闸口；`--dev-url` HMR 调试回路；prod 一律拒绝 | 本仓自有 |
| `tools/menujson.py` | menu.json 生成/转换/校验工具（平台仓 `scripts/build/menujson.py` 同步副本） | 平台同步 |
| `tools/check-extension-versions.sh` | 包版本与文档一致性校验（extensions/ 发现制） | 本仓自有 |
| `tools/md-to-html.py` | 公共文档工具（README/CHANGELOG/DESIGN/REPORT 一键转 HTML 评审件） | 本仓自有 |
| `tools/dev-mcp/` | 插件开发辅助 MCP server（平台仓 `mcps/agrsearth-dev/` 同步产物，**勿直接改**） | 平台同步 |
| `maven-repo/` | vendored file:// Maven 仓：插件后端骨架实际依赖的 com.ruoyi 构件闭包（**com.ruoyi 不在 Maven 中央仓**）；后端 `mvn package` 免平台仓，清单与扩充方式见 `maven-repo/README.md` | 平台同步 |
| `test-env/` | 共享开发调试环境（aiearth02 ext-dev）使用说明：地址表、ext-developer 账号申请、发布通道、`--dev-url` HMR 步骤，见 `test-env/README.md` | 本仓自有 |
| `skeletons/tool/` | 工具轨最小骨架：manifest（含 components 显式声明段）+ VERSION + 四必备 + 可构建 frontend + data/menu.json 样例 + deploy/k8s 单后端部署样例（--with-backend 时随包生效） | 本仓自有 |
| `skeletons/system/` | 系统轨最小骨架：manifest（backendServices 多组件声明）+ container/ 镜像目录 + deploy/k8s 白名单样例 + data/menu.json 样例（backend 源码不入骨架，由 `tools/create-extension.sh` 从 `backend/svc-placeholder/` 实例化） | 本仓自有 |
| `skeletons/admin-ui/` | 通用管理面远程页骨架（ADR-007；两轨复用，复制为包内 `admin-ui/`） | 本仓自有 |
| `backend/svc-placeholder/` | 后端微服务骨架模板：最小可运行 Spring Boot 模块（bootstrap.yml + 启动类 + /info 示例控制器；pom 由脚手架改造为 `maven-repo/` file 仓）；占位符表与实例化后必做见其 README | 平台同步 |
| `container/svc-placeholder/` | 镜像构建骨架模板：eclipse-temurin:17-jre jar 模式 Dockerfile + build.sh（OCI Label 注入）+ VERSION 组件版本轴，镜像名 `gis-platform/<track>/<tier>/<pkg>/<svc>` | 平台同步 |
| `docs/` | L1-L10 分层开发指南（给人看的；截图位为占位图，标注「批次2实拍替换」） | 本仓自有 |
| `.kimi-code/skills/agrsearth-plugin-dev/` | AI Coding 技能（触发条件 + 契约红线 + recipe 索引 + 每步验收 checklist） | 本仓自有 |
| `AGENTS.md` / `CLAUDE.md` | 跨工具 AI 编码契约（Codex/qoder/Claude Code 等打开本仓即读；红线与 skill 同源，改红线两处同步） | 本仓自有 |

## 快速开始

> 开发机工具链前提（Node / jq / Python / Java+Maven，含 Windows 注意事项）见
> [`docs/L2-接入准备-SSO与开发环境.md`](docs/L2-接入准备-SSO与开发环境.md) §2.4。

```bash
npm install                                   # 安装全部 workspace 依赖（@agrsearth/* 本地包自动链接）
npm run check                                 # 骨架自检：全部骨架 + 演示包可构建即通过
./tools/create-extension.sh my-tool --track tool --tier business \
    --name 我的工具 --with-backend --with-admin-ui   # 建第一个包（extensions/tool/business/my-tool/）
```

详细流程见 `docs/L3-QuickStart-30分钟跑通.md`；测试底座发布见 `test-env/README.md` + `docs/L8-提测与发布.md`。

## 同步约定

- **归属分界**：「平台同步」列的目录由平台仓 `scripts/build/sync-template.sh` 单向覆盖下发，
  **不要手工改**（改动会在下次同步丢失）；「本仓自有」目录是模板内容，其唯一事实源就是本仓，
  改进直接在本仓提交（平台管理员维护）。
- fork 出去的团队仓：模板升级走 git upstream 合并，只收「本仓自有 + 平台同步」两类 diff，
  你自己的 `extensions/<你的包>/` 不受影响。
- 泄漏闸口：本仓为公开仓，`.githooks/pre-push` 内置内网地址/凭据扫描
  （启用：`git config core.hooksPath .githooks`）；平台侧 sync-template.sh 同步时同样过闸。
- 文档权威详版：平台仓 `docs/插件开发指南/4-契约参考/PLUGIN_DEVELOPMENT.md`；本仓 `docs/` 面向插件团队。
