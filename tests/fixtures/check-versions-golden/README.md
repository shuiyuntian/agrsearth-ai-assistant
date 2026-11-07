# check-versions golden master

- `cases/<case>/`：手工构造的 9 个夹具包树（每个 case 是一个迷你仓根，含 `extensions/<track>/<tier>/<pkg>/`）+ `expected.json`（2026-11-07 在 macOS 用 bash 版 `tools/check-extension-versions.sh` 1.0.0 + `tools/menujson.py` 捕获的 stdout 原文与退出码）。
- 用例覆盖：`pass-minimal`（全过 + 无 track 字段包被过滤）、`pass-full`（组件版本轴 `$(cat VERSION)` + DESIGN 状态行 + 合法 menu.json）、`mismatch-manifest` / `mismatch-frontend` / `mismatch-ts` / `mismatch-buildsh`（组件轴 + 包轴各一）、`missing-required`（缺 CHANGELOG.md）、`design-no-status`、`menu-invalid`（menuId 落 100000-999999 隔离带）。
- 表格列宽按 **UTF-8 字节**补 padding（bash `printf %-Ns` 语义），Node 版以 `Buffer.byteLength` 复刻。

Node 版的 menu.json 校验复用 `tools/publish.mjs` 的 `validateMenuDocument`（JS 单实现），规则与 `menujson.py validate` 等价（`menu-invalid` 用例双向背书）；失败详情文案保留「未通过 tools/menujson.py validate」原措辞以维持 golden 字节一致。

固定 fixture 的自动比较由 `tests/unit/check-versions-golden.test.mjs` 执行；手动重放：

```bash
node tests/replay-check-versions-golden.mjs
```

重新捕获：把 bash 版 `tools/check-extension-versions.sh` 从 git 历史恢复到 `tools/`（menujson.py 仍在），跑 `node tests/capture-check-versions-golden.mjs`，再恢复薄 shim。夹具树本身有意变更时直接改 `cases/<case>/` 并重捕。
