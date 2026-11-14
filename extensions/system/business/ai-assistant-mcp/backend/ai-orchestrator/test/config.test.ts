/**
 * 文件作用：config.test 模块
 * 作者：JasonLee <shuiyuntian@foxmail.com>
 * 创建日期：2026-07-22
 * 版本：1.0.0
 * 修改记录：
 *   - 1.0.0 (2026-07-22) 初始创建
 *
 * 版权所有 (C) 2026 AGRSEarth 项目
 */

import { describe, expect, it, vi } from "vitest";
import { loadConfig } from "../src/config.js";

describe("config", () => {
  it("applies defaults on empty env", () => {
    const cfg = loadConfig({});
    expect(cfg.PORT).toBe(9600);
    expect(cfg.LLM_BASE_URL).toBe("https://llm.example.invalid/v1");
    expect(cfg.LLM_MODEL).toBe("external-model");
    expect(cfg.MCP_SSE_URL).toBe("http://localhost:3010/mcp/events");
    expect(cfg.MCP_RESULT_URL).toBe("http://localhost:3010/mcp/result");
    expect(cfg.MCP_HTTP_URL).toBe("http://localhost:4010/mcp");
    expect(cfg.GEO_MCP_URL).toBe("http://localhost:3008/mcp");
    expect(cfg.AGENT_MAX_STEPS).toBe(8);
    expect(cfg.SESSION_TTL_SEC).toBe(43_200);
  });

  it("accepts valid overrides", () => {
    const cfg = loadConfig({
      PORT: "9700",
      MCP_HTTP_URL: "http://127.0.0.1:5010/mcp",
      GEO_MCP_URL: "",
      AGENT_MAX_STEPS: "3",
      LLM_API_KEY: "sk-test",
    });
    expect(cfg.PORT).toBe(9700);
    expect(cfg.MCP_HTTP_URL).toBe("http://127.0.0.1:5010/mcp");
    expect(cfg.GEO_MCP_URL).toBe("");
    expect(cfg.AGENT_MAX_STEPS).toBe(3);
    expect(cfg.LLM_API_KEY).toBe("sk-test");
  });

  it("fails fast and prints all issues on invalid env", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      expect(() =>
        loadConfig({
          PORT: "not-a-number",
          GEO_MCP_URL: "not a url",
          AGENT_MAX_STEPS: "0",
          LLM_BASE_URL: "not a url",
        }),
      ).toThrowError(/Invalid configuration/);

      const printed = spy.mock.calls.map((c) => String(c[0])).join("\n");
      expect(printed).toContain("PORT");
      expect(printed).toContain("GEO_MCP_URL");
      expect(printed).toContain("AGENT_MAX_STEPS");
      expect(printed).toContain("LLM_BASE_URL");
    } finally {
      spy.mockRestore();
    }
  });
});
