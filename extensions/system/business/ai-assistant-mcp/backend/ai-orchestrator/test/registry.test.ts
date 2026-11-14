/**
 * 文件作用：registry.test 模块
 * 作者：JasonLee <shuiyuntian@foxmail.com>
 * 创建日期：2026-07-22
 * 版本：1.0.0
 * 修改记录：
 *   - 1.0.0 (2026-07-22) 初始创建
 *
 * 版权所有 (C) 2026 AGRSEarth 项目
 */

import { describe, expect, it } from "vitest";
import {
  buildToolRegistry,
  loadContracts,
  parseEnabledToolsEnv,
} from "../src/contracts/registry.js";

const contracts = loadContracts();

describe("tool contracts 与白名单 registry", () => {
  it("契约文件含 46 个工具（45 MCP + 1 本地 codegen），destructive 为 5 个 *_remove", () => {
    expect(contracts.tools).toHaveLength(46);
    const destructive = contracts.tools.filter((t) => t.riskLevel === "destructive");
    expect(destructive.map((t) => t.name).sort()).toEqual([
      "animation_remove",
      "entity_remove",
      "imagery_remove",
      "terrain_remove",
      "tileset_remove",
    ]);
    // S1：geolocation 域 3 个服务端工具
    const geo = contracts.tools.filter((t) => t.domain === "geolocation");
    expect(geo.map((t) => t.name).sort()).toEqual([
      "geolocation_geocode",
      "geolocation_route",
      "geolocation_search",
    ]);
    expect(geo.every((t) => t.side === "server")).toBe(true);
    // P3-A：本地附加工具 source:local
    const codegen = contracts.tools.filter((t) => t.riskLevel === "codegen");
    expect(codegen.map((t) => t.name)).toEqual(["cesium_execute_code"]);
    expect(codegen[0]?.source).toBe("local");
    expect(codegen[0]?.side).toBe("browser");
  });

  it("断言①：registry === 白名单（数组形态取交集）", () => {
    const whitelist = ["camera_fly_to", "entity_list"];
    const registry = buildToolRegistry(contracts, whitelist);
    expect([...registry.keys()].sort()).toEqual(["camera_fly_to", "entity_list"]);
    expect(registry.get("camera_fly_to")?.riskLevel).toBe("write");
  });

  it("断言②：空白名单 → 空 registry", () => {
    expect(buildToolRegistry(contracts, []).size).toBe(0);
    expect(buildToolRegistry(contracts, parseEnabledToolsEnv("")).size).toBe(0);
  });

  it("断言③：单工具 false 覆盖（record 形态默认全量，显式 false 剔除）", () => {
    const registry = buildToolRegistry(contracts, { entity_remove: false });
    expect(registry.size).toBe(contracts.tools.length - 1);
    expect(registry.has("entity_remove")).toBe(false);
    expect(registry.has("camera_fly_to")).toBe(true);
  });

  it("undefined → 契约全量；白名单中的未知名称被忽略", () => {
    expect(buildToolRegistry(contracts, undefined).size).toBe(46);
    const registry = buildToolRegistry(contracts, ["camera_fly_to", "no_such_tool"]);
    expect(registry.size).toBe(1);
  });

  it("parseEnabledToolsEnv：undefined 保持 undefined（全量），逗号分隔去空格", () => {
    expect(parseEnabledToolsEnv(undefined)).toBeUndefined();
    expect(parseEnabledToolsEnv("a, b ,c")).toEqual(["a", "b", "c"]);
  });
});
