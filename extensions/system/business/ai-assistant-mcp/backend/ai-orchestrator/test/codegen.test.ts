/**
 * 文件作用：codegen.test 模块
 * 作者：JasonLee <shuiyuntian@foxmail.com>
 * 创建日期：2026-07-23
 * 版本：1.0.0
 * 修改记录：
 *   - 1.0.0 (2026-07-23) 初始创建
 *
 * 版权所有 (C) 2026 AGRSEarth 项目
 */

import { describe, expect, it, vi } from "vitest";
import path from "node:path";
import { loadSkills, selectSkills, tokenize } from "../src/codegen/skills-loader.js";
import { runCodegenPipeline, CodegenError } from "../src/codegen/pipeline.js";
import { buildExposedTools } from "../src/chat/toolset.js";
import { buildToolRegistry, loadContracts } from "../src/contracts/registry.js";
import type { ToolSet } from "ai";

const SKILLS_DIR = path.resolve(
  __dirname,
  "../../../../../../../.kimi-code/skills",
);

describe("skills-loader + BM25 选域", () => {
  it("加载仓库 cesiumjs-* 技能（14 个领域技能）", () => {
    const docs = loadSkills(SKILLS_DIR);
    expect(docs.length).toBe(14);
    expect(docs.every((d) => d.body.length > 0)).toBe(true);
  });

  it("画圆 → primitives 域；多边形实体 → entities 域", () => {
    const docs = loadSkills(SKILLS_DIR);
    const selected = selectSkills("画一个以上海为中心半径 50 公里的圆", docs, 1);
    expect(selected[0]?.id).toBe("cesiumjs-primitives");
    const poly = selectSkills("添加一个多边形实体", docs, 1);
    expect(poly[0]?.id).toBe("cesiumjs-entities");
  });

  it("相机 → camera 域", () => {
    const docs = loadSkills(SKILLS_DIR);
    const selected = selectSkills("把相机飞到北京上空", docs, 1);
    expect(selected[0]?.id).toBe("cesiumjs-camera");
  });

  it("tokenizer：CJK 同义词扩展（圆→circle/ellipse）", () => {
    const tokens = tokenize("画圆");
    expect(tokens).toContain("circle");
    expect(tokens).toContain("ellipse");
  });
});

describe("codegen 管线重试", () => {
  const fakeModel = {} as never;

  it("第一次违规、第二次合规 → attempts=2，违规回喂进第二次 prompt", async () => {
    const seenFeedback: Array<string | undefined> = [];
    const generateFn = vi.fn(async (opts: { feedback?: string }) => {
      seenFeedback.push(opts.feedback);
      if (seenFeedback.length === 1) {
        return "fetch('/evil');"; // 违规
      }
      return "const c = Cesium.Cartesian3.fromDegrees(121.47, 31.23, 1000);\nviewer.camera.flyTo({ destination: c });";
    });

    const result = await runCodegenPipeline({
      intent: "飞相机",
      model: fakeModel,
      skillsDir: SKILLS_DIR,
      maxAttempts: 3,
      generateFn: generateFn as never,
    });

    expect(result.verified).toBe(true);
    expect(result.attempts).toBe(2);
    expect(seenFeedback[0]).toBeUndefined();
    expect(seenFeedback[1]).toContain("denied-identifier");
  });

  it("连续超限次数仍违规 → 抛 CodegenError 并带 violations", async () => {
    const generateFn = vi.fn(async () => "while (true) {}");
    await expect(
      runCodegenPipeline({
        intent: "x",
        model: fakeModel,
        skillsDir: SKILLS_DIR,
        maxAttempts: 2,
        generateFn: generateFn as never,
      }),
    ).rejects.toThrow(CodegenError);
    expect(generateFn).toHaveBeenCalledTimes(2);
  });
});

describe("codegen 工具注册开关", () => {
  const contracts = loadContracts();
  const registry = buildToolRegistry(contracts);
  const mcpTools: ToolSet = {
    camera_fly_to: { description: "fly", execute: async () => ({}) } as never,
  };

  it("codegenEnabled=false → 不注册 cesium_execute_code", () => {
    const tools = buildExposedTools(mcpTools, contracts, registry, false);
    expect(Object.keys(tools)).toEqual(["camera_fly_to"]);
  });

  it("codegenEnabled=true → 注册（带契约 inputSchema）", () => {
    const tools = buildExposedTools(mcpTools, contracts, registry, true);
    expect(Object.keys(tools).sort()).toEqual(["camera_fly_to", "cesium_execute_code"]);
    expect(tools.cesium_execute_code).toBeDefined();
  });

  it("codegenEnabled=true 但白名单剔除 → 不注册", () => {
    const narrow = buildToolRegistry(contracts, ["camera_fly_to"]);
    const tools = buildExposedTools(mcpTools, contracts, narrow, true);
    expect(Object.keys(tools)).toEqual(["camera_fly_to"]);
  });
});
