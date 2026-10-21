# mcps/cesiumai-dev — CesiumAI 插件开发辅助 MCP

> 面向**第三方插件开发团队**的 MCP server（stdio，Node，运行在团队本机）。
> 唯一事实源在平台仓 `mcps/cesiumai-dev/`；模板仓 `tools/dev-mcp/` 是导出产物
> （等价 vendored，**禁止直接改**，问题回报平台方）。
> 与 `cesiumai-ops`（业主运维）是两个 server：本 server 只触达 aiearth02 共享开发
> 调试环境，永不出现家庭网地址，本体零密钥。

## 工具清单（7 个，v0.1.0）

| 分组 | 工具 | 说明 | 副作用 |
|---|---|---|---|
| 契约文档 | `plugin_dev_docs` | 模板仓模式读 docs/L1-L10；平台仓模式读 PLUGIN_DEVELOPMENT.md | 无 |
| 脚手架 | `scaffold_package` | 包装 create-extension.sh 建包（track/tier/backend/admin-ui 参数） | 本地，可逆 |
| 预检 | `dev_precheck` | 版本五处一致性 + menu.json 校验（平台仓模式走 publish --check-only 全闸口） | 无 |
| 发布 | `publish_to_dev` | **写操作**：tools/publish.sh 发 aiearth02（弹审批 + 强制 reason）；prod 硬拒绝；平台仓模式拒绝 | 有 |
| 自助诊断 | `dev_instances` / `dev_instance_logs` | aiearth02 实例列表 / Pod 日志摘要 + 运维任务记录（RM 只读端点，团队 token 鉴权，全员只读可见） | 无 |
| 联调 | `hmr_guide` | 生成 --dev-url HMR 回路命令 + 排障清单 | 无 |

## 接入（模板仓，团队侧）

```bash
cd tools/dev-mcp && npm install   # 仅首次
```

仓根 `.kimi-code/mcp.json` 已由导出脚本生成（Kimi Code 开箱即用）。其他 AI 工具等价配置：

- **Codex**（`~/.codex/config.toml`）：
  ```toml
  [mcp_servers.cesiumai-dev]
  command = "node"
  args = ["tools/dev-mcp/server.mjs"]
  ```
- **Claude Code**（`claude mcp add`）：
  `claude mcp add cesiumai-dev -- node tools/dev-mcp/server.mjs`
- **qoder / 其他**：任意支持 stdio MCP 的客户端，入口 `node tools/dev-mcp/server.mjs`，
  工作目录 = 模板仓根。

## 鉴权（团队账号 token）

`dev_instances` / `dev_instance_logs` 需要团队 ext-developer 账号的 Bearer token，
二选一配置（server 本体不存任何密钥）：

```bash
export CESIUMAI_TOKEN=<token>
# 或写仓根 .env.local（gitignored）：CESIUMAI_TOKEN=<token>
```

token 获取：浏览器登录 aiearth02 管理后台 `http://10.82.11.52:18850` 后从开发者工具
复制 Authorization；或向平台管理员申请。账号申请见 `test-env/README.md`。

## 环境配置

| 环境变量 | 默认值 | 说明 |
|---|---|---|
| `CESIUMAI_DEV_BASE` | `http://10.82.11.52:18801` | aiearth02 网关（公司网 LAN）；Tailscale 可达时可用 `http://100.64.0.5:18801` |
| `CESIUMAI_TOKEN` | 无 | 团队账号 Bearer token |

## 审计与红线

- 全部工具调用落 `logs/operations/dev-mcp-<日期>.jsonl`（北京时间，gitignored）；
  `publish_to_dev` 强制 `reason` 事由参数，缺失即拒。
- 发布只到 aiearth02 共享调试环境；生产（aiearth01）发布由平台管理员执行，本 server
  无任何生产通道。
- 共享调试环境实例/日志全员只读可见（2026-10-22 业主裁定：调试环境不做团队间隔离）；
  写权限由 ext-developer 角色权限点卡住，MCP 只是通道，不放宽任何服务端校验。
