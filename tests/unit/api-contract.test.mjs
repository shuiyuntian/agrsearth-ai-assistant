//
// 文件作用：前后端 URL 契约静态对账单元测试（Node test，无新增依赖）
// 作者：JasonLee <shuiyuntian@foxmail.com>
// 创建日期：2026-11-05
// 版本：1.0.0
// 修改记录：
//   - 1.0.0 (2026-11-05) 覆盖双向 diff、路径变量、散落 URL 与动态语法 fail-fast
//
// 版权所有 (C) 2026 AGRSEarth 项目

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { checkApiContract, formatApiContractReport } from "../../tools/check-api-contract.mjs";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

function write(file, content) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content, "utf8");
}

function makePackage(t, options = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "agrsearth-api-contract-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const serviceId = options.serviceId ?? "demo-server";
  const publicService = options.publicService === false ? [] : [{
    serviceId,
    apiPrefix: `/${serviceId}`,
  }];
  write(path.join(dir, "manifest.json"), `${JSON.stringify({
    id: "demo",
    components: { frontend: true, adminUi: true, backend: publicService.map((service) => service.serviceId) },
    backendServices: publicService,
  }, null, 2)}\n`);
  const api = options.api ?? `const SVC = '/${serviceId}'\n\nexport const API = {\n  exampleList: \`\${SVC}/example/list\`\n} as const\n`;
  write(path.join(dir, "frontend/src/api/index.ts"), api);
  write(path.join(dir, "admin-ui/src/api/index.ts"), api);
  const java = options.java ?? `package demo;\n\n@RestController\n@RequestMapping("/example")\npublic class SampleController {\n  @GetMapping("/list")\n  public Object list() { return null; }\n}\n`;
  write(path.join(dir, "backend", serviceId, "src/main/java/demo/SampleController.java"), java);
  return { dir, serviceId };
}

test("公开服务端点与球端/管理页常量表双向一致", (t) => {
  const pkg = makePackage(t);
  const report = checkApiContract(pkg.dir);
  assert.equal(report.skipped, false);
  assert.equal(report.endpointCount, 1);
  assert.deepEqual(report.services[0].frontend, ["/demo-server/example/list"]);
  assert.match(formatApiContractReport(report), /1 个公开服务、1 个端点/);
});

test("类级 path、方法路径与路径变量归一化后一致", (t) => {
  const pkg = makePackage(t, {
    api: `const SVC = '/demo-server'\nexport const API = {\n  detail: \`\${SVC}/example/\${id}\`\n}\n`,
    java: `@RequestMapping(path = "/example")\nclass SampleController {\n  @GetMapping("/{id}")\n  public Object detail() { return null; }\n}\n`,
  });
  assert.equal(checkApiContract(pkg.dir).services[0].frontend[0], "/demo-server/example/{id}");
});

test("前端声明但后端缺失时阻塞", (t) => {
  const pkg = makePackage(t, {
    api: `const SVC = '/demo-server'\nexport const API = {\n  exampleList: \`\${SVC}/example/list\`,\n  missing: \`\${SVC}/example/missing\`\n}\n`,
  });
  assert.throws(() => checkApiContract(pkg.dir), /前端声明但后端缺失：\/demo-server\/example\/missing/);
});

test("后端存在但前端未声明时阻塞", (t) => {
  const pkg = makePackage(t, {
    java: `@RequestMapping("/example")\nclass SampleController {\n  @GetMapping("/list")\n  public Object list() { return null; }\n  @PostMapping\n  public Object create() { return null; }\n}\n`,
  });
  assert.throws(() => checkApiContract(pkg.dir), /后端存在但前端未声明：\/demo-server\/example$/m);
});

test("错误 serviceId 与业务文件散落 URL 均给出具体位置", (t) => {
  const wrong = makePackage(t, {
    api: `const SVC = '/wrong-server'\nexport const API = {\n  exampleList: \`\${SVC}/example/list\`\n}\n`,
  });
  assert.throws(() => checkApiContract(wrong.dir), /未命中任何公开 apiPrefix/);

  const scattered = makePackage(t);
  write(path.join(scattered.dir, "frontend/src/views/demo.ts"), `export const url = '/demo-server/example/list'\n`);
  assert.throws(() => checkApiContract(scattered.dir), /frontend\/src\/views\/demo.ts 散落本包服务 URL/);
});

test("无法静态解析的动态 URL 不静默放行", (t) => {
  const pkg = makePackage(t, {
    api: `const SVC = '/demo-server'\nexport const API = {\n  detail: \`\${SVC}/example/\${encodeURIComponent(id)}\`\n}\n`,
  });
  assert.throws(() => checkApiContract(pkg.dir), /无法静态解析的表达式/);
});

test("无公开后端服务与纯后端包明确跳过", (t) => {
  const noBackend = makePackage(t, { publicService: false });
  assert.match(formatApiContractReport(checkApiContract(noBackend.dir)), /跳过/);

  const backendOnly = makePackage(t);
  const manifestFile = path.join(backendOnly.dir, "manifest.json");
  const manifest = JSON.parse(fs.readFileSync(manifestFile, "utf8"));
  manifest.components = { frontend: false, adminUi: false, backend: [backendOnly.serviceId] };
  fs.rmSync(path.join(backendOnly.dir, "frontend"), { recursive: true, force: true });
  fs.rmSync(path.join(backendOnly.dir, "admin-ui"), { recursive: true, force: true });
  write(manifestFile, JSON.stringify(manifest));
  assert.match(formatApiContractReport(checkApiContract(backendOnly.dir)), /无球端或管理页/);
});

test("公开服务缺少后端源码目录时失败", (t) => {
  const pkg = makePackage(t);
  fs.rmSync(path.join(pkg.dir, "backend", pkg.serviceId), { recursive: true, force: true });
  assert.throws(() => checkApiContract(pkg.dir), /缺少源码目录/);
});

test("两套骨架的 API 常量表采用可解析单源格式", (t) => {
  for (const relative of ["skeletons/tool/frontend/src/api/index.ts", "skeletons/admin-ui/src/api/index.ts"]) {
    const api = fs.readFileSync(path.join(REPO_ROOT, relative), "utf8");
    const pkg = makePackage(t, { api, serviceId: "example-server" });
    assert.equal(checkApiContract(pkg.dir).endpointCount, 1, relative);
  }
});
