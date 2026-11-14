/**
 * 文件作用：registry 模块
 * 作者：JasonLee <shuiyuntian@foxmail.com>
 * 创建日期：2026-07-22
 * 版本：1.0.0
 * 修改记录：
 *   - 1.0.0 (2026-07-22) 初始创建
 *
 * 版权所有 (C) 2026 AGRSEarth 项目
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * 工具契约注册表（P1-A 白名单）。
 *
 * 契约文件（extensions/system/business/ai-assistant-mcp/contracts/tool-contracts.json）为工具事实源：
 * name/domain/side/riskLevel/description/inputSchema。
 * registry = 契约按白名单过滤后的集合；只有 registry 内的工具会暴露给模型。
 *
 * enabled 三种形态：
 *  - undefined        → 契约全量（默认）
 *  - string[]         → 仅名单内（数组为空 → 空 registry）
 *  - Record<string,boolean> → 默认全量，显式 false 的工具被剔除（单工具覆盖）
 */

export type ToolSide = "browser" | "server";
export type RiskLevel = "read" | "write" | "destructive" | "codegen";

export interface ContractTool {
  name: string;
  domain: string;
  side: ToolSide;
  riskLevel: RiskLevel;
  description: string;
  inputSchema: Record<string, unknown>;
  /** 本地附加工具（不经 MCP，orchestrator 本地实现） */
  source?: "local";
}

export interface ToolContractsFile {
  version: number;
  toolCount: number;
  tools: ContractTool[];
}

export type ToolRegistry = Map<string, ContractTool>;

const PKG_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
);

export const DEFAULT_CONTRACTS_PATH = path.resolve(
  PKG_ROOT,
  "..",
  "..",
  "contracts",
  "tool-contracts.json",
);

export function loadContracts(filePath?: string): ToolContractsFile {
  const p = filePath ?? DEFAULT_CONTRACTS_PATH;
  const parsed = JSON.parse(readFileSync(p, "utf8")) as ToolContractsFile;
  if (!Array.isArray(parsed.tools)) {
    throw new Error(`invalid tool contracts file: ${p}`);
  }
  return parsed;
}

export function buildToolRegistry(
  contracts: ToolContractsFile,
  enabled?: string[] | Record<string, boolean>,
): ToolRegistry {
  const all: ToolRegistry = new Map(contracts.tools.map((t) => [t.name, t]));

  if (enabled === undefined) return all;

  if (Array.isArray(enabled)) {
    const out: ToolRegistry = new Map();
    for (const name of enabled) {
      const tool = all.get(name);
      if (tool) out.set(name, tool);
    }
    return out;
  }

  // Record 形态：默认全量，显式 false 剔除
  const out: ToolRegistry = new Map(all);
  for (const [name, flag] of Object.entries(enabled)) {
    if (flag === false) out.delete(name);
  }
  return out;
}

/** 解析 ENABLED_TOOLS env：undefined → undefined（全量）；"" → []（空白名单） */
export function parseEnabledToolsEnv(
  value: string | undefined,
): string[] | undefined {
  if (value === undefined) return undefined;
  return value
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}
