#!/usr/bin/env node
//
// 文件作用：检查 Kimi Code / Codex / Claude Code / Qoder / OpenCode / Trae / CodeBuddy 的 MCP 与 Skill 一致性
// 作者：JasonLee <shuiyuntian@foxmail.com>
// 创建日期：2026-11-06
// 版本：1.0.0
// 修改记录：
//   - 1.0.0 (2026-11-06) 初始创建（跨 coding agent 能力一致性）
//
// 版权所有 (C) 2026 AGRSEarth 项目

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";

export const CLIENTS = {
  kimi: {
    label: "Kimi Code",
    skill: ".kimi-code/skills/agrsearth-plugin-dev/SKILL.md",
    setup: "无需手工配置；仓根 .kimi-code/mcp.json 已注册",
  },
  codex: {
    label: "Codex",
    skill: ".agents/skills/agrsearth-plugin-dev/SKILL.md",
    cli: "codex",
    setup: "codex mcp add agrsearth-dev -- node tools/dev-mcp/server.mjs",
  },
  claude: {
    label: "Claude Code",
    skill: ".claude/skills/agrsearth-plugin-dev/SKILL.md",
    cli: "claude",
    setup: "claude mcp add agrsearth-dev -- node tools/dev-mcp/server.mjs",
  },
  qoder: {
    label: "Qoder",
    skill: ".qoder/skills/agrsearth-plugin-dev/SKILL.md",
    cli: "qodercli",
    setup: "项目级配置已写入 .qoder/settings.json；或执行 qodercli mcp add agrsearth-dev -- node tools/dev-mcp/server.mjs",
  },
  opencode: {
    label: "OpenCode",
    skill: ".agents/skills/agrsearth-plugin-dev/SKILL.md",
    cli: "opencode",
    setup: "项目级配置已写入 opencode.json；OpenCode 复用 .agents/.claude Skill",
  },
  trae: {
    label: "Trae",
    skill: ".trae/skills/agrsearth-plugin-dev/SKILL.md",
    setup: "项目级配置已写入 .trae/mcp.json；在 IDE 中启用项目级 MCP 并信任项目",
  },
  codebuddy: {
    label: "CodeBuddy",
    skill: ".codebuddy/skills/agrsearth-plugin-dev/SKILL.md",
    cli: "codebuddy",
    setup: "与 Claude Code 共用仓根 .mcp.json；或执行 codebuddy mcp add --scope project agrsearth-dev -- node tools/dev-mcp/server.mjs",
  },
};

export function codexMcpConfigured(text) {
  const section = /\[mcp_servers\.agrsearth-dev\]([\s\S]*?)(?=\n\[|\s*$)/.exec(text);
  if (!section) return false;
  return /command\s*=\s*["']node["']/.test(section[1])
    && /tools\/dev-mcp\/server\.mjs/.test(section[1]);
}

function validNodeArgs(args) {
  return Array.isArray(args) && args.some((value) => /(^|\/)tools\/dev-mcp\/server\.mjs$/.test(String(value)));
}

export function projectMcpConfigured(clientName, root) {
  if (clientName === "codex") {
    const file = path.join(root, ".codex", "config.toml");
    try {
      return { configured: codexMcpConfigured(fs.readFileSync(file, "utf8")), detail: file };
    } catch {
      return { configured: false, detail: `${file} 不可读` };
    }
  }
  const definitions = {
    claude: ".mcp.json",
    codebuddy: ".mcp.json",
    qoder: ".qoder/settings.json",
    opencode: "opencode.json",
    trae: ".trae/mcp.json",
  };
  const file = path.join(root, definitions[clientName] ?? ".mcp.json");
  try {
    const config = JSON.parse(fs.readFileSync(file, "utf8"));
    const entry = clientName === "opencode" ? config.mcp?.["agrsearth-dev"] : config.mcpServers?.["agrsearth-dev"];
    const args = entry?.command;
    const configured = clientName === "opencode"
      ? entry?.type === "local" && entry?.enabled !== false && args?.[0] === "node" && validNodeArgs(args.slice(1))
      : entry?.command === "node" && validNodeArgs(entry?.args);
    return { configured: Boolean(configured), detail: file };
  } catch {
    return { configured: false, detail: `${file} 缺失或非法` };
  }
}

function defaultRunner(command, args) {
  return spawnSync(command, args, { encoding: "utf8", timeout: 15000, windowsHide: true });
}

export function checkClient(clientName, options = {}) {
  const client = CLIENTS[clientName];
  if (!client) throw new Error(`不支持的客户端：${clientName}（可选 ${Object.keys(CLIENTS).join("/")}）`);
  const root = options.root ?? path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const env = options.env ?? process.env;
  const runner = options.runner ?? defaultRunner;
  let mcpConfigured = false;
  let mcpDetail = "";

  if (clientName === "kimi") {
    const file = path.join(root, ".kimi-code", "mcp.json");
    try {
      const config = JSON.parse(fs.readFileSync(file, "utf8"));
      mcpConfigured = config.mcpServers?.["agrsearth-dev"]?.command === "node"
        && config.mcpServers?.["agrsearth-dev"]?.args?.includes("tools/dev-mcp/server.mjs");
      mcpDetail = file;
    } catch {
      mcpDetail = `${file} 缺失或非法`;
    }
  } else {
    const project = projectMcpConfigured(clientName, root);
    mcpConfigured = project.configured;
    mcpDetail = project.detail;
    if (!mcpConfigured && client.cli) {
      const result = runner(client.cli, ["mcp", "list"]);
      mcpConfigured = !result.error && result.status === 0 && /agrsearth-dev/.test(result.stdout ?? "");
      mcpDetail += `；${client.cli} mcp list${result.error ? `（${result.error.message}）` : ""}`;
    }
    if (!mcpConfigured && clientName === "codex") {
      const configFile = env.AGRSEARTH_CODEX_CONFIG
        ?? path.join(env.CODEX_HOME ?? path.join(os.homedir(), ".codex"), "config.toml");
      try {
        mcpConfigured = codexMcpConfigured(fs.readFileSync(configFile, "utf8"));
        mcpDetail += `；${configFile}`;
      } catch {
        mcpDetail += `；${configFile} 不可读`;
      }
    }
  }

  const canonicalFile = path.join(root, CLIENTS.kimi.skill);
  const skillFile = path.join(root, client.skill);
  const canonical = fs.readFileSync(canonicalFile, "utf8");
  const skillAligned = fs.existsSync(skillFile)
    && fs.readFileSync(skillFile, "utf8") === canonical;
  return {
    client: clientName,
    label: client.label,
    mcpConfigured,
    mcpDetail,
    skillAligned,
    skillFile,
    setup: client.setup,
    passed: mcpConfigured && skillAligned,
  };
}

function main(argv) {
  let clientName = "all";
  let json = false;
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === "--client") clientName = argv[++index];
    else if (argv[index] === "--json") json = true;
    else throw new Error(`未知参数：${argv[index]}`);
  }
  if (clientName !== "all" && !CLIENTS[clientName]) throw new Error(`不支持的客户端：${clientName}`);
  const names = clientName === "all" ? Object.keys(CLIENTS) : [clientName];
  const reports = names.map((name) => checkClient(name));
  if (json) {
    console.log(JSON.stringify(reports, null, 2));
  } else {
    for (const report of reports) {
      console.log(`${report.passed ? "PASS" : "FAIL"} ${report.label}`);
      console.log(`  MCP：${report.mcpConfigured ? "已配置" : "未配置"}（${report.mcpDetail}）`);
      console.log(`  Skill：${report.skillAligned ? "与权威源一致" : "缺失或内容漂移"}（${report.skillFile}）`);
      if (!report.mcpConfigured) console.log(`  接入：${report.setup}`);
    }
  }
  if (reports.some((report) => !report.passed)) process.exitCode = 1;
}

const isMain = process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;
if (isMain) {
  try {
    main(process.argv.slice(2));
  } catch (error) {
    console.error(`错误：${error.message}`);
    process.exitCode = 2;
  }
}
