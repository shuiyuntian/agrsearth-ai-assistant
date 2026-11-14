/**
 * 文件作用：generator 模块
 * 作者：JasonLee <shuiyuntian@foxmail.com>
 * 创建日期：2026-07-23
 * 版本：1.0.0
 * 修改记录：
 *   - 1.0.0 (2026-07-23) 初始创建
 *
 * 版权所有 (C) 2026 AGRSEarth 项目
 */

import { generateText, type LanguageModel } from "ai";
import type { SkillDoc } from "./skills-loader.js";

/**
 * codegen 生成器（P3-A）：grounding prompt → vLLM 普通 completion（非 tool calling）→ 提取代码。
 */

/** 禁危险 API 清单（与 ast-verifier 对齐，prompt 侧先行约束） */
const FORBIDDEN_APIS = [
  "eval / Function / 动态 import()",
  "fetch / XMLHttpRequest / WebSocket / EventSource（任何网络访问）",
  "localStorage / sessionStorage / indexedDB（任何存储访问）",
  "window / document / navigator / location / history / globalThis / self / top / parent / frames / opener",
  "alert / confirm / prompt / open",
  "setTimeout / setInterval（含字符串首参）",
  "Worker / SharedWorker / ServiceWorker / importScripts",
  "计算属性访问（obj[非字面量]）与 constructor / __proto__ / prototype 访问",
];

export function buildSystemPrompt(skills: SkillDoc[]): string {
  const skillSections = skills
    .map((s) => `### 领域参考（${s.id}）\n${s.body.trim()}`)
    .join("\n\n");
  return [
    "你是 CesiumJS 代码生成器。根据用户意图输出**可直接在浏览器 Cesium 应用中执行的 JavaScript 代码**。",
    "",
    "硬性规则（违反将被安全校验拒绝）：",
    "1. 只输出代码本身（可带 markdown ```javascript 围栏），不要输出解释文字。",
    "2. 只能使用两个外部变量：`Cesium`（CesiumJS 全局对象）与 `viewer`（已创建的 Cesium.Viewer 实例）；其余标识符必须自行声明或来自内建对象（Math/JSON/Object/Array/console 等）。",
    `3. 禁止使用以下 API：${FORBIDDEN_APIS.map((a) => `[${a}]`).join(" ")}。`,
    "4. 不要使用 import/export、with 语句、while(true)/for(;;) 死循环。",
    "5. 代码尽量精简（100 行以内）。",
    "",
    skillSections,
  ].join("\n");
}

/** 去 markdown 围栏，提取代码体 */
export function extractCode(text: string): string {
  const fenced = text.match(/```(?:javascript|js|typescript|ts)?\s*\r?\n([\s\S]*?)```/);
  if (fenced?.[1]) return fenced[1].trim();
  return text.trim();
}

export interface GenerateCodeOptions {
  intent: string;
  description?: string;
  skills: SkillDoc[];
  /** 上一轮 AST 违规反馈（重试时注入） */
  feedback?: string;
}

export async function generateCode(
  opts: GenerateCodeOptions,
  model: LanguageModel,
): Promise<string> {
  const userParts = [
    `用户意图：${opts.intent}`,
    opts.description ? `补充说明：${opts.description}` : undefined,
    opts.feedback
      ? `\n上一次生成的代码未通过安全校验，违规如下：\n${opts.feedback}\n请修正后重新输出完整代码。`
      : undefined,
  ].filter(Boolean);

  const result = await generateText({
    model,
    system: buildSystemPrompt(opts.skills),
    prompt: userParts.join("\n"),
    temperature: 0.2,
  });
  return extractCode(result.text);
}
