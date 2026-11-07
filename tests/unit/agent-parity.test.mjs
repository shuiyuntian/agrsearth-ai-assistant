//
// 文件作用：跨 coding agent 资产一致性与 doctor 检测单元测试
// 作者：JasonLee <shuiyuntian@foxmail.com>
// 创建日期：2026-11-06
// 版本：1.2.0
// 修改记录：
//   - 1.0.0 (2026-11-06) 覆盖 Skill 漂移、MCP 配置与 CLI 检测
//   - 1.1.0 (2026-11-06) 适配 parity 1.1.0（{errors,warnings} 返回形态、7 客户端目录含
//                       .codex/.opencode）；新增 --fix 修复回归与 description 触发词断言
//   - 1.2.0 (2026-11-07) 适配 doctor 1.2.0：新增 dev-mcp 依赖缺失负例与 platformWarnings
//                       平台提示用例
//
// 版权所有 (C) 2026 AGRSEarth 项目

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { checkAgentParity, fixAgentParity } from "../../tools/check-agent-parity.mjs";
import { checkClient, codexMcpConfigured, devMcpDepsReady, platformWarnings, projectMcpConfigured } from "../../tools/agent-doctor.mjs";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

const SKILL_COPIES = [
  ".kimi-code/skills/agrsearth-plugin-dev/SKILL.md",
  ".agents/skills/agrsearth-plugin-dev/SKILL.md",
  ".claude/skills/agrsearth-plugin-dev/SKILL.md",
  ".codex/skills/agrsearth-plugin-dev/SKILL.md",
  ".opencode/skills/agrsearth-plugin-dev/SKILL.md",
  ".qoder/skills/agrsearth-plugin-dev/SKILL.md",
  ".trae/skills/agrsearth-plugin-dev/SKILL.md",
  ".codebuddy/skills/agrsearth-plugin-dev/SKILL.md",
];

const PARITY_FIXTURE = [
  ...SKILL_COPIES,
  ".kimi-code/mcp.json",
  ".codex/config.toml",
  ".qoder/settings.json",
  ".trae/mcp.json",
  ".mcp.json",
  "opencode.json",
  "AGENTS.md",
  "tools/agent-doctor.mjs",
  "docs/AGENT_PARITY.md",
];

function makeFixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "agent-parity-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  for (const relative of PARITY_FIXTURE) {
    const target = path.join(root, relative);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(path.join(REPO_ROOT, relative), target);
  }
  return root;
}

test("当前七客户端 Skill 与 MCP 权威入口一致", () => {
  assert.deepEqual(checkAgentParity(REPO_ROOT).errors, []);
});

test("七端项目级 MCP 配置均可被 doctor 识别", () => {
  for (const client of ["kimi", "codex", "claude", "qoder", "opencode", "trae", "codebuddy"]) {
    assert.equal(checkClient(client, { root: REPO_ROOT }).passed, true, client);
  }
});

test("任一客户端 Skill 漂移都会被闸口发现", (t) => {
  const root = makeFixture(t);
  fs.appendFileSync(path.join(root, ".qoder/skills/agrsearth-plugin-dev/SKILL.md"), "\n漂移\n");
  assert.ok(checkAgentParity(root).errors.some((error) => error.includes("Skill 与权威源不一致")));
});

test("--fix 能从权威源重建全部副本并消除漂移", (t) => {
  const root = makeFixture(t);
  fs.appendFileSync(path.join(root, ".codex/skills/agrsearth-plugin-dev/SKILL.md"), "\n漂移\n");
  fs.rmSync(path.join(root, ".opencode/skills/agrsearth-plugin-dev"), { recursive: true, force: true });
  fs.mkdirSync(path.join(root, ".trae/skills/stale-skill"), { recursive: true });
  fs.writeFileSync(path.join(root, ".trae/skills/stale-skill/SKILL.md"), "---\nname: stale\ndescription: stale\n---\n");
  const actions = fixAgentParity(root);
  assert.ok(actions.length >= 3, `应至少有 3 个修复动作，实际 ${actions.length}`);
  assert.deepEqual(checkAgentParity(root).errors, []);
});

test("权威 Skill description 覆盖中英文触发词", () => {
  const skill = fs.readFileSync(path.join(REPO_ROOT, ".kimi-code/skills/agrsearth-plugin-dev/SKILL.md"), "utf8");
  const description = skill.split("---")[1] ?? "";
  for (const keyword of ["plugin", "scaffold", "publish", "插件", "提测"]) {
    assert.ok(description.includes(keyword), `description 缺少触发词：${keyword}`);
  }
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

test("dev-mcp 依赖未安装时 doctor FAIL（MCP 与 Skill 正常也不放行）", (t) => {
  const root = makeFixture(t);
  const report = checkClient("kimi", { root });
  assert.equal(report.mcpConfigured, true);
  assert.equal(report.skillAligned, true);
  assert.equal(report.depsReady, false, "fixture 仓不含 tools/dev-mcp/node_modules");
  assert.equal(report.passed, false);
  assert.equal(devMcpDepsReady(REPO_ROOT).ready, true, "本仓 dev-mcp 依赖应已安装");
});

test("platformWarnings 恒为空（dev-mcp 1.6.2 起全通道 Node 化，零 bash 依赖）", () => {
  assert.deepEqual(platformWarnings("win32", false), []);
  assert.deepEqual(platformWarnings("win32", true), []);
  assert.deepEqual(platformWarnings("darwin", false), []);
});
