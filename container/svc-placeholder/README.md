# svc-placeholder 镜像骨架模板

`eclipse-temurin:17-jre` 基线的 jar 模式镜像骨架（Dockerfile + build.sh + VERSION 组件版本轴）。

- **实例化**：由模板仓脚手架 `tools/create-extension.sh --with-backend`（平台仓：
  `scripts/create-extension.sh`）自动复制为包内 `container/<svc-id>/` 并替换占位符；
  手工实例化见 `backend/svc-placeholder/README.md` 的占位符表与「实例化后必做」。
- **VERSION**：组件独立版本轴——build.sh 启动时读取本文件作为镜像 tag，
  改哪个组件 bump 哪个；`tools/check-extension-versions.sh` 识别
  `SERVICE_VERSION="$(cat VERSION ...)"` 自派生写法并校验与包 VERSION 的豁免关系。
- **镜像名**：`<registry>/gis-platform/<track>/<tier>/<pkg>/<svc>:<组件版本>`
  （registry 地址以目标环境为准，由平台方在部署侧配置）。
- **OCI Label**：全部经 build.sh 的 `--build-arg` 注入（含 Dockerfile base64、基础镜像、
  构建命令），规范文档由平台方提供（提测/验收时核对）。

构建（在实例化后的包内执行）：

```bash
cd extensions/<track>/<tier>/<pkg>/container/<svc>
./build.sh                    # 编译 backend/<svc> 并构建推送
SKIP_COMPILE=1 ./build.sh     # 跳过编译（用既有 target/*.jar，先清旧 jar 防多匹配）
```
