# example-server 组件镜像（骨架）

- 组件版本轴：`container/example-server/VERSION`（镜像 tag 优先取组件版本，与包版本解耦）
- 构建规范：OCI Label 一票否决项（完整规范文档由平台方提供，提测/验收时核对）
- 命名空间：与仓内目录同构 → `localhost:32000/gis-platform/system/business/example-system/example-server:<tag>`（即 `gis-platform/<track>/<tier>/<pkg>/<svc>`）
