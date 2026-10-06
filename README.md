# AGRSCesiumAI Plugin Template（航遥业务中台插件开发模板仓）

> 插件多团队并行开发支撑体系（专项 5）之 C2/C3 交付物。
> 本目录是平台仓 `extensions/_template/`（**同步源**），经
> `scripts/build/export-plugin-template.sh` 导出为独立仓 **AGRSCesiumAI-plugin-template**
> 分发给插件开发团队；升级同样经导出脚本重新下发。
> 套件版本见 `VERSION`（= 导出工具链 + skeletons + 供给物 + docs 整体版本），变更见 `CHANGELOG.md`。

## 组成

| 目录 | 内容 |
|:---|:---|
| `packages/` | 你的扩展包生成位（`packages/<id>/`）+ `@cesiumai/*` 平台供给包（sdk-types / vite-config / ui-utils / admin-sdk，vendored 自平台仓 `extensions/_shared/*`，**勿改**）。共处规则与提测规范见 `packages/README.md` |
| `tools/create-extension.sh` | 本地脚手架：`./tools/create-extension.sh <id> --track tool\|system --tier platform\|business [--with-backend] [--with-admin-ui]`，生成到 `packages/<id>/`（占位符自动替换，后端 pom 自动指向 vendored maven-repo） |
| `tools/publish.sh` | 一键发布（**仅测试底座**）：构建 → MinIO SigV4 直传 → resource-manager 注册；`--dev-url` HMR 调试回路；prod 一律拒绝（生产发布由平台管理员执行） |
| `tools/menujson.py` | menu.json 生成/转换/校验工具（平台仓 `scripts/build/menujson.py` 同步副本） |
| `tools/check-extension-versions.sh` | 包版本与文档一致性校验（packages/ 适配版） |
| `tools/md-to-html.py` | 公共文档工具（README/CHANGELOG/DESIGN/REPORT 一键转 HTML 评审件） |
| `maven-repo/` | vendored file:// Maven 仓：插件后端骨架实际依赖的 com.ruoyi 构件闭包（**com.ruoyi 不在 Maven 中央仓**）；后端 `mvn package` 免平台仓，清单与扩充方式见 `maven-repo/README.md` |
| `test-env/` | 测试底座（agrslab-dev）使用说明：地址表、ext-developer 账号申请、发布通道、`--dev-url` HMR 步骤，见 `test-env/README.md` |
| `skeletons/tool/` | 工具轨最小骨架：manifest（含 components 显式声明段）+ VERSION + 四必备 + 可构建 frontend + data/menu.json 样例 |
| `skeletons/system/` | 系统轨最小骨架：manifest（backendServices 多组件声明）+ container/ 镜像目录 + deploy/k8s 白名单样例 + data/menu.json 样例（backend 源码不入骨架，由 `tools/create-extension.sh` 从 `backend/svc-placeholder/` 实例化） |
| `skeletons/admin-ui/` | 通用管理面远程页骨架（ADR-007；两轨复用，复制为包内 `admin-ui/`） |
| `backend/svc-placeholder/` | 后端微服务骨架模板：最小可运行 Spring Boot 模块（bootstrap.yml + 启动类 + /info 示例控制器；pom 由脚手架改造为 `maven-repo/` file 仓）；占位符表与实例化后必做见其 README |
| `container/svc-placeholder/` | 镜像构建骨架模板：eclipse-temurin:17-jre jar 模式 Dockerfile + build.sh（OCI Label 注入）+ VERSION 组件版本轴，镜像名 `gis-platform/<track>/<tier>/<pkg>/<svc>` |
| `docs/` | L1-L10 分层开发指南（给人看的；截图位为占位图，标注「批次2实拍替换」） |
| `.kimi-code/skills/cesiumai-plugin-dev/` | AI Coding 技能（触发条件 + 契约红线 + recipe 索引 + 每步验收 checklist） |

## 快速开始

```bash
npm install                                   # 安装全部 workspace 依赖（@cesiumai/* 本地包自动链接）
npm run check                                 # 骨架自检：全部骨架可构建即通过
./tools/create-extension.sh wind-field --track tool --tier business \
    --name 风场 --with-backend --with-admin-ui   # 建第一个包（packages/wind-field/）
```

详细流程见 `docs/L3-QuickStart-30分钟跑通.md`；测试底座发布见 `test-env/README.md` + `docs/L8-提测与发布.md`。

## 独立仓初始化方式（平台方操作）

```bash
# 平台仓内执行：导出为独立目录（默认 ../AGRSCesiumAI-plugin-template）
./scripts/build/export-plugin-template.sh
# 或导出 + 打包：
./scripts/build/export-plugin-template.sh --archive

cd ../AGRSCesiumAI-plugin-template
git init && git add -A && git commit -m "chore: init from extensions/_template (sync <日期>)"
# GitHub 远端创建由用户完成（gh repo create 或网页新建后）：
#   git remote add origin git@github.com:<org>/AGRSCesiumAI-plugin-template.git
#   git push -u origin main
# 套件版本 tag（导出脚本会提示）：
#   git tag v$(cat VERSION)+<主仓短sha> && git push origin --tags
```

## 同步约定

- `packages/`（@cesiumai 供给物）、`skeletons/`、`tools/`、`maven-repo/`、`.kimi-code/` 与平台仓
  `extensions/_template/` 保持一致；平台方改进模板后重新导出下发，团队只合并与自己包无关的模板 diff。
- 平台发布涉及 `extensions/_template` 或 `_shared` 变更时必须重跑导出并重发模板仓
  （平台仓 `docs/运维手册/2-部署与变更/变更管理.md` 发版检查单已列项）。
- 文档权威详版：平台仓 `docs/插件开发指南/4-契约参考/PLUGIN_DEVELOPMENT.md`；本仓 `docs/` 面向插件团队。
