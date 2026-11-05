//
// 文件作用：Node 发布器协议、产物、失败中止与本地闸口回归测试
// 作者：JasonLee <shuiyuntian@foxmail.com>
// 创建日期：2026-11-03
// 版本：1.1.0
// 修改记录：
//   - 1.1.0 (2026-11-05) 后端用例补 API 常量表与示例控制器，覆盖发布前 URL 契约闸口
//   - 1.0.0 (2026-11-03) 初始创建
//
// 版权所有 (C) 2026 AGRSEarth 项目

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import fsp from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as tar from "tar";
import undici from "undici";
import {
  parseArgs,
  resolveNetworkProfile,
  runPublish,
  topoSortServices,
  validateMenuDocument,
} from "../../tools/publish.mjs";

const { Request } = undici;
const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const silentLogger = { log() {}, error() {} };
let packageCounter = 0;

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function makePackage(t, options = {}) {
  packageCounter += 1;
  const id = `publish-test-${process.pid}-${packageCounter}`;
  const dir = path.join(REPO_ROOT, "extensions", "tool", "business", id);
  const type = options.type ?? "extension";
  const suite = type === "suite";
  const manifest = {
    id,
    name: "天气预报测试",
    version: "0.1.0",
    description: "中文发布协议测试",
    type,
    track: "tool",
    tier: "business",
    delivery: "optional",
    author: "测试团队",
    icon: "MapLocation",
    ...(suite ? { members: [{ packageId: "wind-field-demo", version: "1.2.3" }] } : {
      entries: { esm: { url: "" }, umd: { url: "" } },
      adminUi: { url: "" },
      components: {
        frontend: true,
        backend: [],
        adminUi: true,
        menu: { enabled: true, menuPath: id },
        data: false,
      },
      defaultConfig: { city: "北京" },
      dependsOnPackages: [{ packageId: "base-demo", minVersion: "1.0.0" }],
    }),
  };
  writeJson(path.join(dir, "manifest.json"), manifest);
  fs.writeFileSync(path.join(dir, "VERSION"), "0.1.0\n", "utf8");
  fs.writeFileSync(path.join(dir, "CHANGELOG.md"), "# 测试\n\n## [0.1.0] - 2026-11-03\n\n- 中文变更\n", "utf8");
  fs.writeFileSync(path.join(dir, "README.md"), "# 测试包\n", "utf8");
  if (!suite) {
    writeJson(path.join(dir, "frontend", "package.json"), { name: id, version: "0.1.0" });
    writeJson(path.join(dir, "admin-ui", "package.json"), { name: `${id}-admin`, version: "0.1.0" });
    fs.mkdirSync(path.join(dir, "frontend", "src"), { recursive: true });
    fs.writeFileSync(path.join(dir, "frontend", "src", "manifest.ts"), "export const manifest = {\n  version: '0.1.0'\n}\n", "utf8");
    fs.mkdirSync(path.join(dir, "frontend", "dist"), { recursive: true });
    fs.mkdirSync(path.join(dir, "admin-ui", "dist"), { recursive: true });
    fs.writeFileSync(path.join(dir, "frontend", "dist", "tool.es.js"), "console.log('天气')\n", "utf8");
    fs.writeFileSync(path.join(dir, "frontend", "dist", "tool.umd.js"), "console.log('预报')\n", "utf8");
    fs.writeFileSync(path.join(dir, "admin-ui", "dist", "admin.es.js"), "console.log('管理页')\n", "utf8");
    writeJson(path.join(dir, "data", "menu.json"), {
      schemaVersion: 1,
      packageId: id,
      menus: [{
        menuId: 2009000,
        menuName: "天气预报管理",
        parentId: 0,
        orderNum: 1,
        path: id,
        menuType: "M",
        visible: "0",
        status: "0",
        roleIds: [1],
      }],
    });
  }
  if (options.dataSql) {
    manifest.components.data = true;
    writeJson(path.join(dir, "manifest.json"), manifest);
    fs.mkdirSync(path.join(dir, "data", "sql"), { recursive: true });
    fs.writeFileSync(path.join(dir, "data", "sql", "001-init.sql"), "CREATE TABLE IF NOT EXISTS weather_forecast (id BIGSERIAL PRIMARY KEY, city TEXT);\n", "utf8");
  }
  if (options.backend) {
    const serviceId = `${id}-server`;
    manifest.components.backend = [serviceId];
    manifest.backendServices = [{
      serviceId,
      name: "后端服务",
      required: true,
      apiPrefix: `/${serviceId}`,
      healthEndpoint: `/${serviceId}/actuator/health`,
      imageSource: "self",
    }];
    writeJson(path.join(dir, "manifest.json"), manifest);
    fs.mkdirSync(path.join(dir, "container", serviceId), { recursive: true });
    fs.writeFileSync(path.join(dir, "container", serviceId, "VERSION"), "0.2.0\n", "utf8");
    fs.mkdirSync(path.join(dir, "deploy", "k8s"), { recursive: true });
    fs.writeFileSync(path.join(dir, "deploy", "k8s", "10-server.yaml"), `apiVersion: apps/v1\nkind: Deployment\nmetadata:\n  name: ${serviceId}\nspec:\n  template:\n    spec:\n      containers:\n        - image: localhost:32000/gis-platform/tool/business/${id}/${serviceId}:0.2.0\n`, "utf8");
    const api = `const SVC = '/${serviceId}'\nexport const API = {\n  exampleList: \`\${SVC}/example/list\`\n}\n`;
    for (const sourceRoot of ["frontend", "admin-ui"]) {
      fs.mkdirSync(path.join(dir, sourceRoot, "src", "api"), { recursive: true });
      fs.writeFileSync(path.join(dir, sourceRoot, "src", "api", "index.ts"), api, "utf8");
    }
    const controller = path.join(dir, "backend", serviceId, "src/main/java/demo/SampleController.java");
    fs.mkdirSync(path.dirname(controller), { recursive: true });
    fs.writeFileSync(controller, '@RequestMapping("/example")\nclass SampleController {\n  @GetMapping("/list")\n  public Object list() { return null; }\n}\n', "utf8");
  }
  if (options.bundle) {
    fs.mkdirSync(path.join(dir, "deploy", "k8s"), { recursive: true });
    fs.writeFileSync(path.join(dir, "deploy", "k8s", "10-a.yaml"), "apiVersion: v1\nkind: ConfigMap\nmetadata:\n  name: 天气\n", "utf8");
    fs.writeFileSync(path.join(dir, "deploy", "k8s", "20-b.yaml"), "---\napiVersion: v1\nkind: Service\nmetadata:\n  name: forecast\n", "utf8");
  }
  t.after(async () => fsp.rm(dir, { recursive: true, force: true }));
  return { id, dir, relative: `extensions/tool/business/${id}`, manifest };
}

async function startMockPlatform(t, options = {}) {
  const state = {
    requests: [],
    uploads: new Map(),
    sessions: new Map(),
    releaseComplete: 0,
    devBodies: [],
    imageChecks: 0,
  };
  const server = http.createServer(async (req, res) => {
    try {
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      const raw = Buffer.concat(chunks);
      const url = new URL(req.url, "http://localhost");
      if (req.method === "HEAD" && url.pathname.startsWith("/v2/")) {
        state.imageChecks += 1;
        res.writeHead(options.missingImage ? 404 : 200).end();
        return;
      }
      if (req.method === "GET" && url.pathname.startsWith("/artifacts/")) {
        const filename = decodeURIComponent(url.pathname.slice("/artifacts/".length));
        const content = state.uploads.get(filename);
        if (!content) {
          res.writeHead(404).end();
          return;
        }
        res.writeHead(200).end(content);
        return;
      }
      if (req.method === "POST" && url.pathname === "/minio/upload") {
        if (options.failMinio) {
          res.writeHead(403).end("SignatureDoesNotMatch");
          return;
        }
        const request = new Request("http://localhost/minio/upload", {
          method: "POST",
          headers: req.headers,
          body: raw,
        });
        const form = await request.formData();
        const file = form.get("file");
        state.uploads.set(file.name, Buffer.from(await file.arrayBuffer()));
        res.writeHead(204).end();
        return;
      }

      let body = null;
      if (raw.length) body = JSON.parse(raw.toString("utf8"));
      state.requests.push({ method: req.method, path: url.pathname, body, raw });
      const send = (data) => res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" }).end(JSON.stringify({ code: 200, data }));
      if (url.pathname.endsWith("/release-prepare")) {
        send({ packageCreated: true, packageUpdated: false, versionCreated: true, versionUpdated: false, publishStatus: 0 });
      } else if (url.pathname.endsWith("/upload-sessions")) {
        const uploadId = `upload-${state.sessions.size + 1}`;
        state.sessions.set(uploadId, body);
        send({
          uploadId,
          postUrl: `${state.origin}/minio/upload`,
          formFields: { key: `tool/business/test/0.1.0/${body.filename}`, policy: "签名政策", "x-amz-meta-package": "天气" },
        });
      } else if (url.pathname.includes("/upload-sessions/") && url.pathname.endsWith("/complete")) {
        const uploadId = url.pathname.split("/").at(-2);
        const session = state.sessions.get(uploadId);
        send({ artifactUrl: `${state.origin}/artifacts/${encodeURIComponent(session.filename)}` });
      } else if (url.pathname.endsWith("/release-complete")) {
        state.releaseComplete += 1;
        send({
          publishStatus: 1,
          dependenciesRegistered: body.dependencies.length,
          menuResult: { total: 1, inserted: 1, updated: 0, unchanged: 0, roleBindingsAdded: 1, warnings: [] },
          bundleResult: body.deploy ? { passed: true, message: "ok", docCount: 0, docs: [] } : null,
        });
      } else if (url.pathname.endsWith("/dev-url")) {
        state.devBodies.push(body);
        send({ changed: true, previousUrl: "http://old", esmUrl: body.reset ? "http://official" : body.esmUrl, objectKey: "manifest.json" });
      } else {
        res.writeHead(404, { "Content-Type": "application/json" }).end(JSON.stringify({ code: 404, msg: "not found" }));
      }
    } catch (error) {
      res.writeHead(500, { "Content-Type": "application/json" }).end(JSON.stringify({ code: 500, msg: error.stack }));
    }
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  state.origin = `http://127.0.0.1:${server.address().port}`;
  t.after(() => new Promise((resolve) => server.close(resolve)));
  return state;
}

function runOptions(state, traceFile) {
  return {
    env: {
      DC_API_BASE: `${state.origin}/developer-center/api/v1`,
      AGRSEARTH_TOKEN: "test-token",
      AGRSEARTH_NETWORK: "lan",
      AGRSEARTH_REGISTRY_API_BASE: state.origin,
      PUBLISH_TRACE_FILE: traceFile,
    },
    logger: silentLogger,
  };
}

test("完整发布保持中文、协议顺序、manifest 回填与安全记录", async (t) => {
  const pkg = makePackage(t, { bundle: true });
  const platform = await startMockPlatform(t);
  const traceFile = path.join(pkg.dir, "trace.json");
  await runPublish([pkg.relative, "--skip-build"], runOptions(platform, traceFile));

  const prepare = platform.requests.find((request) => request.path.endsWith("/release-prepare"));
  assert.equal(prepare.body.metadata.packageName, "天气预报测试");
  assert.equal(prepare.body.metadata.defaultConfig, JSON.stringify({ city: "北京" }));
  assert.equal(prepare.body.metadata.changelog, "- 中文变更");
  assert.equal(prepare.body.metadata.isDefault, 1);
  assert.ok(prepare.raw.toString("utf8").includes("天气预报测试"));

  assert.deepEqual([...platform.uploads.keys()], ["tool.es.js", "tool.umd.js", "admin.es.js", "manifest.json", "k8s-bundle.tar.gz", "menu.json"]);
  const publishedManifest = JSON.parse(platform.uploads.get("manifest.json").toString("utf8"));
  assert.match(publishedManifest.entries.esm.url, /\/artifacts\/tool\.es\.js$/);
  assert.match(publishedManifest.entries.umd.url, /\/artifacts\/tool\.umd\.js$/);
  assert.match(publishedManifest.adminUi.url, /\/artifacts\/admin\.es\.js$/);
  const complete = platform.requests.find((request) => request.path.endsWith("/release-complete"));
  assert.equal(complete.body.menuJson.menus[0].menuName, "天气预报管理");
  assert.equal(complete.body.dependencies[0].minVersion, "1.0.0");
  assert.equal(complete.body.dependencies[0].maxVersion, null);
  assert.equal(complete.body.deploy, false);
  assert.equal(platform.releaseComplete, 1);

  const trace = JSON.parse(fs.readFileSync(traceFile, "utf8"));
  assert.equal(trace[0].step, "release-prepare");
  const releaseCompleteIndex = trace.findIndex((entry) => entry.step === "release-complete");
  const firstSmokeIndex = trace.findIndex((entry) => entry.step === "smoke");
  assert.equal(releaseCompleteIndex, firstSmokeIndex - 1);
  assert.equal(trace.at(-1).step, "smoke");
  assert.ok(trace.some((entry) => entry.step === "minio-upload" && entry.file.filename === "menu.json"));
  assert.ok(!JSON.stringify(trace).includes("test-token"));
  assert.ok(!JSON.stringify(trace).includes("签名政策"));

  const extractDir = await fsp.mkdtemp(path.join(os.tmpdir(), "publish-bundle-test-"));
  t.after(() => fsp.rm(extractDir, { recursive: true, force: true }));
  const bundle = path.join(extractDir, "bundle.tar.gz");
  fs.writeFileSync(bundle, platform.uploads.get("k8s-bundle.tar.gz"));
  await tar.x({ file: bundle, cwd: extractDir });
  const yaml = fs.readFileSync(path.join(extractDir, "k8s-bundle.yaml"), "utf8");
  assert.ok(yaml.includes("name: 天气"));
  assert.ok(yaml.includes("---\napiVersion: v1\nkind: Service"));
});

test("MinIO 失败立即中止且不执行 release-complete", async (t) => {
  const pkg = makePackage(t);
  const platform = await startMockPlatform(t, { failMinio: true });
  await assert.rejects(
    runPublish([pkg.relative, "--skip-build"], runOptions(platform)),
    /MinIO 直传失败/,
  );
  assert.equal(platform.releaseComplete, 0);
  assert.equal(platform.requests.filter((request) => request.path.endsWith("/upload-sessions")).length, 1);
});

test("dev-url 设置与 reset 请求契约一致", async (t) => {
  const pkg = makePackage(t);
  const platform = await startMockPlatform(t);
  await runPublish([pkg.relative, "--dev-url", "http://192.0.2.1:5173/"], runOptions(platform));
  await runPublish([pkg.relative, "--dev-url", "--reset"], runOptions(platform));
  assert.deepEqual(platform.devBodies, [
    { version: "0.1.0", esmUrl: "http://192.0.2.1:5173/", reset: false },
    { version: "0.1.0", reset: true },
  ]);
  assert.equal(platform.releaseComplete, 0);
});

test("suite 零产物发布并生成成员 pin 依赖", async (t) => {
  const pkg = makePackage(t, { type: "suite" });
  const platform = await startMockPlatform(t);
  await runPublish([pkg.relative, "--skip-build"], runOptions(platform));
  const complete = platform.requests.find((request) => request.path.endsWith("/release-complete"));
  assert.deepEqual(complete.body.dependencies, [{
    dependsOnPackageId: "wind-field-demo",
    minVersion: "1.2.3",
    maxVersion: "1.2.3",
  }]);
  assert.equal(platform.uploads.size, 0);
  assert.equal(platform.releaseComplete, 1);
});

test("data/sql 上传原文与 SHA-256 并随 release-complete 提交", async (t) => {
  const pkg = makePackage(t, { dataSql: true });
  const platform = await startMockPlatform(t);
  await runPublish([pkg.relative, "--skip-build"], runOptions(platform));
  const complete = platform.requests.find((request) => request.path.endsWith("/release-complete"));
  assert.equal(complete.body.dataSql.length, 1);
  assert.equal(complete.body.dataSql[0].filename, "001-init.sql");
  assert.match(complete.body.dataSql[0].content, /CREATE TABLE IF NOT EXISTS weather_forecast/);
  assert.match(complete.body.dataSql[0].sha256, /^[0-9a-f]{64}$/);
  assert.ok(platform.uploads.has("001-init.sql"));
});

test("backendResources 保持整数 required 与组件版本轴", async (t) => {
  const pkg = makePackage(t, { backend: true });
  const platform = await startMockPlatform(t);
  await runPublish([pkg.relative, "--skip-build"], runOptions(platform));
  const prepare = platform.requests.find((request) => request.path.endsWith("/release-prepare"));
  assert.equal(prepare.body.backendResources.length, 1);
  assert.equal(prepare.body.backendResources[0].required, 1);
  assert.equal(prepare.body.backendResources[0].sortNo, 1);
  assert.equal(prepare.body.backendResources[0].artifactUrl, `localhost:32000/gis-platform/tool/business/${pkg.id}/${pkg.id}-server:0.2.0`);
});

test("deploy 前逐镜像执行 registry HEAD 预检", async (t) => {
  const pkg = makePackage(t, { backend: true });
  const platform = await startMockPlatform(t);
  await runPublish([pkg.relative, "--skip-build", "--deploy"], runOptions(platform));
  assert.equal(platform.imageChecks, 1);
  assert.equal(platform.releaseComplete, 1);
});

test("check-only 无需 token 且只执行本地校验", async (t) => {
  const pkg = makePackage(t);
  await runPublish([pkg.relative, "--check-only"], {
    env: { AGRSEARTH_NETWORK: "lan" },
    logger: silentLogger,
  });
});

test("本地闸口覆盖菜单、拓扑、网络画像和参数", () => {
  assert.deepEqual(validateMenuDocument({
    schemaVersion: 1,
    packageId: "demo",
    menus: [{ menuId: 100000, menuName: "非法", parentId: 0, orderNum: 1, path: "bad", menuType: "M" }],
  }, "demo").some((error) => error.includes("隔离带")), true);
  assert.deepEqual(topoSortServices([
    { serviceId: "b", dependsOn: ["a"] },
    { serviceId: "a" },
  ]).map((service) => service.serviceId), ["a", "b"]);
  assert.throws(() => topoSortServices([
    { serviceId: "a", dependsOn: ["b"] },
    { serviceId: "b", dependsOn: ["a"] },
  ]), /循环依赖/);
  assert.equal(resolveNetworkProfile("http://100.64.0.4:18801/api", ""), "tailscale");
  assert.equal(resolveNetworkProfile("http://10.82.11.51:18801/api", ""), "lan");
  assert.throws(() => resolveNetworkProfile("http://example.com/api", ""), /无法从网关地址推导/);
  assert.throws(() => parseArgs(["demo", "--prod"]), /不接受环境参数/);
  assert.throws(() => parseArgs(["demo", "--reset"]), /必须与 --dev-url 连用/);
});
