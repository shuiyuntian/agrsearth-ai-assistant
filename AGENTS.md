# AGENTS.md — CesiumAI 插件开发模板仓（AI 编码工具通用契约）

> 本文件是**工具中立**的 AI 编码契约：Kimi Code / Codex / Claude Code / qoder 等任何
> 打开本仓的 AI 工具都应先读本文件。Kimi Code 另有触发式技能
> `.kimi-code/skills/cesiumai-plugin-dev/SKILL.md`（红线相同、带 recipe 明细），两者同源，
> 改红线时两处同步。

## 这是什么仓

航遥业务中台（CesiumAI）的**插件（能力包）开发模板仓**。你在这里开发的每个包最终会被发布到
共享开发调试环境（aiearth02 ext-dev，公司网）验收，生产发布由平台管理员执行。平台侧契约唯一本体是平台仓
`docs/插件开发指南/4-契约参考/PLUGIN_DEVELOPMENT.md`；本仓 `docs/L1-L10` 是分层指南，
冲突时以契约本体为准。

## 目录速览

- `packages/` — 你的扩展包放这里（`packages/<id>/`）；其中 `@cesiumai/*`（sdk-types /
  vite-config / ui-utils / admin-sdk）是平台供给包，**只读勿改**
- `skeletons/` — tool / system / admin-ui 三套骨架，建包一律走脚手架，不手抄
- `tools/` — create-extension.sh（建包）、publish.sh（发测试底座）、check-extension-versions.sh、menujson.py
- `backend/svc-placeholder/`、`container/svc-placeholder/` — 后端服务与镜像骨架（脚手架实例化）
- `maven-repo/` — vendored com.ruoyi 依赖闭包（file:// 仓，后端构建免平台仓）
- `test-env/` — 共享开发调试环境（aiearth02 ext-dev）地址表与账号申请说明
- `docs/L1-L10` — 分层开发指南；`RELEASE_CHECKLIST.md` — 提测前自检清单

## AI 工具接入（dev-mcp，推荐）

本仓附带 `tools/dev-mcp/`——插件开发辅助 MCP server（stdio）。接入后你的 AI 工具可直接
查契约文档、跑脚手架、做发布预检、一键发布到共享调试环境、自助查实例/日志。

- **Kimi Code**：开箱即用（仓根 `.kimi-code/mcp.json` 已注册 `cesiumai-dev`，按需加载）。
- **Codex**（`~/.codex/config.toml`）：
  ```toml
  [mcp_servers.cesiumai-dev]
  command = "node"
  args = ["tools/dev-mcp/server.mjs"]
  ```
- **Claude Code**：`claude mcp add cesiumai-dev -- node tools/dev-mcp/server.mjs`
- **其他支持 stdio MCP 的客户端**：入口 `node tools/dev-mcp/server.mjs`，工作目录 = 仓根。

首次使用先 `cd tools/dev-mcp && npm install`；查实例/日志类工具需团队 token
（`CESIUMAI_TOKEN` 环境变量或仓根 `.env.local`，获取方式见 `test-env/README.md` §2）。
**`tools/dev-mcp/` 是导出产物，禁止直接改**——问题回报平台方，源头在平台仓 `mcps/cesiumai-dev/`。

## 契约红线（违反即验收打回；交付前必须 grep 自查）

1. **默认导出契约**：`frontend/src/index.ts` 默认导出 `CapabilityPackage` **实例**
   （`{ manifest, activate, deactivate?, destroy? }`），禁止工厂函数；admin-ui 入口导出
   `{ manifest, adminViews }`。
2. **现场分组隔离（ADR-006）**：实体只走 `ctx.entities.*`，**禁止 `viewer.entities.add()` 直加**；
   Primitive 只走 `ctx.primitives` 并自清理；帧回调/键盘/定时器等可触发重建的路径先判挂起态。
3. **宿主依赖 external**：`vue/vue-router/pinia/element-plus/@element-plus/icons-vue/cesium/echarts`
   （及 `opencc-js`、`@/utils/request`）一律不打进产物——构建必须经 `@cesiumai/vite-config[/admin]`。
4. **管理页红线（ADR-007）**：不自建 `createApp`；不用 `import.meta.env`（用 `@cesiumai/admin-sdk`
   的 `getBaseApi()`）；不 import 宿主内部组件/store。
5. **显式声明零推断**：manifest `track`（tool|system）/`tier`（platform|business）必填，
   `delivery` 仅 tool·business 象限用；旧 `class` 字段已全退役，勿再填；`components` 段
   （frontend/backend[]/adminUi/menu{enabled,menuPath}/data）必须与包内实际结构一致；
   禁止 latest 镜像 tag；一切 k8s/docker 时区 `TZ=Asia/Shanghai`（一票否决项）。

## 常用命令

```bash
npm install                    # 首次：装全部 workspace 依赖（@cesiumai/* 自动链接）
npm run check                  # 骨架自检（全部骨架可构建即通过）
./tools/create-extension.sh <id> --track tool|system --tier platform|business \
    [--name 中文名] [--with-backend] [--with-admin-ui]
./tools/check-extension-versions.sh        # 版本五处一致性 + 四必备校验
./tools/publish.sh packages/<id>           # 发测试底座（prod 一律拒绝）
./tools/publish.sh packages/<id> --dev-url http://<本机>:<端口>/  # HMR 调试回路
```

## 验收 Checklist（提测前逐条过）

完整清单见 `RELEASE_CHECKLIST.md` 与 `docs/L8-提测与发布.md`；核心条目：

- [ ] `npm run check` 通过；`check-extension-versions.sh` 全绿
- [ ] grep 自查：无 `viewer.entities.add`、无 `createApp`、无 `import.meta.env`、无 latest tag
- [ ] components 段与目录结构一致；注释头五要素合规（docs/L7）
- [ ] 管理页布局规约（撑满式列表 / 操作列宽度测算 / 弹窗 70%×70vh 居中 / 浮层嵌套走 drawer）——
      细则见 `.kimi-code/skills/cesiumai-plugin-dev/SKILL.md` 与 docs/L10
- [ ] 权限两层模型：页内只读接口注解 = 页面 view perms（整页共用，禁止按接口切碎）

## 与平台仓的同步约定

`packages/@cesiumai/*`、`skeletons/`、`tools/`、`maven-repo/`、`.kimi-code/` 由平台方经
导出脚本统一下发（溯源见 `.upstream`）。发现模板问题**不要在本仓改这些目录**——向平台方提
issue，由平台仓 `extensions/_template/` 源头修改后重新导出；你自己包的目录（`packages/<你的id>/`）
不受同步影响。
