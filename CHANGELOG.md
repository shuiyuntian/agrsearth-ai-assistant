# 模板仓套件变更记录

> 本文件版本 = 模板仓套件版本（VERSION），含义：skeletons + packages 供给物 + 工具链 + docs 的整体版本。平台供给物由平台仓 `scripts/build/sync-template.sh` 单向同步。

## [2.2.0] - 2026-11-09

本版与平台仓 `2.0.0` 联合验收；两仓版本号独立演进，平台供给物的精确源提交以 `.upstream` 的 `upstream-head` 为准。

- 球端面板效果、留白与随包样式（2026-11-08）：L10 明确告警、轨迹、风场/烟雾/水流等业务动效可用，
  性能不足时优先调参而非一律禁用；AGENTS.md 明确 CesiumJS vendor skills 的 Performance Tips /
  visual eval 不是默认降配或验收红线，共享 Viewer 全局渲染参数不得无需求修改。tool 骨架改用
  `contentPadding:'default'`（宿主上下 12px、左右 16px）并新增包级 panel.css，Vite 显式产出
  tool.css 避免与 admin-ui/style.css 平铺重名；create-extension.mjs 2.1.0 将 CSS 纳入包名替换。
  publish.mjs 2.4.0 新增 --dev-css-url，reset 同时恢复 ESM/CSS；dev-mcp 1.7.0 HMR 指南按产物检测
  随包 CSS。L5/L8/L10 与 agrsearth-plugin-dev 验收清单同步（七端副本一致）；
  scaffold-golden 按新骨架再基线化（有意变更）。
- 菜单号段 DC 流程 + 禁 SSH 红线补全（2026-11-08，issue #12 闭环）：skill `agrsearth-plugin-dev`
  契约红线新增第 7 条（环境零 SSH/零直连——禁止登录 aiearth01 执行任何操作，DB 初始化走
  `data/sql` 随 release-complete 落库；文档中的 `ssh -N -D`/`PUSH_VIA=ssh` 仅为客户端侧通道；
  明确约束对象为经本仓开发的团队与 AI 工具，平台方运维维护性操作不受约束）与
  第 8 条（菜单号段零申请——`package_register` 自动从团队池切本包千段，`resource_list` 实查后
  menuId 落段；「禁止越段写菜单」fail-fast 报错自带本包实分段，改 menu.json 重发即可，
  **不要 quota_request**；注册一次性定资源位，menu=false 误注册走 remove→重注册；
  配额审批仅团队池真用尽时走，审批权在平台管理员 18850 开发者中心→任务页），
  7 端副本经 check-agent-parity --fix 同步；AGENTS.md 红线与「遇到问题」导航表同源更新；
  L5（R3/R5）/L8（§8.4 约束 + 提测单模板）/L9（§9.4 新增越段/配额 PENDING/禁 SSH 三条 Q&A）/
  test-env README（§2 申请流程去号段旧通道 + §5 边界红线段）改 DC 现行口径；skeletons
  tool/system `data/menu.json` 与 wind-field-demo 注释、create-extension.mjs 生成 README
  清除「号段向平台方申请」旧口径（演示包重申禁止提测）；menujson.py 退役残留死引用
  （L2/L5/L9/test-env）改指 `publish.mjs --check-only` 内置校验；scaffold-golden 6 夹具
  按新文案再基线化（有意变更）。根因记录：issue #12 的配额审批卡死并非配额不足——团队池默认
  10 块×10000 号/band 正常团队用不完，系示意值越段 fail-fast + 旧文档口径诱导的误申请。
- menujson.py 全退役（2026-11-08，create-extension.mjs 2.0.1 + check-extension-versions.mjs 2.0.1）：
  `tools/menujson.py` 自仓内删除（平台仓 sync-template 停止下发并清理本地残留；平台仓原件归档
  `archives/menujson-legacy-20261108/`）——validate 能力自 2.0.0 起已由 publish.mjs
  `validateMenuDocument`（JS 单实现）取代，from-db/from-sql 为一次性迁移通道（26 份菜单 SQL
  已于 2026-10-04 迁完归档），无存续需求。check-extension-versions 失败详情文案与脚手架生成
  README 的校验提示改指 validateMenuDocument / 发布期自动校验；scaffold-golden 6 夹具与
  check-versions-golden menu-invalid 用例按新行为再基线化（有意变更）。AGENTS.md 同步约定
  与 tools/ 速览同步除名。
- dev-mcp 1.6.2（平台仓同步下发）：`package_scaffold` 双模式直调 node create-extension.mjs
  （不经 bash），Windows 端经 MCP 建包免 Git Bash；平台仓模式 `withAdminUi` 显式报错。
  agent-doctor 1.2.2 同步撤掉 Windows Git Bash 提示（platformWarnings 恒空、bash 探针移除），
  L9/AGENT_PARITY/AGENTS.md 文案对齐。
- 建包与版本校验工具 Node 化（2026-11-07，create-extension.mjs 2.0.0 + check-extension-versions.mjs 2.0.0）：
  同 publish.mjs 2.0.0 模式收尾——两工具改为 Node 唯一实现，`.sh`/`.cmd` 退化为薄 shim
  （`check-extension-versions.cmd` 为新增），Windows 建包/校验不再依赖 Git Bash/jq/Python；
  jq 的 manifest 改写经实测与 `JSON.stringify(v,null,2)+"\n"` 字节一致，pom 改造与公开示例
  控制器改写内联为 JS；menu.json 校验复用 publish.mjs `validateMenuDocument`（规则与
  menujson.py 等价，golden 夹具背书）；校验输出表格按 UTF-8 字节宽补 padding 复刻 bash
  `printf %-Ns` 语义。回归设施：golden master 组合快照（scaffold 6 组参数组合 / check-versions
  9 夹具用例，含捕获与重放脚本及 fixtures README），`npm run test:tools` 并入 `npm run check`。
  有意差异：脚手架复制骨架时跳过 `node_modules/`（gitignored 本地环境污染，非契约行为；
  新包依赖经仓根 `npm install` 重建）。agent-doctor 1.2.1 同步收窄 Windows bash 提示文案。
- networkProfile 解耦（2026-11-07，publish.mjs 2.3.0 + dev-mcp 1.6.0）：删除 `100.64.*` 个人拓扑
  硬编码与 `lan|tailscale` 词汇表客户端硬校验——词汇表 owner 归 RM 服务端（`rm.artifact-upload.endpoint.*`
  白名单默认全拒 + 非法值明确 400，存量行为已覆盖兜底，服务端零改动）；客户端仅形态校验 +
  不透明透传，自动推导收敛为「私网段网关 → lan，其余须显式指定」。非密拓扑项新增配置分层：
  进程 env > 仓根 `.env.local` > 用户级 `~/.config/agrsearth/config.json` > 默认值（token 不进
  配置层），publish.mjs 与 dev-mcp 双通道同口径，CLI 直跑与 MCP 驱动行为一致。

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
