#!/usr/bin/env node
//
// 文件作用：跨 coding agent 资产一致性闸口——Skill 副本（全量技能目录树）、MCP 入口、接入文档与 doctor 检查；--fix 单向修复副本
// 作者：JasonLee <shuiyuntian@foxmail.com>
// 创建日期：2026-11-06
// 版本：1.1.0
// 修改记录：
//   - 1.0.0 (2026-11-06) 初始创建（Kimi/Codex/Claude/Qoder 同源校验）
//   - 1.1.0 (2026-11-06) 副本覆盖扩为全量技能（权威源发现制，含 cesiumjs-*）；客户端补
//                       .codex/skills 与 .opencode/skills（不再依赖 .agents 兼容发现）；
//                       新增 --fix（权威源→7 端副本单向同步，幂等）；
//                       新增 frontmatter（name/description）校验与 >500 行体量告警
//
// 版权所有 (C) 2026 AGRSEarth 项目

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath, pathToFileURL } from "node:url";
import { projectMcpConfigured } from "./agent-doctor.mjs";

const CANONICAL_ROOT = ".kimi-code/skills";
const CLIENT_ROOTS = [
  ".agents/skills",
  ".claude/skills",
  ".codex/skills",
  ".opencode/skills",
  ".qoder/skills",
  ".trae/skills",
  ".codebuddy/skills",
];

function read(root, relative) {
  return fs.readFileSync(path.join(root, relative), "utf8");
}

function listSkillDirs(root, skillsRoot) {
  const abs = path.join(root, skillsRoot);
  if (!fs.existsSync(abs)) return [];
  return fs.readdirSync(abs, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && fs.existsSync(path.join(abs, entry.name, "SKILL.md")))
    .map((entry) => entry.name)
    .sort();
}

function treeFiles(dirAbs) {
  const files = [];
  const walk = (current) => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      if (entry.name === ".DS_Store") continue;
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) walk(full);
      else files.push(path.relative(dirAbs, full));
    }
  };
  walk(dirAbs);
  return files.sort();
}

function hashFile(abs) {
  return crypto.createHash("sha1").update(fs.readFileSync(abs)).digest("hex");
}

function treeDiff(canonicalAbs, clientAbs) {
  const canonicalFiles = treeFiles(canonicalAbs);
  const clientFiles = fs.existsSync(clientAbs) ? treeFiles(clientAbs) : [];
  const missing = canonicalFiles.filter((f) => !clientFiles.includes(f));
  const extra = clientFiles.filter((f) => !canonicalFiles.includes(f));
  const mismatched = canonicalFiles
    .filter((f) => clientFiles.includes(f))
    .filter((f) => hashFile(path.join(canonicalAbs, f)) !== hashFile(path.join(clientAbs, f)));
  return { missing, extra, mismatched, changed: missing.length + extra.length + mismatched.length > 0 };
}

function copyTree(srcAbs, destAbs) {
  fs.rmSync(destAbs, { recursive: true, force: true });
  for (const rel of treeFiles(srcAbs)) {
    const target = path.join(destAbs, rel);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(path.join(srcAbs, rel), target);
  }
}

function checkFrontmatter(root, skillsRoot, skill) {
  const file = path.join(root, skillsRoot, skill, "SKILL.md");
  const head = read(root, path.join(skillsRoot, skill, "SKILL.md")).split("\n").slice(0, 10).join("\n");
  const errors = [];
  if (!/^name:/m.test(head)) errors.push(`Skill 缺少 name frontmatter：${path.join(skillsRoot, skill, "SKILL.md")}`);
  if (!/^description:/m.test(head)) errors.push(`Skill 缺少 description frontmatter：${path.join(skillsRoot, skill, "SKILL.md")}`);
  const lines = fs.readFileSync(file, "utf8").split("\n").length;
  const warnings = lines > 500 ? [`${skill} SKILL.md ${lines} 行 > 500（vendor 技能待上游拆分，勿手改）`] : [];
  return { errors, warnings };
}

export function checkAgentParity(root) {
  const errors = [];
  const warnings = [];
  const canonicalAbs = path.join(root, CANONICAL_ROOT);
  const canonicalSkills = listSkillDirs(root, CANONICAL_ROOT);
  if (canonicalSkills.length === 0) {
    return { errors: [`权威 Skill 源为空或不可读：${CANONICAL_ROOT}`], warnings };
  }

  for (const skill of canonicalSkills) {
    const result = checkFrontmatter(root, CANONICAL_ROOT, skill);
    errors.push(...result.errors);
    warnings.push(...result.warnings);
  }

  for (const clientRoot of CLIENT_ROOTS) {
    const clientAbs = path.join(root, clientRoot);
    if (!fs.existsSync(clientAbs)) {
      errors.push(`客户端 Skill 目录缺失：${clientRoot}（跑 node tools/check-agent-parity.mjs --fix 修复）`);
      continue;
    }
    const clientSkills = listSkillDirs(root, clientRoot);
    for (const skill of canonicalSkills) {
      if (!clientSkills.includes(skill)) {
        errors.push(`Skill 缺失：${clientRoot}/${skill}`);
        continue;
      }
      const diff = treeDiff(path.join(canonicalAbs, skill), path.join(clientAbs, skill));
      if (diff.changed) {
        errors.push(`Skill 与权威源不一致：${clientRoot}/${skill}（缺失 ${diff.missing.length} / 多余 ${diff.extra.length} / 内容漂移 ${diff.mismatched.length}）`);
      }
    }
    for (const skill of clientSkills) {
      if (!canonicalSkills.includes(skill)) errors.push(`客户端存在权威源之外的过期 Skill：${clientRoot}/${skill}`);
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
  return { errors, warnings };
}

export function fixAgentParity(root) {
  const actions = [];
  const canonicalAbs = path.join(root, CANONICAL_ROOT);
  const canonicalSkills = listSkillDirs(root, CANONICAL_ROOT);
  for (const clientRoot of CLIENT_ROOTS) {
    const clientAbs = path.join(root, clientRoot);
    fs.mkdirSync(clientAbs, { recursive: true });
    for (const skill of canonicalSkills) {
      const dest = path.join(clientAbs, skill);
      const diff = treeDiff(path.join(canonicalAbs, skill), dest);
      if (diff.changed) {
        copyTree(path.join(canonicalAbs, skill), dest);
        actions.push(`已同步 ${clientRoot}/${skill}`);
      }
    }
    for (const skill of listSkillDirs(root, clientRoot)) {
      if (!canonicalSkills.includes(skill)) {
        fs.rmSync(path.join(clientAbs, skill), { recursive: true, force: true });
        actions.push(`已移除过期副本 ${clientRoot}/${skill}`);
      }
    }
  }
  return actions;
}

const isMain = process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;
if (isMain) {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const fix = process.argv.slice(2).includes("--fix");
  if (fix) {
    const actions = fixAgentParity(root);
    console.log(actions.length ? `副本修复完成：\n${actions.map((a) => `  - ${a}`).join("\n")}` : "副本已是最新，无需修复");
  }
  const { errors, warnings } = checkAgentParity(root);
  for (const warning of warnings) console.warn(`警告：${warning}`);
  if (errors.length) {
    console.error(`跨 agent 资产校验失败：\n${errors.map((error) => `  - ${error}`).join("\n")}`);
    process.exitCode = 1;
  } else {
    console.log(`跨 agent 资产校验通过：${listSkillDirs(root, CANONICAL_ROOT).length} 个 Skill × 8 端（Kimi 权威源 + 7 客户端副本）一致，MCP 权威入口一致`);
  }
}
