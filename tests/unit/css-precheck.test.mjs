// 文件作用：B1 CSS 构建产物与发布预检零网络正负例
// 作者：JasonLee <shuiyuntian@foxmail.com>
// 创建日期：2026-11-13
// 版本：1.0.0
// 修改记录：
//   - 1.0.0 (2026-11-13) 覆盖双夹具产物、check-only 与正式发布前 fail-fast
// 版权所有 (C) 2026 AGRSEarth 项目

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { validateExtensionCss, validateExtensionCssPackage } from "@agrsearth/vite-config/css-scope";
import { runPublish } from "../../tools/publish.mjs";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const silentLogger = { log() {}, error() {} };
let sequence = 0;

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function makePackage(t) {
  const id = `css-precheck-test-${process.pid}-${++sequence}`;
  const dir = path.join(REPO_ROOT, "extensions", "tool", "business", id);
  writeJson(path.join(dir, "manifest.json"), {
    id,
    name: "CSS 预检测试",
    version: "0.1.0",
    type: "extension",
    track: "tool",
    tier: "business",
    delivery: "optional",
    icon: "MapLocation",
    entries: { esm: { url: "" }, umd: { url: "" } },
    components: { frontend: true, backend: [], adminUi: false, menu: { enabled: false }, data: false },
  });
  fs.writeFileSync(path.join(dir, "VERSION"), "0.1.0\n");
  fs.writeFileSync(path.join(dir, "README.md"), "# CSS 预检测试\n");
  fs.writeFileSync(path.join(dir, "CHANGELOG.md"), "# 测试\n\n## [0.1.0] - 2026-11-13\n\n- 测试\n");
  writeJson(path.join(dir, "frontend", "package.json"), { name: id, version: "0.1.0" });
  fs.mkdirSync(path.join(dir, "frontend", "src"), { recursive: true });
  fs.mkdirSync(path.join(dir, "frontend", "dist"), { recursive: true });
  fs.writeFileSync(path.join(dir, "frontend", "src", "manifest.ts"), "export const manifest = {\n  version: '0.1.0'\n}\n");
  fs.writeFileSync(path.join(dir, "frontend", "src", "panel.css"), "@tailwind utilities;\n.shared-card { color: red; }\n");
  fs.writeFileSync(path.join(dir, "frontend", "dist", "tool.es.js"), "export default {};\n");
  fs.writeFileSync(path.join(dir, "frontend", "dist", "tool.umd.js"), "window.test = {};\n");
  fs.writeFileSync(path.join(dir, "frontend", "dist", "tool.css"), `[data-cap-package="${id}"] .shared-card { color: red; }\n`);
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return { id, dir, relative: `extensions/tool/business/${id}` };
}

function options() {
  return {
    env: {
      DC_API_BASE: "http://127.0.0.1:9/developer-center/api/v1",
      AGRSEARTH_NETWORK: "lan",
      AGRSEARTH_TOKEN: "test-token",
    },
    logger: silentLogger,
  };
}

test("两个独立构建夹具的相同类名和 keyframes 均有各自包作用域", () => {
  for (const id of ["css-fixture-a", "css-fixture-b"]) {
    const file = path.join(REPO_ROOT, "tests", "fixtures", "css-isolation", "packages", id, "dist", "tool.css");
    const css = fs.readFileSync(file, "utf8");
    assert.equal(validateExtensionCss(css, id, file), true);
    assert.ok(css.includes(`[data-cap-package=${id}] .shared-card`));
    assert.ok(css.includes(`[data-cap-package=${id}] .shared-overlay`));
    assert.ok(css.includes(`@keyframes cap-${id}-shared-pulse`));
    assert.ok(!css.includes("@tailwind base"));
  }
});

test("check-only 接受合法作用域 CSS 且不需要真实平台", async t => {
  const pkg = makePackage(t);
  await runPublish([pkg.relative, "--check-only"], options());
  assert.equal(validateExtensionCssPackage(pkg.dir, pkg.id).artifacts.length, 1);
});

test("check-only 拒绝未作用域产物与 Preflight 源码", async t => {
  const pkg = makePackage(t);
  fs.writeFileSync(path.join(pkg.dir, "frontend", "dist", "tool.css"), ".shared-card { color: blue; }\n");
  await assert.rejects(runPublish([pkg.relative, "--check-only"], options()), /选择器未限定/);

  fs.writeFileSync(path.join(pkg.dir, "frontend", "dist", "tool.css"), `[data-cap-package="${pkg.id}"] .shared-card { color: red; }\n`);
  fs.writeFileSync(path.join(pkg.dir, "frontend", "src", "panel.css"), "@tailwind base;\n");
  await assert.rejects(runPublish([pkg.relative, "--check-only"], options()), /禁止 Tailwind Preflight/);
});

test("正式发布在 release-prepare 前拒绝非法 CSS", async t => {
  const pkg = makePackage(t);
  fs.writeFileSync(path.join(pkg.dir, "frontend", "dist", "tool.css"), ".shared-card { color: blue; }\n");
  await assert.rejects(runPublish([pkg.relative, "--skip-build"], options()), /选择器未限定/);
});
