#!/usr/bin/env node
// 文件作用：gen-tool-contracts Node ES 模块
// 作者：JasonLee <shuiyuntian@foxmail.com>
// 创建日期：2026-07-22
// 版本：1.0.0
// 修改记录：
//   - 1.0.0 (2026-07-22) 初始创建
//
// 版权所有 (C) 2026 AGRSEarth 项目

// 生成 AI 工具契约：HTTP（默认）连接已运行的 MCP gateway + geolocation 桥拉取 listTools
// （vendor pristine，不改；--stdio 或 MCP_CONTRACTS_TRANSPORT=stdio 改为子进程拉起，CI 用），
// 按共享映射表打上 domain/side/riskLevel，写出：
//   extensions/system/business/ai-assistant-mcp/contracts/tool-contracts.json  契约清单（安全闸/ajv 的事实源）
//   extensions/system/business/ai-assistant-mcp/contracts/tool-names.ts        工具名常量 + ToolName 类型
//   extensions/system/business/ai-assistant-mcp/contracts/tool-names.json      工具名常量（供 Java 等消费）
// 用法：node extensions/system/business/ai-assistant-mcp/tools/gen-tool-contracts.mjs [--stdio]
// 环境变量（HTTP 模式）：MCP_CONTRACTS_GATEWAY_URL（默认 http://localhost:4010/mcp）、
//   MCP_CONTRACTS_GEO_URL（默认 http://localhost:3008/mcp）；
// （stdio 模式）：MCP_GATEWAY_PORT（默认 3910，仅为 gateway SSE 通信端口，避开 orchestrator 的 3010）

import fs from "node:fs";
import path from "node:path";
import {
  buildContract,
  CONTRACTS_DIR,
  CONTRACTS_JSON,
  formatDist,
  listAllTools,
  mergeLocalTools,
  REPO_ROOT,
  renderToolNamesJson,
  renderToolNamesTs,
  summarize,
  TOOL_NAMES_JSON,
  TOOL_NAMES_TS,
} from "./lib/tool-contracts-lib.mjs";

function rel(p) {
  return path.relative(REPO_ROOT, p);
}

async function main() {
  const transport = process.argv.includes("--stdio") ? "stdio" : "http";
  console.log(`[gen-tool-contracts] listTools（${transport}，gateway + geolocation）...`);
  const rawTools = await listAllTools({ transport });
  const contract = mergeLocalTools(buildContract(rawTools));
  const names = contract.tools.map((t) => t.name);

  fs.mkdirSync(CONTRACTS_DIR, { recursive: true });
  fs.writeFileSync(CONTRACTS_JSON, `${JSON.stringify(contract, null, 2)}\n`);
  fs.writeFileSync(TOOL_NAMES_TS, renderToolNamesTs(names));
  fs.writeFileSync(TOOL_NAMES_JSON, renderToolNamesJson(names));

  const s = summarize(contract);
  console.log(`\n✅ 工具契约生成完成（上游 pin: ${contract.upstream.commit ?? "unknown"}）`);
  console.log(`  工具总数: ${s.total}`);
  console.log(`  按 domain:    ${formatDist(s.domain)}`);
  console.log(`  按 side:      ${formatDist(s.side)}`);
  console.log(`  按 riskLevel: ${formatDist(s.riskLevel)}`);
  console.log("  输出文件:");
  for (const f of [CONTRACTS_JSON, TOOL_NAMES_TS, TOOL_NAMES_JSON]) {
    console.log(`    - ${rel(f)}`);
  }
}

main().catch((err) => {
  console.error(`\n❌ 生成失败: ${err.message}`);
  process.exit(1);
});
