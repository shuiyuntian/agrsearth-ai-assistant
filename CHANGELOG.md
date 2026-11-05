# 模板仓套件变更记录

> 本文件版本 = 模板仓套件版本（VERSION），含义：skeletons + packages 供给物 + 工具链 + docs 的整体版本。平台供给物由平台仓 `scripts/build/sync-template.sh` 单向同步。

## [Unreleased]

- URL 契约治理（2026-11-05，issues #5/#6/#7）：球端/管理页骨架内置 `src/api/index.ts`；
  新增 Node 跨平台 `tools/check-api-contract.mjs`，公开 Spring Mapping 与前端常量表双向对账并
  接入 `npm run check`、`publish.mjs --check-only` 及正式发布；AGENTS 补症状导航，L5/L8/L9 与
  验收清单同步，公开示例控制器与管理页示例 API 对齐。
- dev-mcp 1.2.3（2026-11-04）：Windows 授权链接改由 `rundll32` 原样打开，避免 `cmd start`
  截断 `&`；SOCKS5 Chrome 直接启动解析后的 chrome.exe。HMR 指南修正为 watch 构建 +
  `vite preview` 伺服 dist，`--dev-url` 指向实际 `tool.es.js` 而非 preview 根路径。
- 跨平台发布链修复（2026-11-03）：新增 `tools/publish.mjs` 作为唯一发布实现，bash/jq/curl
  协议层退役；`.sh/.cmd` 仅保留薄 shim。新增 `.gitattributes` 固定脚本 LF，支持 SOCKS5、
  请求 golden master 对拍与失败中止回归测试；后端骨架补服务级 actuator 探针、Hikari schema、
  DC PostgreSQL 四键 Secret 引用；镜像构建默认 `linux/amd64`，新增 `PUSH_VIA=ssh` 搬运通道。
  macOS 与 dgx01 Ubuntu 均完成 aiearth01 真实发布，中文菜单、产物冒烟和 Pod 探针验证通过。
- 平台联动（2026-11-03）：发布器新增 `--check-only`、`data/sql/*.sql` 原文+SHA-256 提交和 deploy 前
  registry HEAD 预检；dev-mcp 1.2.2 的 precheck/publish 直走 Node。平台侧新增动态网关路由、
  owner 角色菜单绑定、DB_* 自动注入与 SQL applied/skipped 幂等回执。
- 默认开发支撑环境切至 aiearth01（LAN `10.82.11.51` / Tailscale `100.64.0.4`）；
  aiearth02 仅用于部署测试。`tools/publish.sh`、后端 Nacos 骨架、demo 与文档同步调整。
  dev-mcp 支持经环境变量或仓根 `.env.local` 覆盖网关、DC/native 完整 URL、clientId 和回跳端口；
  新增 `AGRSEARTH_SOCKS_PROXY` 支持 SSH 动态转发，DC 与独立 Chrome 登录页共用 SOCKS5。

- 文档修正（2026-10-24 外部开发者实战落账）：`docs/L2` §2.4 开发机准备——补 jq 硬依赖行
  （脚手架/publish/check 工具链必需，原完全未提）；Python 3 适用范围由「仅 md-to-html.py」
  更正为「建包脚手架 pom 改造 + 文档工具」；Java 17 + Maven 适用范围由「仅系统轨后端」更正为
  「凡带 --with-backend 的包（不分轨道）」；新增 Windows 注意事项（Store 占位 python3 静默
  退出码 49）。`docs/L9` 新增 §9.6 开发机环境排错两则（同上落账）。README 快速开始补
  工具链前提指引（→ L2 §2.4）。
- 文档补强（2026-10-24 外部开发者实战落账）：后端「两态联调」成文——`docs/L8` 新增 §8.6
  本地开发态（mvn spring-boot:run，Nacos 默认指 aiearth02、optional 配置、双向可达前提）
  ↔ 底座验证态（publish --deploy 才能验的镜像/k8s/集群内寻址清单）+ 共享 Nacos 注意事项；
  `docs/L5` R4 补本地联调回路步骤与验收项；`docs/L9` §9.5 补「注册上但网关超时」排错一则。

## [2.0.0] - 2026-10-22

**布局终态 + 品牌统一（breaking）**：

- **fork 模型定版**：本仓为纯模板，不再接收团队插件包；团队经「Use this template」生成
  自有仓，在 `extensions/<track>/<tier>/<pkg>/` 开发；验收后平台管理员纯拷贝移植进平台仓
  同名路径。模板升级走 git upstream 合并（上游不触碰团队包目录）。
- **目录职责对调**：用户工作区自 `packages/` 迁至 `extensions/<track>/<tier>/<pkg>/`；
  `packages/` 纯化为 `@agrsearth/*` 平台供给包（新增 icon-kit/layer-factory/ts-config 三个
  供给包随同步下发）。迁移：在旧版副本内 `mkdir -p extensions/<track>/<tier> &&
  git mv packages/<你的包> extensions/<track>/<tier>/<你的包>`（track/tier 取 manifest 值）。
- **官方演示包**：`packages/wind-field/` → `extensions/tool/business/wind-field-demo/`
  （贯穿式改名，含后端服务 wind-field-demo-server；demo 包禁止提测）。
- **品牌统一 AGRSEarth**：npm scope `@cesiumai/*`/`@agrscesiumai/*` → `@agrsearth/*`；
  MCP `cesiumai-dev` → `agrsearth-dev`；skill `cesiumai-plugin-dev` → `agrsearth-plugin-dev`；
  环境变量 `CESIUMAI_TOKEN`/`CESIUMAI_DEV_BASE` → `AGRSEARTH_TOKEN`/`AGRSEARTH_DEV_BASE`；
  OCI Label `com.cesiumai.*` → `com.agrsearth.*`。
- **工具链**：publish.sh 新增「目录==track/tier」闸口 + demo 包提示；create-extension.sh
  落位 extensions/ 三层目录；check-extension-versions.sh 改 extensions/ 发现制；
  vite-config 改 TS 直引 exports（`@agrsearth/vite-config[/admin]`），不再产出 dist。
- **泄漏闸口**：新增 `.githooks/pre-push`（启用 `git config core.hooksPath .githooks`），
  公开仓推送前扫描内网地址/凭据。
- **同步机制**：导出脚本退役，平台侧改 `sync-template.sh` 单向同步（见 `.upstream`）。

## [Unreleased]（历史注记：以下为 1.x 时期未发布段，随 2.0.0 一并发出）

- 实战检验修复（2026-10-06 wind-field 外部开发者演练产出；组件级版本见各文件头）：
  ① `tools/publish.sh` 1.0.1——测试底座不可达场景报错体验（s3_upload 30s 超时 + 友好指认
  「无法连接 MinIO / resource-manager + 环境变量覆盖指引」，不再抛裸栈）；
  ② `tools/create-extension.sh` 1.0.1——manifest.json description 骨架文案纳入占位符替换；
  实例化 pom 同步改写「集成约定」注释（vendored 4 层形态，原平台仓 6 层表述防误导）；
  ③ `skeletons/admin-ui` 示例页 `<script setup>` 补 `lang="ts"`（原按 JS 解析，TS 语法报莫名
  babel 错——最阴踩坑点）；
  ④ 双端骨架 `vite.config.ts` 增 `exports: 'named'`（消除 Vite named/default 混合导出警告，
  宿主加载器双兼容读取不变）；`@agrsearth/vite-config` admin 工厂补 exports 透传 1.1.1；
  ⑤ 工具轨骨架内置 `frontend/src/utils/cesium.ts`（window.Cesium 取用；L5-R2 补
  「禁止裸 import 'cesium'」红线说明——宿主 import map 无 cesium 键）。

## [1.0.0] - 2026-10-06

- 导出工具链 v2.0.0（scripts/build/export-plugin-template.sh 2.0.0）：产物为完全自包含独立仓——
  ① 新增 `tools/create-extension.sh`（本地脚手架，生成到 `packages/<id>/`，后端 pom 自动改造指向 vendored `maven-repo/`：relativePath 直指 vendored 根 pom + `<repositories>` file 仓）；
  ② 新增 `tools/publish.sh`（仅测试底座：构建 + MinIO SigV4 直传 + resource-manager 注册 + `--dev-url` HMR 回路，prod 一律拒绝）；
  ③ 新增 `tools/menujson.py`（主仓同步副本）与 `tools/check-extension-versions.sh`（packages/ 适配版）；
  ④ 新增 `maven-repo/`（vendored file:// 仓：com.ruoyi 构件闭包 7 件，后端构建免平台仓）；
  ⑤ 新增 `test-env/README.md`（测试底座地址表/账号申请/发布通道/HMR 步骤）与 `packages/README.md`（提测规范）；
  ⑥ npm workspace 改 glob（`packages/*/frontend`、`packages/*/admin-ui`），建包免手改 workspaces；
  ⑦ 资产清洗：源头 9 文件去生产地址/内部路径/运维手册指针（导出闸口全量 grep 兜底）。
