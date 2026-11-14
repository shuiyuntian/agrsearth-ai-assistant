// 文件作用：Undici TLS、重定向与 NO_PROXY 本地回归测试
// 作者：JasonLee <shuiyuntian@foxmail.com>
// 创建日期：2026-11-10
// 版本：1.0.0
// 修改记录：
//   - 1.0.0 (2026-11-10) 初始创建
// 版权所有 (C) 2026 AGRSEarth 项目

import { test } from "node:test";
import assert from "node:assert/strict";
import { execFile as execFileCallback } from "node:child_process";
import { createServer as createHttpsServer } from "node:https";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const execFile = promisify(execFileCallback);

test("EnvHttpProxyAgent：受信 TLS + 307 重定向 + NO_PROXY 直连", { timeout: 15_000 }, async (t) => {
  const dir = await mkdtemp(path.join(tmpdir(), "geolocation-undici-"));
  const keyPath = path.join(dir, "localhost.key");
  const certPath = path.join(dir, "localhost.crt");
  await execFile("openssl", [
    "req", "-x509", "-newkey", "rsa:2048", "-nodes",
    "-keyout", keyPath, "-out", certPath, "-days", "1",
    "-subj", "/CN=localhost",
    "-addext", "subjectAltName=DNS:localhost,IP:127.0.0.1",
  ]);

  const server = createHttpsServer(
    { key: await readFile(keyPath), cert: await readFile(certPath) },
    (req, res) => {
      if (req.url === "/redirect") {
        res.writeHead(307, { Location: "/final" });
        res.end();
        return;
      }
      if (req.url === "/final") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: true }));
        return;
      }
      res.writeHead(404).end();
    },
  );
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();

  const script = `
    import { EnvHttpProxyAgent, fetch, setGlobalDispatcher } from "undici";
    setGlobalDispatcher(new EnvHttpProxyAgent());
    const response = await fetch(process.env.TEST_URL);
    const body = await response.json();
    if (!response.ok || !response.redirected || body.ok !== true) {
      throw new Error(JSON.stringify({ status: response.status, redirected: response.redirected, body }));
    }
    console.log(JSON.stringify({ status: response.status, redirected: response.redirected, body }));
  `;
  const { stdout } = await execFile(process.execPath, ["--input-type=module", "-e", script], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      NODE_EXTRA_CA_CERTS: certPath,
      HTTP_PROXY: "http://127.0.0.1:1",
      HTTPS_PROXY: "http://127.0.0.1:1",
      NO_PROXY: "127.0.0.1,localhost",
      TEST_URL: `https://localhost:${port}/redirect`,
    },
  });
  assert.deepEqual(JSON.parse(stdout.trim()), {
    status: 200,
    redirected: true,
    body: { ok: true },
  });

  await new Promise((resolve) => server.close(resolve));
  await rm(dir, { recursive: true, force: true });
});
