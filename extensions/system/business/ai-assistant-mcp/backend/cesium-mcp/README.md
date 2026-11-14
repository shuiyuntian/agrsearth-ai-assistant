# cesium-mcp 组件源码边界

cesium-mcp 是复合后端组件，不对应单一源码目录：

- `../../vendor/cesium-mcp/cesium-js/`：pristine gateway 与六个浏览器工具域；
- `../../vendor/cesium-mcp/geolocation-server/`：pristine 地理工具实现；
- `../geolocation-http/`：本包自研 HTTP streamable 桥与 `geolocation_extent`。

组件统一由 `container/cesium-mcp/` 构建为一个双进程镜像，serviceId 与镜像版本轴为 `cesium-mcp` / `container/cesium-mcp/VERSION`。本目录仅用于发布器识别复合组件的真实源码边界，不包含复制源码或第二套实现。
