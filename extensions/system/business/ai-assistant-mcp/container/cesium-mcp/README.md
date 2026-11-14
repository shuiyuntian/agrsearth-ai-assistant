# cesium-mcp 镜像

扩展组件镜像：`localhost:32000/gis-platform/system/business/ai-assistant-mcp/cesium-mcp:<version>`（版本 = 组件版本轴 `container/cesium-mcp/VERSION`，独立于包 VERSION，build.sh 有护栏；命名空间 2026-10-03 批 3.5 由 `agrs-cesiumai/` 归位至与仓内目录同构的终态名）。 <!-- check-docs:allow 退役注记 -->

单容器双进程：

| 进程 | 端口 | 说明 |
|:---|:---|:---|
| MCP gateway（vendor cesium-js workspace） | 3010 | SSE 命令通道（`/mcp/events`、`/mcp/result`、`/mcp/health`） |
| 〃 | 4010 | MCP streamable-http（= 通信端口 + 1000，有状态单 session） |
| geolocation-http 桥 | 3008 | geolocation 3 工具（`/mcp` 多 session + `/health`） |

- 构建：`./build.sh`（开发测试环境 multiarch builder，多架构同 tag 推送）
- 运行环境变量：`NOMINATIM_SERVER_URL` / `OSRM_SERVER_URL` / `OVERPASS_SERVER_URL` / `OSM_USER_AGENT`（镜像内置 开发测试环境 默认值，k8s configmap 可覆盖）；公网 egress 需要时补 `https_proxy`/`http_proxy`/`no_proxy`
- 注意：刻意不设全局 `PORT`（两进程端口在 CMD 内分别注入，避免冲突）
- 部署清单：`platform/deploy/environments/prod/开发测试环境/microk8s/cesium-mcp/`
