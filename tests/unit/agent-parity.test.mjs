//
// 文件作用：跨 coding agent 资产一致性与 doctor 检测单元测试
// 作者：JasonLee <shuiyuntian@foxmail.com>
// 创建日期：2026-11-06
// 版本：1.0.0
// 修改记录：
//   - 1.0.0 (2026-11-06) 覆盖 Skill 漂移、MCP 配置与 CLI 检测
//
// 版权所有 (C) 2026 AGRSEarth 项目

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { checkAgentParity } from "../../tools/check-agent-parity.mjs";
import { checkClient, codexMcpConfigured, projectMcpConfigured } from "../../tools/agent-doctor.mjs";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

test("当前七客户端 Skill 与 MCP 权威入口一致", () => {
  assert.deepEqual(checkAgentParity(REPO_ROOT), []);
});

test("七端项目级 MCP 配置均可被 doctor 识别", () => {
  for (const client of ["kimi", "codex", "claude", "qoder", "opencode", "trae", "codebuddy"]) {
    assert.equal(checkClient(client, { root: REPO_ROOT }).passed, true, client);
  }
});

test("任一客户端 Skill 漂移都会被闸口发现", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "agent-parity-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  for (const relative of [
    ".kimi-code/skills/agrsearth-plugin-dev/SKILL.md",
    ".agents/skills/agrsearth-plugin-dev/SKILL.md",
    ".claude/skills/agrsearth-plugin-dev/SKILL.md",
    ".qoder/skills/agrsearth-plugin-dev/SKILL.md",
    ".trae/skills/agrsearth-plugin-dev/SKILL.md",
    ".codebuddy/skills/agrsearth-plugin-dev/SKILL.md",
    ".kimi-code/mcp.json",
    ".codex/config.toml",
    ".qoder/settings.json",
    ".trae/mcp.json",
    ".mcp.json",
    "opencode.json",
    "AGENTS.md",
    "tools/agent-doctor.mjs",
    "docs/AGENT_PARITY.md",
  ]) {
    const target = path.join(root, relative);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(path.join(REPO_ROOT, relative), target);
  }
  fs.appendFileSync(path.join(root, ".qoder/skills/agrsearth-plugin-dev/SKILL.md"), "\n漂移\n");
  assert.ok(checkAgentParity(root).some((error) => error.includes("Skill 与权威源不一致")));
});

test("Codex TOML 必须包含独立 agrsearth-dev stdio 配置", () => {
  assert.equal(codexMcpConfigured(`[mcp_servers.agrsearth-dev]\ncommand = "node"\nargs = ["tools/dev-mcp/server.mjs"]\n`), true);
  assert.equal(codexMcpConfigured(`[mcp_servers.other]\ncommand = "node"\n`), false);
  assert.equal(codexMcpConfigured(`[mcp_servers.agrsearth-dev]\ncommand = "node"\nargs = ["wrong/server.mjs"]\n`), false);
});

test("doctor 同时检查 MCP 与 Skill，不被单一成功项误导", (t) => {
  const configured = checkClient("claude", {
    root: REPO_ROOT,
    runner: () => ({ status: 0, stdout: "agrsearth-dev -> node tools/dev-mcp/server.mjs" }),
  });
  assert.equal(configured.passed, true);

  const root = fs.mkdtempSync(path.join(os.tmpdir(), "agent-doctor-missing-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  for (const relative of [".kimi-code/skills/agrsearth-plugin-dev/SKILL.md", ".qoder/skills/agrsearth-plugin-dev/SKILL.md"]) {
    fs.mkdirSync(path.dirname(path.join(root, relative)), { recursive: true });
    fs.copyFileSync(path.join(REPO_ROOT, relative), path.join(root, relative));
  }
  const missing = checkClient("qoder", {
    root,
    runner: () => ({ status: 0, stdout: "other-server" }),
  });
  assert.equal(projectMcpConfigured("qoder", root).configured, false);
  assert.equal(missing.mcpConfigured, false);
  assert.equal(missing.skillAligned, true);
  assert.equal(missing.passed, false);
});
