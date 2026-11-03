# publish golden master

- `kimi-publish-demo-20261103-0.1.0-bash.json`：2026-11-03 在 macOS 用旧版 `publish.sh`（应用交接的 UTF-8 止血补丁）经 SSH SOCKS5 对 aiearth01 成功发布的真实请求记录。中文菜单 `inserted=3`，7 个产物冒烟通过。
- `kimi-publish-demo-20261103-0.1.0-node.json`：Node 发布器在本地模拟 DC/MinIO 上对同一输入的重放记录。23 个非冒烟请求的方法、路径、JSON 语义、文件 SHA-256 和 multipart 字段集合与 bash 一致。

记录不包含 token、PostPolicy 签名原文或 Secret；表单值只保存 SHA-256。上传会话 ID 在比较时归一化，表单仅比较字段集合。

重新生成 Node 记录时，先下载 golden 版本的 `k8s-bundle.tar.gz` 作为重放输入，再运行：

```bash
node tests/replay-publish-golden.mjs \
  extensions/tool/business/kimi-publish-demo-20261103 \
  tests/fixtures/publish-golden/kimi-publish-demo-20261103-0.1.0-bash.json \
  tests/fixtures/publish-golden/kimi-publish-demo-20261103-0.1.0-node.json \
  /tmp/kimi-publish-demo-0.1.0-golden-bundle.tar.gz
```

真实 DEMO 包按交接纪律不入仓；固定 fixture 的自动比较由 `tests/unit/publish-golden.test.mjs` 执行。
