/**
 * 文件作用：toolset 模块
 * 作者：JasonLee <shuiyuntian@foxmail.com>
 * 创建日期：2026-07-23
 * 版本：1.1.0
 * 修改记录：
 *   - 1.1.0 (2026-10-12) 模型侧 schema 统一过 sanitizeDraft07Tuples：vendor draft-07 元组
 *                       items 改写 2020-12 prefixItems，适配 uni-api 等严格校验网关（9 工具中招实测）
 *   - 1.0.0 (2026-07-23) 初始创建
 *
 * 版权所有 (C) 2026 AGRSEarth 项目
 */

import { jsonSchema, tool, type ToolSet } from "ai";
import type { ContractTool, ToolContractsFile, ToolRegistry } from "../contracts/registry.js";
import { CAMERA_HEIGHT_FIELDS } from "./height-inference.js";

/**
 * 暴露给模型的工具集构建（P3-A 提取为纯函数，便于单测白名单/codegen 开关语义）。
 *
 * - MCP 工具按 registry（白名单）过滤；
 * - 模型侧 schema 统一过 sanitizeDraft07Tuples：vendor（zod→draft-07）的元组写法
 *   items:[{...},{...}] 在严格 JSON Schema 2020-12 校验的 LLM 网关（如 CSTCloud
 *   uni-api）下会被 400 拒收，改写为 prefixItems+items:false 等价语义（2026-10-12
 *   实测：entity_add_polygon 等 9 个工具中招，vLLM 宽松可过、uni-api 必挂）；
 * - camera_* 三件的 destination/target.height 在【模型侧 schema】中从 required 摘除
 *   （S3）：height 由系统推算层（S2-B height-inference）确定——vendor schema 标必填
 *   会倒逼模型编造离谱高度（实测拍出 10km/30km 覆盖省级请求）。契约层 inputSchema
 *   不改动（保持与 vendor 一致供漂移校验；缺 height 的初检失败由推算填入后复检救回）；
 * - 契约里 source:"local" 的本地工具（如 cesium_execute_code）仅在 codegenEnabled=true
 *   且白名单放行时注册（不经 MCP，execute 为 fail-closed 桩——实际执行被
 *   secure-tools 的 codegen 分支接管：管线 + 强制审批）。
 */
export function buildExposedTools(
  mcpTools: ToolSet,
  contracts: ToolContractsFile,
  registry: ToolRegistry,
  codegenEnabled: boolean,
): ToolSet {
  const tools: ToolSet = Object.fromEntries(
    Object.entries(mcpTools)
      .filter(([name]) => registry.has(name))
      .map(([name, t]) => [
        name,
        sanitizeToolSchema(
          CAMERA_HEIGHT_FIELDS[name] ? relaxCameraHeightRequired(t, CAMERA_HEIGHT_FIELDS[name]) : t,
        ),
      ]),
  );
  if (codegenEnabled) {
    for (const lt of contracts.tools.filter((t) => t.source === "local")) {
      if (registry.has(lt.name)) tools[lt.name] = buildLocalTool(lt);
    }
  }
  return tools;
}

/**
 * draft-07 元组 items 改写为 2020-12 prefixItems（递归处理嵌套 schema）。
 * items 为数组时：prefixItems 接管逐位约束，items:false 禁止多余元素，
 * minItems/maxItems 固定元组长度；找不到可编辑 schema 时原样返回。
 */
export function sanitizeToolSchema(t: ToolSet[string]): ToolSet[string] {
  const plain = unwrapJsonSchema((t as { inputSchema?: unknown }).inputSchema);
  if (!plain) return t;
  const cloned = JSON.parse(JSON.stringify(plain)) as Record<string, unknown>;
  if (!rewriteTupleItems(cloned)) return t;
  return { ...t, inputSchema: jsonSchema(cloned as never) } as ToolSet[string];
}

/** 原地改写，返回是否有改动 */
function rewriteTupleItems(node: unknown): boolean {
  if (!node || typeof node !== "object") return false;
  let changed = false;
  if (Array.isArray(node)) {
    for (const v of node) changed = rewriteTupleItems(v) || changed;
    return changed;
  }
  const o = node as Record<string, unknown>;
  const items = o.items;
  if (Array.isArray(items)) {
    o.prefixItems = items;
    o.items = false;
    o.minItems = items.length;
    o.maxItems = items.length;
    changed = true;
  }
  for (const v of Object.values(o)) changed = rewriteTupleItems(v) || changed;
  return changed;
}

/** 解开 AI SDK jsonSchema() 包装 / 裸 JSON schema，返回可编辑的裸 schema 对象。 */
function unwrapJsonSchema(s: unknown): Record<string, unknown> | null {
  if (!s || typeof s !== "object") return null;
  const o = s as Record<string, unknown>;
  if (o.jsonSchema && typeof o.jsonSchema === "object") {
    return o.jsonSchema as Record<string, unknown>;
  }
  if (o.type === "object" || o.properties) return o;
  return null;
}

/**
 * 把 camera 工具 destination/target 子 schema 的 required 中的 "height" 摘除
 * （仅模型侧展示；其余字段与原工具对象原样保留，找不到目标结构时原样返回）。
 */
export function relaxCameraHeightRequired(
  t: ToolSet[string],
  field: "destination" | "target",
): ToolSet[string] {
  const plain = unwrapJsonSchema((t as { inputSchema?: unknown }).inputSchema);
  if (!plain) return t;
  const props = plain.properties as Record<string, Record<string, unknown>> | undefined;
  const section = props?.[field];
  if (!section || !Array.isArray(section.required)) return t;
  const required = (section.required as unknown[]).filter((r) => r !== "height");
  if (required.length === (section.required as unknown[]).length) return t;
  const relaxed = {
    ...plain,
    properties: { ...props, [field]: { ...section, required } },
  };
  return { ...t, inputSchema: jsonSchema(relaxed as never) } as ToolSet[string];
}

export function buildLocalTool(contract: ContractTool): ToolSet[string] {
  return tool({
    description: contract.description,
    inputSchema: jsonSchema(contract.inputSchema as never),
    execute: async () => ({
      error: "codegen 工具未被安全层接管（codegen 管线未配置）",
    }),
  }) as ToolSet[string];
}
