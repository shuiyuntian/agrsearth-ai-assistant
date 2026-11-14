/**
 * 文件作用：validator 模块
 * 作者：JasonLee <shuiyuntian@foxmail.com>
 * 创建日期：2026-07-22
 * 版本：1.0.0
 * 修改记录：
 *   - 1.0.0 (2026-07-22) 初始创建
 *
 * 版权所有 (C) 2026 AGRSEarth 项目
 */

import { Ajv, type ValidateFunction } from "ajv";
import type { ContractTool } from "../contracts/registry.js";

/**
 * ajv 参数校验（P1-A）。
 * callTool 前按契约 inputSchema 校验模型产出参数；不合规则不走 MCP，
 * 由调用方以 tool error 结果回喂模型修正。
 */
export class ArgsValidator {
  private readonly ajv = new Ajv({ allErrors: true, strict: false });
  private readonly cache = new Map<string, ValidateFunction>();

  validate(
    tool: ContractTool,
    args: unknown,
  ): { ok: true } | { ok: false; errors: string } {
    let fn = this.cache.get(tool.name);
    if (!fn) {
      fn = this.ajv.compile(tool.inputSchema);
      this.cache.set(tool.name, fn);
    }
    const ok = fn(args ?? {});
    if (ok) return { ok: true };
    return {
      ok: false,
      errors: this.ajv.errorsText(fn.errors, { separator: "; " }),
    };
  }
}
