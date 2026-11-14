#!/usr/bin/env node
// 文件作用：check-tool-contracts Node ES 模块
// 作者：JasonLee <shuiyuntian@foxmail.com>
// 创建日期：2026-07-22
// 版本：1.0.0
// 修改记录：
//   - 1.0.0 (2026-07-22) 初始创建
//
// 版权所有 (C) 2026 AGRSEarth 项目

// 工具契约漂移守卫：HTTP（默认）连接已运行的 MCP gateway + geolocation 桥拉取 listTools
// （--stdio 或 MCP_CONTRACTS_TRANSPORT=stdio 改为子进程拉起，CI 用此形态，无需常驻进程），
// 用与生成时完全相同的共享逻辑重建期望契约，与现有 tool-contracts.json 对比：
//   1) 工具集差异（上游新增/移除工具）
//   2) 共有工具的 domain/side/riskLevel/description 逐字段相等、inputSchema 深度相等
// 不一致时打印差异并 exit 1；一致 exit 0。generatedAt 不参与对比；
// upstream commit 不一致只告警（工具本体已做实时校验），提醒重新生成以更新 provenance。
// 用法：node extensions/system/business/ai-assistant-mcp/tools/check-tool-contracts.mjs [--stdio]

import fs from "node:fs";
import {
  buildContract,
  mergeLocalTools,
  CONTRACTS_JSON,
  deepEqual,
  listAllTools,
} from "./lib/tool-contracts-lib.mjs";

const ENTRY_FIELDS = ["domain", "side", "riskLevel", "description", "inputSchema"];
const DIFF_VALUE_MAX = 1200;

function clip(v) {
  const s = typeof v === "string" ? v : JSON.stringify(v);
  return s.length > DIFF_VALUE_MAX ? `${s.slice(0, DIFF_VALUE_MAX)}…(截断)` : s;
}

async function main() {
  if (!fs.existsSync(CONTRACTS_JSON)) {
    console.error(
      `❌ 契约文件不存在: ${CONTRACTS_JSON}\n   请先运行 node extensions/system/business/ai-assistant-mcp/tools/gen-tool-contracts.mjs`,
    );
    process.exit(1);
  }
  let existing;
  try {
    existing = JSON.parse(fs.readFileSync(CONTRACTS_JSON, "utf8"));
  } catch (err) {
    console.error(`❌ 契约文件不是合法 JSON: ${err.message}`);
    process.exit(1);
  }
  if (!Array.isArray(existing.tools)) {
    console.error("❌ 契约文件缺少 tools 数组，格式不符。");
    process.exit(1);
  }

  const transport = process.argv.includes("--stdio") ? "stdio" : "http";
  console.log(`[check-tool-contracts] listTools（${transport}，gateway + geolocation）...`);
  const expected = mergeLocalTools(buildContract(await listAllTools({ transport })));

  const problems = [];

  // 0) upstream pin 漂移：告警不失败
  if (existing.upstream?.commit !== expected.upstream.commit) {
    console.warn(
      `⚠️  上游 pin 已变化：契约记录 ${existing.upstream?.commit ?? "null"}，` +
        `当前 .upstream 为 ${expected.upstream.commit ?? "null"}。` +
        `工具本体校验仍继续；建议重新生成契约更新 provenance。`,
    );
  }

  // 1) 工具集差异
  const existingByName = new Map(existing.tools.map((t) => [t.name, t]));
  const expectedByName = new Map(expected.tools.map((t) => [t.name, t]));
  const removed = [...existingByName.keys()].filter((n) => !expectedByName.has(n)).sort();
  const added = [...expectedByName.keys()].filter((n) => !existingByName.has(n)).sort();
  if (removed.length > 0) {
    problems.push(`上游已移除（契约中残留）: ${removed.join(", ")}`);
  }
  if (added.length > 0) {
    problems.push(`上游新增（契约缺失）: ${added.join(", ")}`);
  }

  // 2) 共有工具逐字段对比（inputSchema 深度相等，对象键序不敏感）
  for (const [name, exp] of expectedByName) {
    const cur = existingByName.get(name);
    if (!cur) continue;
    for (const field of ENTRY_FIELDS) {
      const eq =
        field === "inputSchema"
          ? deepEqual(cur[field], exp[field])
          : cur[field] === exp[field];
      if (!eq) {
        problems.push(
          `工具 ${name} 字段 ${field} 不一致:\n` +
            `    契约: ${clip(cur[field])}\n` +
            `    上游: ${clip(exp[field])}`,
        );
      }
    }
  }

  if (problems.length > 0) {
    console.error(
      `\n❌ 工具契约与 MCP 上游不一致（${problems.length} 处差异）:`,
    );
    for (const p of problems) console.error(`  - ${p}`);
    console.error(
      `\n修复：node extensions/system/business/ai-assistant-mcp/tools/gen-tool-contracts.mjs 重新生成。`,
    );
    process.exit(1);
  }

  console.log(
    `\n✅ 工具契约与 MCP 上游一致：${expected.toolCount} 个工具，工具集与 inputSchema 全量深度相等。`,
  );
}

main().catch((err) => {
  console.error(`\n❌ 漂移守卫执行失败: ${err.message}`);
  process.exit(1);
});
