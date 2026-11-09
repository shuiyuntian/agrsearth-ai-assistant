# 模板仓套件变更记录

> 本文件版本 = 模板仓套件版本（VERSION），含义：skeletons + packages 供给物 + 工具链 + docs 的整体版本。平台供给物由平台仓 `scripts/build/sync-template.sh` 单向同步。

## [2.3.0] - 2026-11-09

主线：平台图标库向各类 Coder 开放统一只读消费入口，并把使用规范落到文档、Skill 与骨架。

- **dev-mcp 1.8.0**：新增 `icon_search`、`icon_get`、`icon_bake`；经开发者中心门面鉴权，支持业务语义检索、变体/SVG/色板读取与无状态烘焙，不开放上传、派生、删除或副本签发。
- **平台侧配套**：icon-library 0.2.1 新增 `@InnerAuth` 内部只读消费接口；developer-center 包 0.4.2/组件 0.5.1 新增 `/api/v1/icons` 窄门面，复用开发者只读权限并返回可复制的 `iconRef`。
- **模板指南**：L5 新增 R8 图标 recipe，L10 明确 manifest/AppIcon/IconPicker 与三种引用形态，L9 补登录、加载失败和自定义副本排错；README 增加统一入口。
- **七端 Skill**：`agrsearth-plugin-dev` 增加图标任务触发词与查库约束，权威源修改后同步全部 Coder 副本。
- **可运行示例**：tool 骨架引入 `@agrsearth/icon-kit`，面板内置 `calcite:layers` 的 `AppIcon` 示例；平台图标资产名须来自实际检索，不得猜名。

## [2.2.0] - 2026-11-09

主线：面板与随包样式全链联调；建包和版本校验工具 Node 化；发布拓扑配置解耦；菜单号段自助分配与协作红线补全。本期关联 issue #11/#12 已关闭。

- **面板效果与随包样式联调**：
  - L10 与 AGENTS.md 明确告警、轨迹、风场/烟雾/水流等业务动效可用；性能不足时优先调参，CesiumJS vendor skills 的 Performance Tips / visual eval 不作为默认降配或验收红线，共享 Viewer 全局渲染参数不得无需求修改。
  - tool 骨架采用 `contentPadding:'default'` 并新增包级 `panel.css`，Vite 显式产出 `tool.css`；create-extension.mjs 2.1.0 将 CSS 纳入包名替换，publish.mjs 2.4.0 新增 `--dev-css-url` 并在 reset 时同步恢复 ESM/CSS，dev-mcp 1.7.0 按实际产物检测随包 CSS。
- **建包与版本校验工具 Node 化**：
  - create-extension.mjs / check-extension-versions.mjs 2.0.0 成为唯一实现，`.sh`/`.cmd` 仅保留薄 shim；Windows 建包和校验不再依赖 Git Bash、jq 或 Python，新增 Windows 校验入口。
  - menu.json 校验统一复用 publish.mjs 的 `validateMenuDocument`，`tools/menujson.py` 全退役；create-extension.mjs / check-extension-versions.mjs 2.0.1 同步清理旧提示。脚手架与版本校验建立 golden master 组合回归，并纳入 `npm run check`。
- **发布配置与开发工具链**：
  - publish.mjs 2.3.0 + dev-mcp 1.6.0 解除 `networkProfile` 词汇表与个人网络拓扑的客户端硬编码，合法值由服务端校验；非密配置统一支持进程 env、仓根 `.env.local`、用户级 config.json 与默认值分层，CLI/MCP 行为一致。
  - dev-mcp 1.6.1 扩大 loopback 瞬态错误重试范围（issue #11）；1.6.2 的 `package_scaffold` 直调 Node 脚手架，agent-doctor 1.2.2 同步移除 Windows Git Bash 提示。
- **菜单号段与协作边界（issue #12）**：
  - 带菜单包经 `package_register` 自动分配本包号段，`resource_list` 实查后即可编写 menu.json；越段 fail-fast 时按报错分段修正，不误走配额申请，仅团队池真正耗尽时才进入配额审批。
  - 明确环境零 SSH/零直连边界，数据库初始化统一由 `data/sql` 随 release-complete 落库；客户端侧 SOCKS 动态转发与镜像搬运通道保留。AGENTS.md、L5/L8/L9/L10、test-env 与七端 Skill 副本同步更新。
- **平台兼容与版本元数据**：本版与平台仓 `2.0.0` 联合验收，两仓独立 SemVer，平台供给物的精确源提交以 `.upstream` 的 `upstream-head` 为准；根 VERSION、package.json 与 package-lock.json 统一为 `2.2.0`，README 同步版本策略并清除 menujson.py 残留说明。

## [2.1.0] - 2026-11-07

主线：发布链全 Node 化并切至 aiearth01 默认环境；七端 AI 编码工具一致性接入；前后端 URL 契约治理；Windows 工具链兼容。本期关联 issue #3~#9 已全部关闭。

- **跨平台发布链（issues #8/#9）**：
  - `tools/publish.mjs` 成为唯一发布实现（2026-11-03）：bash/jq/curl 协议层退役，`.sh/.cmd` 仅保留薄 shim；新增 `.gitattributes` 固定脚本 LF，支持 SOCKS5、请求 golden master 对拍与失败中止回归；镜像构建默认 `linux/amd64`、新增 `PUSH_VIA=ssh` 搬运通道；macOS 与 Ubuntu 均完成 aiearth01 真实发布（中文菜单、产物冒烟、Pod 探针验证通过）。
  - 发布协议加固：`--check-only` 零网络预检、`data/sql/*.sql` 原文+SHA-256 提交、deploy 前 registry HEAD 预检（11-03）；publish 2.2.1 输出 MinIO 非 2xx 脱敏后的 Code/Message（11-05）；2.2.2 预检补文件名/非空/大小/UTF-8 摘要一致性，网关 XSS 清洗精确排除 DC release-complete（11-06，天气包 0.1.4 两个 SQL 应用后恢复 200 实测）。
  - developer-center 0.2.0/0.3.0（11-06）：动态网关路由（动态 dataId 监听 + 组合路由，新增/删除探针免重启实测）、默认版本双写、后端缺 bundle 拒发、Secret 占位符部署解析、日志 UTF-8/tailLines。
  - 骨架加固（11-03）：后端骨架补服务级 actuator 探针、Hikari schema、DC PostgreSQL 四键 Secret 引用。
- **默认开发环境切至 aiearth01**（2026-11-02）：公司网 LAN `10.82.11.51`，aiearth02 仅用于部署测试；publish、后端 Nacos 骨架、demo 与文档同步调整；dev-mcp 支持环境变量/仓根 `.env.local` 覆盖网关与登录端点，新增 `AGRSEARTH_SOCKS_PROXY`（SSH 动态转发）。
- **七端 AI 编码工具接入（2026-11-06~07）**：
  - 新增 `tools/agent-doctor.mjs` 与 `tools/check-agent-parity.mjs`：Kimi Code / Codex / Claude Code / Qoder / OpenCode / Trae / CodeBuddy 七端项目级 Skill 同源副本 + MCP 配置一致性闸口（`.agents/skills` 为通用入口，Claude/CodeBuddy 共用 `.mcp.json`），`npm run check` 纳入漂移检查；统一 MCP 接入说明与任务验收矩阵（docs/AGENT_PARITY.md）。
  - cesiumjs-skills（14 领域 + orientation，上游 v1.144 pin）由平台仓 vendor 同步纳入，随七端副本分发（`sync-template.sh` 1.2.0）。
  - doctor 1.2.0（11-07）：dev-mcp 依赖硬检查（未装 node_modules 即 FAIL 并给出安装指引）、Windows bash 工具链提示、FAIL 页脚「客户端信任/以仓根为工作区打开」提醒；新增 `tools/create-extension.cmd`（Windows 建包 Git Bash 薄 shim）。
- **dev-mcp 迭代 1.2.2→1.5.0（issues #3/#8 + 平台仓 issue #1）**：
  - 登录：新增 `auth_login_start`/`auth_login_wait` 两步原生登录（1.4.0）；Windows 授权链接改 `rundll32` 原样打开、SOCKS5 Chrome 直启解析后的 chrome.exe（1.2.3）；`AGRSEARTH_BASH`/`AGRSEARTH_PYTHON` 解释器覆盖；HMR 指南修正为 watch 构建 + `vite preview` 伺服 dist。
  - 修复：auth_login 超时清理二次抛错（1.2.4，统一为可等待幂等 `closeHttpServer`）。
  - 能力：precheck/publish 直走 Node 不经 bash/python（1.2.2）；新增第 23 工具 `package_contract_check`（1.3.0）；发布子进程令牌注入 + `package_manage action=remove` 产物回收（1.5.0：测试包产物移至 `_trash/<packageId>/<时间-短ID>/` 后清理登记，审计保留）。
- **前后端 URL 契约治理（issues #5/#6/#7，2026-11-05）**：球端/管理页骨架内置 `src/api/index.ts` 常量表单源化；新增 Node 跨平台 `tools/check-api-contract.mjs`（公开 Spring Mapping ↔ 前端常量表双向对账），接入 `npm run check`、`publish.mjs --check-only` 与正式发布；AGENTS 症状导航、L5/L8/L9 与验收清单同步，公开示例控制器与管理页示例 API 对齐。
- **依赖升级（issue #4，2026-11-05）**：骨架与演示包升级 Vite 6.4.4+、`vue-tsc` 3.3.14、`unplugin-auto-import` 20.3.0、`@vitejs/plugin-vue` 5.2.4；`@agrsearth/vite-config` 1.2.0 保留 Vite 5 兼容并支持 Vite 6；`npm audit` 清零。
- **文档（2026-10-24 外部开发者实战落账）**：L2 §2.4 补 jq 硬依赖、Python 3/Java 17+Maven 适用范围更正、Windows 注意事项（Store 占位 python3 静默退出码 49）；L8 §8.6 后端「两态联调」、L5 R4 本地联调回路、L9 §9.5/9.6 排错三则；README 快速开始补工具链前提指引。

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

**附：1.x 时期未发布段修复（随 2.0.0 一并发出）**：

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

首个发布版本（Initial release）。

**这是什么**：AGRSEarth 航遥业务中台的插件（能力包）开发模板仓。第三方开发团队经
GitHub「Use this template」派生自有仓，在仓内完成脚手架建包、本地构建、发布到共享
开发调试环境联调；验收后由平台管理员移植进平台仓同名路径，生产发布由平台管理员执行。

**初始构成**：

- `skeletons/` — tool / system / admin-ui 三套最小骨架（建包一律走脚手架实例化）；
- `packages/` — `@agrsearth/*` 平台供给包（sdk-types / vite-config / ui-utils / admin-sdk），只读勿改；
- `tools/` — create-extension.sh（建包脚手架）、publish.sh（测试底座发布器）、
  menujson.py（菜单声明工具）、check-extension-versions.sh（版本一致性校验）；
- `maven-repo/` — vendored com.ruoyi 依赖闭包（file:// 仓，插件后端构建免平台仓）；
- `test-env/` — 共享开发调试环境地址表与账号申请说明（默认环境历经调整，见 2.1.0）；
- `docs/` — L1-L10 分层开发指南；
- 官方演示包 wind-field（发测试底座验证通路用，禁止提测；2.0.0 起迁至
  `extensions/tool/business/wind-field-demo/`）。

**工具链明细**（导出工具链 v2.0.0，scripts/build/export-plugin-template.sh 产出完全自包含独立仓）：

- ① 新增 `tools/create-extension.sh`（本地脚手架，生成到 `packages/<id>/`，后端 pom 自动改造指向 vendored `maven-repo/`：relativePath 直指 vendored 根 pom + `<repositories>` file 仓）；
  ② 新增 `tools/publish.sh`（仅测试底座：构建 + MinIO SigV4 直传 + resource-manager 注册 + `--dev-url` HMR 回路，prod 一律拒绝）；
  ③ 新增 `tools/menujson.py`（主仓同步副本）与 `tools/check-extension-versions.sh`（packages/ 适配版）；
  ④ 新增 `maven-repo/`（vendored file:// 仓：com.ruoyi 构件闭包 7 件，后端构建免平台仓）；
  ⑤ 新增 `test-env/README.md`（测试底座地址表/账号申请/发布通道/HMR 步骤）与 `packages/README.md`（提测规范）；
  ⑥ npm workspace 改 glob（`packages/*/frontend`、`packages/*/admin-ui`），建包免手改 workspaces；
  ⑦ 资产清洗：源头 9 文件去生产地址/内部路径/运维手册指针（导出闸口全量 grep 兜底）。
