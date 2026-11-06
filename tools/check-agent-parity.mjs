#!/usr/bin/env node
//
// 文件作用：跨 coding agent 资产一致性闸口——Skill 副本、MCP 入口、接入文档与 doctor 检查
// 作者：JasonLee <shuiyuntian@foxmail.com>
// 创建日期：2026-11-06
// 版本：1.0.0
// 修改记录：
//   - 1.0.0 (2026-11-06) 初始创建（Kimi/Codex/Claude/Qoder 同源校验）
//
// 版权所有 (C) 2026 AGRSEarth 项目

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { projectMcpConfigured } from "./agent-doctor.mjs";

const SKILL_FILES = [
  ".kimi-code/skills/agrsearth-plugin-dev/SKILL.md",
  ".agents/skills/agrsearth-plugin-dev/SKILL.md",
  ".claude/skills/agrsearth-plugin-dev/SKILL.md",
  ".qoder/skills/agrsearth-plugin-dev/SKILL.md",
  ".trae/skills/agrsearth-plugin-dev/SKILL.md",
  ".codebuddy/skills/agrsearth-plugin-dev/SKILL.md",
];

function read(root, relative) {
  return fs.readFileSync(path.join(root, relative), "utf8");
}

export function checkAgentParity(root) {
  const errors = [];
  let canonical = "";
  try {
    canonical = read(root, SKILL_FILES[0]);
  } catch (error) {
    return [`权威 Skill 不可读：${SKILL_FILES[0]}（${error.message}）`];
  }
  for (const file of SKILL_FILES.slice(1)) {
    try {
      if (read(root, file) !== canonical) errors.push(`Skill 与权威源不一致：${file}`);
    } catch (error) {
      errors.push(`Skill 缺失或不可读：${file}（${error.message}）`);
    }
  }

  try {
    const mcp = JSON.parse(read(root, ".kimi-code/mcp.json"));
    const entry = mcp.mcpServers?.["agrsearth-dev"];
    if (entry?.command !== "node" || !entry?.args?.includes("tools/dev-mcp/server.mjs")) {
      errors.push("Kimi Code MCP 入口未指向 tools/dev-mcp/server.mjs");
    }
  } catch (error) {
    errors.push(`.kimi-code/mcp.json 缺失或非法（${error.message}）`);
  }

  for (const client of ["codex", "claude", "qoder", "opencode", "trae", "codebuddy"]) {
    if (!projectMcpConfigured(client, root).configured) errors.push(`项目级 MCP 配置缺失或非法：${client}`);
  }

  const agents = read(root, "AGENTS.md");
  for (const needle of ["Codex", "Claude Code", "Qoder", "OpenCode", "Trae", "CodeBuddy", "tools/agent-doctor.mjs", "check-agent-parity.mjs"]) {
    if (!agents.includes(needle)) errors.push(`AGENTS.md 缺少跨工具接入说明：${needle}`);
  }
  for (const file of ["tools/agent-doctor.mjs", "docs/AGENT_PARITY.md"]) {
    if (!fs.existsSync(path.join(root, file))) errors.push(`缺少跨工具资产：${file}`);
  }
  return errors;
}

const isMain = process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;
if (isMain) {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const errors = checkAgentParity(root);
  if (errors.length) {
    console.error(`跨 agent 资产校验失败：\n${errors.map((error) => `  - ${error}`).join("\n")}`);
    process.exitCode = 1;
  } else {
    console.log("跨 agent 资产校验通过：Kimi Code / Codex / Claude Code / Qoder / OpenCode / Trae / CodeBuddy 的 Skill 与 MCP 权威入口一致");
  }
}
