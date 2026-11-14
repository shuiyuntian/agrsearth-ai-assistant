/**
 * 文件作用：pipeline 模块
 * 作者：JasonLee <shuiyuntian@foxmail.com>
 * 创建日期：2026-07-23
 * 版本：1.0.0
 * 修改记录：
 *   - 1.0.0 (2026-07-23) 初始创建
 *
 * 版权所有 (C) 2026 AGRSEarth 项目
 */

import type { LanguageModel } from "ai";
import { verifyCode, type Violation } from "./ast-verifier.js";
import { generateCode } from "./generator.js";
import { loadSkills, selectSkills } from "./skills-loader.js";

/**
 * codegen 管线（P3-A）：grounding 生成 → AST 校验 →（失败回喂重试）→ 产出。
 */
export interface CodegenResult {
  code: string;
  verified: boolean;
  attempts: number;
  /** 选中的技能域（审计/调试用） */
  skillIds: string[];
}

export class CodegenError extends Error {
  constructor(
    message: string,
    readonly violations: Violation[],
    readonly lastCode?: string,
  ) {
    super(message);
    this.name = "CodegenError";
  }
}

export interface CodegenPipelineOptions {
  intent: string;
  description?: string;
  model: LanguageModel;
  skillsDir: string;
  maxAttempts?: number;
  maxSkills?: number;
  /** 可注入 mock（测试用）；默认真实 generateCode */
  generateFn?: typeof generateCode;
}

export async function runCodegenPipeline(
  opts: CodegenPipelineOptions,
): Promise<CodegenResult> {
  const maxAttempts = opts.maxAttempts ?? 3;
  const docs = loadSkills(opts.skillsDir);
  const selected = selectSkills(opts.intent, docs, opts.maxSkills ?? 1);
  const generate = opts.generateFn ?? generateCode;

  let feedback: string | undefined;
  let lastViolations: Violation[] = [];
  let lastCode: string | undefined;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const code = await generate(
      {
        intent: opts.intent,
        description: opts.description,
        skills: selected,
        feedback,
      },
      opts.model,
    );
    lastCode = code;
    const result = verifyCode(code);
    if (result.ok) {
      return {
        code,
        verified: true,
        attempts: attempt,
        skillIds: selected.map((s) => s.id),
      };
    }
    lastViolations = result.violations;
    feedback = result.violations
      .map((v) => `line ${v.line} [${v.rule}] ${v.snippet}`)
      .join("\n");
  }

  throw new CodegenError(
    `代码生成连续 ${maxAttempts} 次未通过 AST 安全校验`,
    lastViolations,
    lastCode,
  );
}
