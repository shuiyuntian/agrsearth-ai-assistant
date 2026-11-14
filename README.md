# AGRSEarth AI Assistant

AGRSEarth AI 助手独立能力包仓，由模板仓 `ee49aa6` 生成。当前只包含 `ai-assistant-mcp` 2.1.4（system/business，无 delivery），提供球端悬浮入口、管理面、ai-orchestrator、cesium-mcp 与 geolocation-http 桥。

## 边界

- 真实业务代码只进入 `extensions/system/business/ai-assistant-mcp/`。
- 包与 ai-orchestrator 镜像版本为 2.1.4；cesium-mcp 使用自己的组件版本轴，当前同为 2.1.4。
- `vendor/cesium-mcp/` 是上游 pristine 子树，禁止手改；定制只进入 backend 自研层。
- 外部 LLM、MySQL、Redis、MinIO、Nacos、网关和真实运行数据均不属于源码迁移内容。
- 地理服务继续使用 geolocation-services 的既有公开契约，不在本包新增统一地理 API。
- 模板演示 `wind-field-demo` 仅属于模板工作区，禁止提测，不进入本包制品。
- `packages/` 与 `tools/dev-mcp/` 是模板供给物，只读使用；模板仓本身不由本仓修改。

## 本地检查

```bash
npm install
npm run check
npm run test:publish
npm run test:s11
./tools/check-extension-versions.sh
node tools/publish.mjs extensions/system/business/ai-assistant-mcp --check-only
```

Node 后端和 vendor 使用各自锁文件，安装、构建和真实工具链验收见包内 README。`--check-only` 不授权注册、上传或发布；真实外部 LLM 调用需要单独批准，开发 Mac 不启动完整推理环境。

## 包文档

- `extensions/system/business/ai-assistant-mcp/README.md`：组件、独立构建、运行和部署边界。
- `extensions/system/business/ai-assistant-mcp/contracts/README.md`：工具契约生成与漂移校验。
- `extensions/system/business/ai-assistant-mcp/data/menu.json`：真实菜单声明，保持既有 ID、权限和角色。
- `extensions/system/business/ai-assistant-mcp/container/`：orchestrator 与 cesium-mcp 的原生镜像构建入口。

本仓为公开仓。启用 `git config core.hooksPath .githooks` 后，pre-push 扫描内网地址与凭据；唯一精确例外是 AI 包指定 k8s YAML 中两处与既有部署契约同名的 Secret 资源名行，相似名称、其他环境引用和其他文件仍会拒绝。不得通过放宽闸口提交秘密。任何注册、发布、部署、远程数据写入、真实外部 LLM 调用和 Git commit/push 均需单独批准。
