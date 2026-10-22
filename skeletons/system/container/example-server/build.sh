#!/usr/bin/env bash
#
# 文件作用：example-server 组件镜像构建脚本骨架（编译→打包→注入 OCI Label→推送 registry）
# 作者：JasonLee <shuiyuntian@foxmail.com>
# 创建日期：2026-09-14
# 版本：1.0.1
# 修改记录：
#   - 1.0.0 (2026-09-14) 模板仓骨架初始版本（占位，集成期由平台方按 CONTAINER_IMAGE_SPEC 补全）
#   - 1.0.1 (2026-10-05) 镜像命名补 tier 段（gis-platform/<track>/<tier>/<pkg>/<svc>）
#
# 版权所有 (C) 2026 AGRSEarth 项目
#
set -euo pipefail

# TODO(集成期补全)：
# 1. 编译 backend/example-server（mvn package）
# 2. 拷贝产物到本目录（与 Dockerfile 的 COPY 源一致）
# 3. Dockerfile base64 编码注入 OCI Label（org.opencontainers.image.*，规范见平台仓
#    OCI Label 规范文档由平台方提供，提测/验收时核对）
# 4. docker build -t localhost:32000/gis-platform/system/business/example-system/example-server:<组件版本> .
# 5. docker push（组件版本轴：本目录 VERSION 文件，改哪个组件 bump 哪个）

SERVICE_NAME="example-server"
SERVICE_VERSION="0.1.0"
# 组件版本轴：SERVICE_VERSION 必须与本目录 VERSION 文件一致（改哪个组件 bump 哪个）

echo "占位骨架：请按 CONTAINER_IMAGE_SPEC 补全构建脚本（平台方集成期协助）"
