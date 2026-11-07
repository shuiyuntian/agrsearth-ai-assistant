#!/usr/bin/env node
//
// 文件作用：检查 Kimi Code / Codex / Claude Code / Qoder / OpenCode / Trae / CodeBuddy 的 MCP 与 Skill 一致性
// 作者：JasonLee <shuiyuntian@foxmail.com>
// 创建日期：2026-11-06
// 版本：1.2.1
// 修改记录：
//   - 1.0.0 (2026-11-06) 初始创建（跨 coding agent 能力一致性）
//   - 1.1.0 (2026-11-06) Codex/OpenCode Skill 入口从 .agents 复用改为各自项目目录
//                       （.codex/skills、.opencode/skills，官方自动发现路径）
//   - 1.2.0 (2026-11-07) 新增 dev-mcp 依赖硬检查（depsReady 计入 passed，未装即 FAIL 并给
//                       安装指引）；新增 platformWarnings（win32 缺 bash 时提示 Git Bash
//                       工具链，提示级不进 passed）；FAIL 时页脚补客户端信任/工作区根提示
//   - 1.2.1 (2026-11-07) 脚手架/版本校验 Node 化后收窄 platformWarnings 文案：仅 dev-mcp
//                       package_scaffold 通道仍需 Git Bash，CLI 直跑不再需要 bash/jq/python
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
    skill: ".codex/skills/agrsearth-plugin-dev/SKILL.md",
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
    skill: ".opencode/skills/agrsearth-plugin-dev/SKILL.md",
    cli: "opencode",
    setup: "项目级配置已写入 opencode.json；Skill 位于 .opencode/skills/（官方自动发现路径）",
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

export function devMcpDepsReady(root) {
  const marker = path.join(root, "tools", "dev-mcp", "node_modules", "@modelcontextprotocol", "sdk", "package.json");
  return { ready: fs.existsSync(marker), detail: marker };
}

export function platformWarnings(platform = process.platform, bashAvailable = true) {
  if (platform !== "win32" || bashAvailable) return [];
  return ["未检测到 bash.exe：dev-mcp package_scaffold 通道仍经 Git Bash 调起脚手架（CLI 直跑 tools\\create-extension.cmd 无需 bash），安装指引见 docs/L2-接入准备-SSO与开发环境.md §2.4"];
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
  const deps = devMcpDepsReady(root);
  let bashAvailable = true;
  if (process.platform === "win32") {
    const probe = runner(env.AGRSEARTH_BASH ?? "bash.exe", ["--version"]);
    bashAvailable = !probe.error && probe.status === 0;
  }
  const warnings = platformWarnings(process.platform, bashAvailable);
  return {
    client: clientName,
    label: client.label,
    mcpConfigured,
    mcpDetail,
    skillAligned,
    skillFile,
    depsReady: deps.ready,
    depsDetail: deps.detail,
    warnings,
    setup: client.setup,
    passed: mcpConfigured && skillAligned && deps.ready,
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
      console.log(`  依赖：${report.depsReady ? "dev-mcp 依赖已安装" : "dev-mcp 依赖未安装（修复：cd tools/dev-mcp && npm install）"}`);
      for (const warning of report.warnings) console.log(`  提示：${warning}`);
      if (!report.mcpConfigured) console.log(`  接入：${report.setup}`);
    }
    if (reports.some((report) => !report.passed)) {
      console.log("提示：首次接入还需在客户端信任/批准项目级 MCP 配置（Claude Code 批准提示、Trae 需启用项目级 MCP）；MCP 配置为仓根相对路径，请以模板仓根目录为工作区打开。");
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
