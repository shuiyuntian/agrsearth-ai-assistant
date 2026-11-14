# ai-assistant-mcp 容器镜像

本目录存放 `ai-assistant-mcp` 能力包的镜像构建文件，规范见
平台仓 `docs/运维手册/2-部署与变更/CONTAINER_IMAGE_SPEC.md`。

| 子目录 | 镜像 | 说明 |
|:---|:---|:---|
| [`ai-assistant-mcp/`](./ai-assistant-mcp/) | `localhost:32000/gis-platform/system/business/ai-assistant-mcp/ai-assistant-mcp:<version>` | tini + ai-orchestrator 主进程（MCP 经 HTTP 外部化到 cesium-mcp 服务）+ 工具契约 + codegen 技能 |
| [`cesium-mcp/`](./cesium-mcp/) | `localhost:32000/gis-platform/system/business/ai-assistant-mcp/cesium-mcp:<version>` | MCP gateway + geolocation-server + geolocation-http 桥（vendor pristine，组件版本轴独立于包版本） |

前端 UMD 包不打镜像，经 `scripts/publish-extension.sh` 发布到 MinIO 远程加载。
