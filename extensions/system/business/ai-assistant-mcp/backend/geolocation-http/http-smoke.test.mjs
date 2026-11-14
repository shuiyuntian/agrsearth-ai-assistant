// 文件作用：geolocation MCP 到 Overpass 的本地真实链路回归测试
// 作者：JasonLee <shuiyuntian@foxmail.com>
// 创建日期：2026-11-10
// 版本：1.0.0
// 修改记录：
//   - 1.0.0 (2026-11-10) 初始创建
// 版权所有 (C) 2026 AGRSEarth 项目

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import http from "node:http";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const GEO_SERVER_DIR = path.resolve(HERE, "..", "..", "vendor", "cesium-mcp", "geolocation-server");

function vendorEsmEntry(subpath) {
  const req = createRequire(path.join(GEO_SERVER_DIR, "package.json"));
  return req.resolve(`@modelcontextprotocol/sdk/${subpath}`)
    .replace(`${path.sep}dist${path.sep}cjs${path.sep}`, `${path.sep}dist${path.sep}esm${path.sep}`);
}

async function listen(server) {
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  return server.address().port;
}

async function waitForHealth(port, child, logs) {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    if (child.exitCode !== null) throw new Error(`geolocation-http 提前退出：\n${logs.join("")}`);
    try {
      const response = await fetch(`http://127.0.0.1:${port}/health`);
      if (response.ok) return;
    } catch {
      // 启动等待
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`geolocation-http 启动超时：\n${logs.join("")}`);
}

test("geolocation_extent 经 307 重定向完成 Overpass 查询", { timeout: 20_000 }, async (t) => {
  let queryCount = 0;
  const overpass = http.createServer((req, res) => {
    if (req.method === "POST" && req.url === "/api/interpreter") {
      queryCount += 1;
      res.writeHead(307, { Location: "/api/final" });
      res.end();
      return;
    }
    if (req.method === "POST" && req.url === "/api/final") {
      queryCount += 1;
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({
        elements: [{
          type: "relation",
          id: 9511883,
          bounds: { minlat: 39.9116214, minlon: 116.386202, maxlat: 39.9211913, maxlon: 116.3953903 },
          tags: { name: "故宫" },
        }],
      }));
      return;
    }
    res.writeHead(404).end();
  });
  const overpassPort = await listen(overpass);

  const portServer = http.createServer();
  const port = await listen(portServer);
  await new Promise((resolve) => portServer.close(resolve));

  const logs = [];
  const child = spawn(process.execPath, [path.join(HERE, "server.mjs")], {
    env: {
      ...process.env,
      PORT: String(port),
      OVERPASS_SERVER_URL: `http://127.0.0.1:${overpassPort}/api/interpreter`,
      NOMINATIM_SERVER_URL: `http://127.0.0.1:${overpassPort}`,
      OSRM_SERVER_URL: `http://127.0.0.1:${overpassPort}`,
      HTTP_PROXY: "http://127.0.0.1:1",
      HTTPS_PROXY: "http://127.0.0.1:1",
      NO_PROXY: "127.0.0.1,localhost",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout.on("data", (data) => logs.push(data.toString()));
  child.stderr.on("data", (data) => logs.push(data.toString()));

  let client;
  t.after(async () => {
    if (client) await client.close();
    if (child.exitCode === null) {
      child.kill("SIGTERM");
      await new Promise((resolve) => {
        const timer = setTimeout(resolve, 3000);
        child.once("exit", () => {
          clearTimeout(timer);
          resolve();
        });
      });
    }
    await new Promise((resolve) => overpass.close(resolve));
  });

  await waitForHealth(port, child, logs);
  const { Client } = await import(pathToFileURL(vendorEsmEntry("client/index.js")).href);
  const { StreamableHTTPClientTransport } = await import(
    pathToFileURL(vendorEsmEntry("client/streamableHttp.js")).href
  );
  client = new Client({ name: "geolocation-http-smoke", version: "1.0.0" });
  await client.connect(new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${port}/mcp`)));
  const result = await client.callTool({
    name: "geolocation_extent",
    arguments: { name: "故宫", at: { latitude: 39.9163, longitude: 116.3972 } },
  });

  assert.equal(result.isError, false, JSON.stringify(result));
  assert.equal(result.structuredContent.found, true);
  assert.equal(result.structuredContent.osmId, 9511883);
  assert.equal(queryCount, 2);
});
