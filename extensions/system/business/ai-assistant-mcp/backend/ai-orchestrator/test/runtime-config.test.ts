/**
 * 文件作用：runtime-config.test 模块
 * 作者：JasonLee <shuiyuntian@foxmail.com>
 * 创建日期：2026-07-23
 * 版本：1.0.0
 * 修改记录：
 *   - 1.0.0 (2026-07-23) 初始创建
 *
 * 版权所有 (C) 2026 AGRSEarth 项目
 */

import { describe, expect, it, vi } from "vitest";
import {
  RuntimeConfig,
  runtimeConfigSchema,
} from "../src/config/runtime.js";
import { resolveChatParams } from "../src/chat/router.js";

function defaults() {
  return runtimeConfigSchema.parse({
    llmBaseUrl: "http://127.0.0.1:8003/v1",
    llmModel: "test-model",
    agentMaxSteps: 8,
    rateLimitRpm: 20,
    approvalPolicy: ["entity_remove"],
  });
}

describe("RuntimeConfig 热更", () => {
  it("applyPatch 部分更新即时生效（version 递增，下一请求 resolveChatParams 用新值）", async () => {
    const rc = new RuntimeConfig(defaults());
    expect(resolveChatParams(rc.snapshot()).maxSteps).toBe(8);

    const v0 = rc.getVersion();
    const onChange = vi.fn();
    rc.onChange(onChange);

    await rc.applyPatch({ agentMaxSteps: 3, rateLimitRpm: 5 });
    expect(rc.getVersion()).toBe(v0 + 1);
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(rc.snapshot().agentMaxSteps).toBe(3);
    expect(rc.snapshot().rateLimitRpm).toBe(5);
    // 未触字段保持
    expect(rc.snapshot().llmModel).toBe("test-model");
    // 下一请求的 chat 参数解析即为新值
    expect(resolveChatParams(rc.snapshot()).maxSteps).toBe(3);
  });

  it("persist 回调收到全量 JSON（落库语义）", async () => {
    const rc = new RuntimeConfig(defaults());
    const persist = vi.fn(async (_data: unknown) => {});
    await rc.applyPatch({ agentMaxSteps: 2 }, { persist, updateBy: "tester" });
    expect(persist).toHaveBeenCalledTimes(1);
    const saved = persist.mock.calls[0]?.[0];
    expect(saved).toMatchObject({ agentMaxSteps: 2, rateLimitRpm: 20 });
  });

  it("非法 patch 抛 zod 错误且不生效", async () => {
    const rc = new RuntimeConfig(defaults());
    await expect(rc.applyPatch({ agentMaxSteps: 0 })).rejects.toThrow();
    await expect(rc.applyPatch({ rateLimitRpm: -1 })).rejects.toThrow();
    expect(rc.snapshot().agentMaxSteps).toBe(8);
  });

  it("replaceAll 内容相同不动、不同才生效（轮询语义）", () => {
    const rc = new RuntimeConfig(defaults());
    const v0 = rc.getVersion();
    expect(rc.replaceAll(rc.snapshot())).toBe(false);
    expect(rc.getVersion()).toBe(v0);
    expect(rc.replaceAll({ ...rc.snapshot(), agentMaxSteps: 4 })).toBe(true);
    expect(rc.snapshot().agentMaxSteps).toBe(4);
  });

  it("enabledTools null=全量语义保留；temperature/maxTokens null → undefined", async () => {
    const rc = new RuntimeConfig(defaults());
    expect(rc.snapshot().enabledTools).toBeNull();
    const params = resolveChatParams(rc.snapshot());
    expect(params.temperature).toBeUndefined();
    expect(params.maxOutputTokens).toBeUndefined();

    await rc.applyPatch({ temperature: 0.3, maxTokens: 512, enabledTools: ["camera_fly_to"] });
    const p2 = resolveChatParams(rc.snapshot());
    expect(p2.temperature).toBe(0.3);
    expect(p2.maxOutputTokens).toBe(512);
    expect(rc.snapshot().enabledTools).toEqual(["camera_fly_to"]);
  });
});
