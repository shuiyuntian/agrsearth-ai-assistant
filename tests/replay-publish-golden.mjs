//
// 文件作用：以本地模拟 DC/MinIO 重放发布输入并生成 Node golden 记录
// 作者：JasonLee <shuiyuntian@foxmail.com>
// 创建日期：2026-11-03
// 版本：1.0.0
// 修改记录：
//   - 1.0.0 (2026-11-03) 初始创建
//
// 版权所有 (C) 2026 AGRSEarth 项目

import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import undici from "undici";
import { runPublish } from "../tools/publish.mjs";

const { Request } = undici;
const [pkgDir, goldenFile, nodeTraceFile, replayBundleFile] = process.argv.slice(2);
if (!pkgDir || !goldenFile || !nodeTraceFile) {
  throw new Error("用法：node tests/replay-publish-golden.mjs <pkg-dir> <bash-golden.json> <node-trace.json> [golden-bundle.tar.gz]");
}
const manifest = JSON.parse(fs.readFileSync(path.join(pkgDir, "manifest.json"), "utf8"));
const uploads = new Map();
const sessions = new Map();
const server = http.createServer(async (req, res) => {
  try {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const raw = Buffer.concat(chunks);
    const url = new URL(req.url, "http://localhost");
    if (req.method === "POST" && url.pathname === "/gis-platform-resources") {
      const request = new Request("http://localhost/gis-platform-resources", { method: "POST", headers: req.headers, body: raw });
      const form = await request.formData();
      const file = form.get("file");
      uploads.set(file.name, Buffer.from(await file.arrayBuffer()));
      res.writeHead(204).end();
      return;
    }
    const body = raw.length ? JSON.parse(raw.toString("utf8")) : null;
    const send = (data) => res.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify({ code: 200, data }));
    if (url.pathname.endsWith("/release-prepare")) {
      send({ packageCreated: false, packageUpdated: false, versionCreated: true, versionUpdated: false, publishStatus: 0 });
    } else if (url.pathname.endsWith("/upload-sessions")) {
      const uploadId = `replay-${sessions.size + 1}`;
      sessions.set(uploadId, body);
      send({
        uploadId,
        postUrl: `${origin}/gis-platform-resources`,
        formFields: {
          "x-amz-date": "replay-date",
          "x-amz-signature": "replay-signature",
          "x-amz-algorithm": "AWS4-HMAC-SHA256",
          "x-amz-credential": "replay-credential",
          policy: "replay-policy",
          key: `tool/business/${manifest.id}/${manifest.version}/${body.filename}`,
        },
      });
    } else if (url.pathname.includes("/upload-sessions/") && url.pathname.endsWith("/complete")) {
      const uploadId = url.pathname.split("/").at(-2);
      const session = sessions.get(uploadId);
      send({ artifactUrl: `http://10.82.11.51:18880/plugins/tool/business/${manifest.id}/${manifest.version}/${session.filename}` });
    } else if (url.pathname.endsWith("/release-complete")) {
      send({ publishStatus: 1, dependenciesRegistered: body.dependencies.length, menuResult: null, bundleResult: null });
    } else {
      res.writeHead(404, { "Content-Type": "application/json" }).end(JSON.stringify({ code: 404, msg: "not found" }));
    }
  } catch (error) {
    res.writeHead(500, { "Content-Type": "application/json" }).end(JSON.stringify({ code: 500, msg: error.stack }));
  }
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
try {
  await runPublish([pkgDir, "--skip-build"], {
    env: {
      DC_API_BASE: `${origin}/developer-center/api/v1`,
      AGRSEARTH_TOKEN: "test-token",
      AGRSEARTH_NETWORK: "lan",
      PUBLISH_TRACE_FILE: nodeTraceFile,
    },
    logger: { log() {}, error() {} },
    skipSmoke: true,
    replayBundleFile,
  });
} finally {
  await new Promise((resolve) => server.close(resolve));
}

function normalized(entries) {
  return entries.filter((entry) => entry.step !== "smoke").map((entry) => {
    if (entry.step === "upload-complete") {
      return { ...entry, path: entry.path.replace(/\/upload-sessions\/[^/]+\/complete$/, "/upload-sessions/{uploadId}/complete") };
    }
    if (entry.step === "minio-upload") {
      return { ...entry, formFields: Object.keys(entry.formFields).sort() };
    }
    return entry;
  });
}

const expected = normalized(JSON.parse(fs.readFileSync(goldenFile, "utf8")));
const actual = normalized(JSON.parse(fs.readFileSync(nodeTraceFile, "utf8")));
assert.deepEqual(actual, expected);
console.log(`golden master 对拍通过：${actual.length} 个请求，方法/路径/JSON/文件 SHA-256/multipart 字段集合一致`);
