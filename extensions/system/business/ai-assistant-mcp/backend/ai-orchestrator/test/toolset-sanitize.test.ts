/**
 * 文件作用：toolset sanitize（draft-07 元组 items → 2020-12 prefixItems）单元测试
 * 作者：JasonLee <shuiyuntian@foxmail.com>
 * 创建日期：2026-10-12
 * 版本：1.0.0
 * 修改记录：
 *   - 1.0.0 (2026-10-12) 初始创建
 *
 * 版权所有 (C) 2026 AGRSEarth 项目
 */

import { describe, expect, it } from "vitest";
import { jsonSchema } from "ai";
import type { ToolSet } from "ai";
import { buildExposedTools, sanitizeToolSchema } from "../src/chat/toolset.js";
import type { ToolContractsFile, ToolRegistry } from "../src/contracts/registry.js";

/** 与 height-inference.test.ts 同款的解包装辅助 */
function unwrapForTest(t: unknown): Record<string, unknown> {
  const o = (t as { inputSchema?: unknown }).inputSchema as Record<string, unknown>;
  return ((o?.jsonSchema ?? o) || {}) as Record<string, unknown>;
}

/** tileset_style 同款结构：属性为 [condition, color] 元组数组 */
const TUPLE_TOOL_SCHEMA = {
  type: "object",
  properties: {
    name: { type: "string" },
    colorConditions: {
      type: "array",
      items: {
        type: "array",
        items: [{ type: "string" }, { type: "string" }],
      },
    },
  },
};

function fakeTool(schema: unknown): ToolSet[string] {
  return { description: "fake", inputSchema: jsonSchema(schema as never) } as ToolSet[string];
}

describe("sanitizeToolSchema", () => {
  it("元组 items 改写为 prefixItems + items:false + min/maxItems", () => {
    const out = unwrapForTest(sanitizeToolSchema(fakeTool(TUPLE_TOOL_SCHEMA)));
    const pair = (out.properties as Record<string, any>).colorConditions.items;
    expect(pair.items).toBe(false);
    expect(pair.prefixItems).toEqual([{ type: "string" }, { type: "string" }]);
    expect(pair.minItems).toBe(2);
    expect(pair.maxItems).toBe(2);
  });

  it("非元组 schema 原样返回（同一对象引用）", () => {
    const plain = fakeTool({ type: "object", properties: { a: { type: "string" } } });
    expect(sanitizeToolSchema(plain)).toBe(plain);
  });

  it("schema 不可解包装时原样返回", () => {
    const bare = { description: "x" } as ToolSet[string];
    expect(sanitizeToolSchema(bare)).toBe(bare);
  });

  it("嵌套在 anyOf/properties 深层的元组也被改写", () => {
    const deep = {
      type: "object",
      properties: {
        pos: {
          anyOf: [
            { type: "array", items: [{ type: "number" }, { type: "number" }, { type: "number" }] },
          ],
        },
      },
    };
    const out = unwrapForTest(sanitizeToolSchema(fakeTool(deep)));
    const arr = (out.properties as Record<string, any>).pos.anyOf[0];
    expect(arr.items).toBe(false);
    expect(arr.prefixItems).toHaveLength(3);
    expect(arr.minItems).toBe(3);
  });
});

describe("buildExposedTools sanitize 接入", () => {
  it("registry 放行的 MCP 工具统一过 sanitize", () => {
    const mcpTools: ToolSet = { tileset_style: fakeTool(TUPLE_TOOL_SCHEMA) } as ToolSet;
    const contracts = { version: 1, tools: [] } as unknown as ToolContractsFile;
    const registry = { has: (n: string) => n === "tileset_style" } as unknown as ToolRegistry;
    const tools = buildExposedTools(mcpTools, contracts, registry, false);
    const pair = (unwrapForTest(tools.tileset_style).properties as Record<string, any>)
      .colorConditions.items;
    expect(pair.prefixItems).toHaveLength(2);
    expect(pair.items).toBe(false);
  });
});
