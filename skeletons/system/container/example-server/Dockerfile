# 文件作用：example-server 组件镜像骨架（系统轨容器构建目录示例）
# 作者：JasonLee <shuiyuntian@foxmail.com>
# 创建日期：2026-09-14
# 版本：1.0.1
# 修改记录：
#   - 1.0.0 (2026-09-14) 模板仓骨架初始版本
#   - 1.0.1 (2026-10-05) 镜像命名规范注释补 tier 段
#
# 版权所有 (C) 2026 AGRSEarth 项目
#
# 构建规范（OCI Label 注入/镜像命名 gis-platform/<track>/<tier>/<pkg>/<svc>）见平台仓
# docs/运维手册/2-部署与变更/CONTAINER_IMAGE_SPEC.md；本目录与业务源码分离（backend/ 内禁止 docker build）。
FROM localhost:32000/eclipse-temurin:17-jre
ENV TZ=Asia/Shanghai
# TODO: COPY 构建产物并配置入口（jar 名与现网 deployment 比对安全闸见平台发布脚本）
# COPY app.jar /app/app.jar
# ENTRYPOINT ["java", "-jar", "/app/app.jar"]
