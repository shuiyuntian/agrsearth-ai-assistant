/**
 * 文件作用：provider 模块
 * 作者：JasonLee <shuiyuntian@foxmail.com>
 * 创建日期：2026-07-22
 * 版本：1.0.0
 * 修改记录：
 *   - 1.0.0 (2026-07-22) 初始创建
 *
 * 版权所有 (C) 2026 AGRSEarth 项目
 */

import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import type { LanguageModel } from "ai";
import type { Config } from "../config.js";

/**
 * vLLM OpenAI 兼容 provider。
 * vLLM 本地部署通常不校验 apiKey，缺省给占位值。
 */
export function createLLMProvider(config: Config) {
  const provider = createOpenAICompatible({
    name: "vllm",
    baseURL: config.LLM_BASE_URL,
    apiKey: config.LLM_API_KEY || "***REMOVED***",
  });

  return {
    provider,
    /** chat 模型工厂 */
    chatModel: () => provider.chatModel(config.LLM_MODEL),
  };
}

/**
 * 按运行时参数构造模型（P2-A：llmBaseUrl/llmModel 可热更，每请求调用）。
 * apiKey 本体仍取 env（LLM_API_KEY）；配置库里的 llmApiKeyRef 只是引用名。
 */
export function createChatModel(opts: {
  baseURL: string;
  model: string;
  apiKey?: string;
}): LanguageModel {
  const provider = createOpenAICompatible({
    name: "vllm",
    baseURL: opts.baseURL,
    apiKey: opts.apiKey || "***REMOVED***",
    // 流式响应里回传 usage（vLLM 支持），LLM 用量审计取数依赖
    includeUsage: true,
  });
  return provider.chatModel(opts.model);
}
