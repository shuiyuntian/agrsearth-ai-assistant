/**
 * 文件作用：height-inference.test 模块
 * 作者：JasonLee <shuiyuntian@foxmail.com>
 * 创建日期：2026-07-26
 * 版本：1.0.0
 * 修改记录：
 *   - 1.0.0 (2026-07-26) 初始创建
 *
 * 版权所有 (C) 2026 AGRSEarth 项目
 */

import { describe, expect, it, vi } from "vitest";
import { jsonSchema } from "ai";
import type { ToolExecutionOptions, UIMessageStreamWriter } from "ai";
import {
  bboxSpanMeters,
  destinationGuard,
  distanceMeters,
  extractExtentResult,
  extractGeocodeRecord,
  extractSearchTypes,
  fillInferredCameraHeight,
  fillTopDownOrientation,
  GeocodeHistory,
  heightFromBbox,
  heightFromDiagonal,
  heightFromExtent,
  heightFromTypes,
  inferHeightMeters,
  HEIGHT_DEFAULT_M,
  HEIGHT_MAX_M,
  HEIGHT_MIN_M,
  HEIGHT_RULES,
  RECORD_DESTINATION_GUARD_MIN_M,
  TOP_DOWN_ORIENTATION,
  type GeocodeBoundingBox,
} from "../src/chat/height-inference.js";
import { buildExposedTools, relaxCameraHeightRequired } from "../src/chat/toolset.js";
import { wrapToolsForSession, EXTENT_INLINE_TIMEOUT_MS, type SecureToolDeps } from "../src/chat/secure-tools.js";
import { ApprovalManager } from "../src/security/approval.js";
import { ArgsValidator } from "../src/security/validator.js";
import type { ContractTool } from "../src/contracts/registry.js";

/** 测试用：解开 jsonSchema() 包装/裸 schema（与 toolset.unwrapJsonSchema 同逻辑） */
function unwrapForTest(t: unknown): Record<string, unknown> {
  const o = (t as { inputSchema?: unknown }).inputSchema as Record<string, unknown>;
  return ((o?.jsonSchema ?? o) || {}) as Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// 推算规则单元测试
// ---------------------------------------------------------------------------

function bbox(swLat: number, swLon: number, neLat: number, neLon: number): GeocodeBoundingBox {
  return {
    southwest: { latitude: swLat, longitude: swLon },
    northeast: { latitude: neLat, longitude: neLon },
  };
}

describe("范围对角线 → 高度（factor=2.7，clamp 500m~500km）", () => {
  it("大 bbox（跨洲级，跨度 >1500km）→ clamp 到 500km", () => {
    // 跨度约 2 万 km
    const h = heightFromBbox(bbox(-60, -170, 60, 170));
    expect(h).toBe(HEIGHT_MAX_M);
  });

  it("中 bbox（城市级，跨度 ~40km）→ 1.0×跨度 ≈ 40km（几何取景），不触发 clamp", () => {
    // 北京城区量级：0.2°纬×0.4°经 ≈ 40km 对角线
    const box = bbox(39.8, 116.2, 40.0, 116.6);
    const span = bboxSpanMeters(box);
    expect(span).toBeGreaterThan(15_000);
    expect(span).toBeLessThan(60_000);
    const h = heightFromBbox(box);
    expect(h).toBe(Math.round(HEIGHT_RULES.bboxFactor * span));
    expect(h).toBeGreaterThan(15_000);
    expect(h).toBeLessThan(60_000);
    expect(h).not.toBe(HEIGHT_MIN_M);
    expect(h).not.toBe(HEIGHT_MAX_M);
  });

  it("小 bbox（楼宇级，跨度 ~十米）→ clamp 到 500m", () => {
    const h = heightFromBbox(bbox(39.9, 116.4, 39.9001, 116.4001));
    expect(h).toBe(HEIGHT_MIN_M);
  });

  it("heightFromDiagonal：故宫对角线 1330m → 3591m（≈3.6km）；≤0 → 下限 500m", () => {
    expect(heightFromDiagonal(1330)).toBe(3591);
    expect(heightFromDiagonal(0)).toBe(HEIGHT_MIN_M);
    expect(heightFromDiagonal(-5)).toBe(HEIGHT_MIN_M);
    expect(heightFromExtent({ diagonalMeters: 2000 })).toBe(5400);
  });

  it("跨度单调：bbox 越大推算高度越高（clamp 区间内）", () => {
    const street = heightFromBbox(bbox(39.9, 116.4, 39.905, 116.405));
    const district = heightFromBbox(bbox(39.9, 116.4, 39.95, 116.45));
    const city = heightFromBbox(bbox(39.9, 116.4, 40.3, 116.8));
    expect(street).toBeLessThan(district);
    expect(district).toBeLessThan(city);
  });
});

describe("类型默认表（无 extent 时，按具体度取最具体匹配）", () => {
  it.each([
    [["country"], 1_500_000],
    [["state"], 400_000],
    [["city"], 80_000],
    [["town"], 20_000],
    [["suburb"], 20_000],
    [["city_district"], 20_000], // district 优先于 city 命中
    [["road"], 2_000],
    [["street"], 2_000],
    [["tourism", "attraction"], 3_000],
    [["museum"], 3_000],
    [["park"], 3_000],
    [["school"], 3_000],
    [["hospital"], 3_000],
    [["leisure"], 3_000],
    [["building"], 500],
    [["amenity", "cafe"], 500],
    [["shop"], 500],
    [["office"], 500],
  ])("types=%j → %d m", (types, expected) => {
    expect(heightFromTypes(types)?.height).toBe(expected);
  });

  it("具体度顺序：building 系 > tourism 系 > road > suburb/district/town > city > state > country", () => {
    expect(heightFromTypes(["country", "museum"])?.height).toBe(3_000);
    expect(heightFromTypes(["city", "building"])?.height).toBe(500);
    expect(heightFromTypes(["road", "office"])?.height).toBe(500);
    expect(heightFromTypes(["road", "park"])?.height).toBe(3_000);
    expect(heightFromTypes(["country", "state", "town"])?.height).toBe(20_000);
    expect(heightFromTypes(["state", "city"])?.height).toBe(80_000);
  });

  it("未知类型 → undefined（由 inferHeightMeters 落缺省）", () => {
    expect(heightFromTypes(["aeroway", "unknown_thing"])).toBeUndefined();
  });
});

describe("inferHeightMeters v2 优先级（extent(经 R1 交叉校验) > 类型表 > bbox(1.0×clamp) > 缺省 10km）", () => {
  it("extent 命中优先于类型表与 bbox：故宫对角线 1330m → clamp(2.7×1330)=3591m ≈ 3.6km", () => {
    const r = inferHeightMeters({
      location: { latitude: 39.9163, longitude: 116.3972 },
      // 故宫真实 bbox（~1.3km <10km，属 POI/合成框域，R1 不触发量级校验）
      bbox: bbox(39.9116, 116.3862, 39.9212, 116.3954),
      types: ["country"], // extent 在，类型/bbox 不参与
      extent: { diagonalMeters: 1330, osmType: "relation", osmId: 9511883 },
      at: Date.now(),
    });
    expect(r.height).toBe(3591);
    expect(r.reason).toContain("extent");
  });

  it("extent 景区级（婺源篁岭，对角线 ~2km）→ 5.4km（~5-6km 区间，不回归）", () => {
    const r = inferHeightMeters({
      location: { latitude: 29.42, longitude: 117.84 },
      extent: { diagonalMeters: 2000, osmType: "relation", osmId: 1 },
      at: Date.now(),
    });
    expect(r.height).toBe(5400);
    expect(r.height).toBeGreaterThan(5_000);
    expect(r.height).toBeLessThan(6_000);
  });

  it("extent 省级（浙江省，对角线 ~500km）→ clamp 上限 500km", () => {
    const r = inferHeightMeters({
      location: { latitude: 29.2, longitude: 120.1 },
      extent: { diagonalMeters: 500_000, osmType: "relation", osmId: 2 },
      at: Date.now(),
    });
    expect(r.height).toBe(HEIGHT_MAX_M);
  });

  it("extent 楼宇级（奥运大厦，对角线 ~150m）→ clamp 下限 500m", () => {
    const r = inferHeightMeters({
      location: { latitude: 39.99, longitude: 116.39 },
      extent: { diagonalMeters: 150, osmType: "way", osmId: 3 },
      at: Date.now(),
    });
    expect(r.height).toBe(HEIGHT_MIN_M);
  });

  it("无 extent 有类型 → 类型表（building/amenity → 500m，即便给了大 bbox 类型也优先）", () => {
    const r = inferHeightMeters({
      location: { latitude: 39.99, longitude: 116.39 },
      bbox: bbox(39.8, 116.2, 40.0, 116.6),
      types: ["building", "amenity"],
      at: Date.now(),
    });
    expect(r.height).toBe(500);
    expect(r.reason).toContain("类型默认表");
  });

  it("无 extent 有类型 → 类型表（city → 80km）", () => {
    const r = inferHeightMeters({
      location: { latitude: 39.9, longitude: 116.4 },
      types: ["place", "city"],
      at: Date.now(),
    });
    expect(r.height).toBe(80_000);
  });

  it("无 extent/类型，bbox → 1.0×跨度 clamp（回退第 3 级，几何取景）", () => {
    const box = bbox(39.8, 116.2, 40.0, 116.6);
    const r = inferHeightMeters({
      location: { latitude: 39.9, longitude: 116.4 },
      bbox: box,
      at: Date.now(),
    });
    expect(r.height).toBe(heightFromBbox(box));
    expect(r.reason).toContain("bbox");
  });

  it("省级 bbox（浙江省量级，跨度 ~670km）→ clamp 上限 500km", () => {
    const r = inferHeightMeters({
      location: { latitude: 29.2, longitude: 120.1 },
      bbox: bbox(27.0, 118.0, 31.2, 123.0),
      at: Date.now(),
    });
    expect(r.height).toBe(HEIGHT_MAX_M);
  });

  it("楼宇级点状 bbox（奥运大厦实测对角线 ~89m）→ 1.0× 后 clamp 下限 500m", () => {
    const r = inferHeightMeters({
      location: { latitude: 39.9863573, longitude: 116.342788 },
      // 开发测试环境 Nominatim 实测：奥运大厦 boundingbox ['39.9860688','39.9866458','116.3424244','116.3431516']
      bbox: bbox(39.9860688, 116.3424244, 39.9866458, 116.3431516),
      at: Date.now(),
    });
    expect(r.height).toBe(HEIGHT_MIN_M);
    expect(r.reason).toContain("落下限");
  });

  it("村落级合成 bbox（篁岭实测 Nominatim ±0.02° 框，对角线 ~5.9km）→ 1.0× ≈ 5.9km（~5-6km 不回归）", () => {
    const r = inferHeightMeters({
      location: { latitude: 29.3235898, longitude: 118.1132609 },
      // 开发测试环境 Nominatim 实测：篁岭 boundingbox ['29.3035898','29.3435898','118.0932609','118.1332609']
      bbox: bbox(29.3035898, 118.0932609, 29.3435898, 118.1332609),
      at: Date.now(),
    });
    expect(r.height).toBeGreaterThan(5_000);
    expect(r.height).toBeLessThan(6_500);
  });

  it("bbox 完全退化为点（对角线≈0）→ 下限 500m（不再落缺省 10km）", () => {
    const r = inferHeightMeters({
      location: { latitude: 39.9, longitude: 116.4 },
      bbox: bbox(39.9, 116.4, 39.9005, 116.4005),
      at: Date.now(),
    });
    expect(r.height).toBe(HEIGHT_MIN_M);
  });

  it("有历史但无 extent/类型/bbox → 缺省 10km", () => {
    const r = inferHeightMeters({
      location: { latitude: 39.9, longitude: 116.4 },
      at: Date.now(),
    });
    expect(r.height).toBe(HEIGHT_DEFAULT_M);
  });

  it("无 geocode 历史 → 缺省 10km", () => {
    const r = inferHeightMeters(undefined);
    expect(r.height).toBe(HEIGHT_DEFAULT_M);
    expect(r.reason).toContain("无 geocode 历史");
  });
});

describe("inferHeightMeters R1：extent/bbox 交叉校验（bbox≥10km 时量级一致性）", () => {
  it("北京型错配：extent 213m 同名小对象 vs 市域 bbox ~288km（ratio≈0.0007）→ 回落 bbox", () => {
    // 开发测试环境 实测：geocode 北京 boundingbox ['39.171','41.059','115.417','117.737']，extent 误命中 213m
    const box = bbox(39.1707096, 115.416849, 41.059236, 117.7371243);
    const r = inferHeightMeters({
      location: { latitude: 39.9057136, longitude: 116.3912972 },
      bbox: box,
      extent: { diagonalMeters: 213, osmType: "way", osmId: 123 },
      at: Date.now(),
    });
    expect(r.height).toBe(heightFromBbox(box));
    expect(r.height).toBeGreaterThan(200_000);
    expect(r.reason).toContain("错配");
    expect(r.reason).toContain("回落 bbox");
  });

  it("上海型一致：extent 534km vs bbox ~499km（ratio≈1.07 ∈ [1/3,1.5]）→ extent（clamp 500km）", () => {
    // 开发测试环境 实测：geocode 上海 boundingbox ['30.669','33.443','118.600','123.226']，extent 533890m
    const r = inferHeightMeters({
      location: { latitude: 31.2312707, longitude: 121.4700152 },
      bbox: bbox(30.6693672, 118.6001842, 33.4431436, 123.225706),
      extent: { diagonalMeters: 533_890, osmType: "relation", osmId: 456 },
      at: Date.now(),
    });
    expect(r.height).toBe(HEIGHT_MAX_M);
    expect(r.reason).toContain("extent");
  });

  it("父级区域错配：extent 800km vs bbox 200km（ratio 4 > 1.5）→ 回落 bbox", () => {
    const box = bbox(39.0, 115.5, 40.8, 117.5); // ~200km 对角线
    const r = inferHeightMeters({
      location: { latitude: 39.9, longitude: 116.4 },
      bbox: box,
      extent: { diagonalMeters: 800_000, osmType: "relation", osmId: 789 },
      at: Date.now(),
    });
    expect(r.height).toBe(heightFromBbox(box));
    expect(r.reason).toContain("错配");
  });

  it("同量级（ratio ∈ [1/3,1.5]）：extent 30km vs bbox 40km → extent 81km（脚印更准）", () => {
    const r = inferHeightMeters({
      location: { latitude: 39.9, longitude: 116.4 },
      bbox: bbox(39.8, 116.2, 40.0, 116.6), // ~40km 对角线
      extent: { diagonalMeters: 30_000, osmType: "relation", osmId: 1 },
      at: Date.now(),
    });
    expect(r.height).toBe(81_000);
    expect(r.reason).toContain("extent");
  });

  it("小 bbox（<10km，POI/合成框域）不校验：extent 直接用（故宫 1330m → 3591m）", () => {
    const r = inferHeightMeters({
      location: { latitude: 39.9163, longitude: 116.3972 },
      bbox: bbox(29.3035898, 118.0932609, 29.3435898, 118.1332609), // 篁岭式合成框 ~5.9km
      extent: { diagonalMeters: 1330, osmType: "relation", osmId: 9511883 },
      at: Date.now(),
    });
    expect(r.height).toBe(3591);
    expect(r.reason).toContain("extent");
  });

  it("无 bbox 时不校验：extent 直接用（ratio 无从计算）", () => {
    const r = inferHeightMeters({
      location: { latitude: 39.9, longitude: 116.4 },
      extent: { diagonalMeters: 213, osmType: "way", osmId: 123 },
      at: Date.now(),
    });
    expect(r.height).toBe(575); // 2.7×213
    expect(r.reason).toContain("extent");
  });
});

describe("GeocodeHistory（TTL / 容量）", () => {
  it("记录后可取；TTL 过期后视为无历史", () => {
    const h = new GeocodeHistory(60_000);
    h.record("s1", { location: { latitude: 1, longitude: 2 } });
    expect(h.latest("s1")?.location.latitude).toBe(1);
    expect(h.latest("other")).toBeUndefined();

    const expired = new GeocodeHistory(-1);
    expired.record("s1", { location: { latitude: 1, longitude: 2 } });
    expect(expired.latest("s1")).toBeUndefined();
  });

  it("超容量淘汰最旧一条", () => {
    const h = new GeocodeHistory(60_000, 2);
    h.record("a", { location: { latitude: 1, longitude: 1 } });
    h.record("b", { location: { latitude: 2, longitude: 2 } });
    h.record("c", { location: { latitude: 3, longitude: 3 } });
    expect(h.latest("a")).toBeUndefined();
    expect(h.latest("b")).toBeDefined();
    expect(h.latest("c")).toBeDefined();
  });

  it("updateExtent：location 匹配才回填；串位（期间 geocode 了别处）丢弃", () => {
    const h = new GeocodeHistory(60_000);
    const loc = { latitude: 39.9163, longitude: 116.3972 };
    h.record("s1", { location: loc, query: "故宫博物院" });
    const extent = { diagonalMeters: 1330, osmType: "relation" as const, osmId: 9511883 };

    // 串位：location 不一致 → 不写入
    h.updateExtent("s1", extent, { latitude: 31.2, longitude: 121.5 });
    expect(h.latest("s1")?.extent).toBeUndefined();

    // 匹配 → 写入，后续推算直接命中第 1 级
    h.updateExtent("s1", extent, loc);
    expect(h.latest("s1")?.extent?.diagonalMeters).toBe(1330);

    // 无记录/未知 session → 静默忽略
    h.updateExtent("s-unknown", extent, loc);
    expect(h.latest("s-unknown")).toBeUndefined();
  });

  it("mergeTypes：并入现有记录（去重）；无记录则忽略", () => {
    const h = new GeocodeHistory(60_000);
    h.record("s1", { location: { latitude: 1, longitude: 2 }, types: ["amenity"] });
    h.mergeTypes("s1", ["building", "amenity", "office"]);
    expect(h.latest("s1")?.types).toEqual(["amenity", "building", "office"]);

    h.mergeTypes("s-unknown", ["building"]);
    expect(h.latest("s-unknown")).toBeUndefined();
    h.mergeTypes("s1", []);
    expect(h.latest("s1")?.types).toEqual(["amenity", "building", "office"]);
  });
});

describe("extractExtentResult（geolocation_extent 工具输出形态）", () => {
  const extentOutput = {
    content: [{ type: "text", text: "📏 故宫: relation 9511883, extent diagonal ≈ 1330m (120ms)" }],
    structuredContent: {
      found: true,
      extent: {
        northeast: { lat: 39.9211913, lon: 116.3953903 },
        southwest: { lat: 39.9116214, lon: 116.386202 },
        diagonalMeters: 1330,
      },
      osmType: "relation",
      osmId: 9511883,
      tags: { name: "故宫" },
      message: "故宫: relation 9511883, extent diagonal ≈ 1330m",
    },
    isError: false,
  };

  it("命中：解析 diagonalMeters/osmType/osmId", () => {
    const r = extractExtentResult(extentOutput);
    expect(r).toEqual({ diagonalMeters: 1330, osmType: "relation", osmId: 9511883 });
  });

  it("未命中 / 错误 / 畸形 → null", () => {
    expect(
      extractExtentResult({ structuredContent: { found: false, message: "no" }, isError: false }),
    ).toBeNull();
    expect(
      extractExtentResult({ structuredContent: { found: false, message: "failed" }, isError: true }),
    ).toBeNull();
    expect(
      extractExtentResult({ structuredContent: { found: true, extent: { diagonalMeters: 0 } } }),
    ).toBeNull();
    expect(extractExtentResult({ structuredContent: { found: true } })).toBeNull();
    expect(extractExtentResult(null)).toBeNull();
  });
});

describe("extractSearchTypes（geolocation_search 工具输出形态）", () => {
  it("成功：前 10 个结果 types 去重并集", () => {
    const out = {
      structuredContent: {
        success: true,
        places: [
          { name: "A", location: { latitude: 1, longitude: 2 }, types: ["cafe", "amenity"] },
          { name: "B", location: { latitude: 3, longitude: 4 }, types: ["amenity", "building"] },
          { name: "C", location: { latitude: 5, longitude: 6 } },
        ],
        message: "Found 3 place(s)",
        stats: { queryTime: 5, resultsCount: 3 },
      },
      isError: false,
    };
    expect(extractSearchTypes(out)).toEqual(["cafe", "amenity", "building"]);
  });

  it("失败 / 无 places / 全无 types → undefined", () => {
    expect(
      extractSearchTypes({ structuredContent: { success: false, places: [], message: "x" }, isError: true }),
    ).toBeUndefined();
    expect(
      extractSearchTypes({ structuredContent: { success: true, message: "no places field" } }),
    ).toBeUndefined();
    expect(
      extractSearchTypes({ structuredContent: { success: true, places: [{ name: "A" }] } }),
    ).toBeUndefined();
    expect(extractSearchTypes(null)).toBeUndefined();
  });
});

describe("extractGeocodeRecord（vendor structuredContent 形态）", () => {
  it("成功结果：解析 location/boundingBox/displayName，input.address 记为 query", () => {
    const rec = extractGeocodeRecord(
      { address: "北京市" },
      {
        content: [{ type: "text", text: "📍 北京市 (10ms)" }],
        structuredContent: {
          success: true,
          location: { latitude: 39.9042, longitude: 116.4074, height: 0 },
          displayName: "北京市, 中国",
          address: "北京市, 中国",
          boundingBox: {
            northeast: { latitude: 41.1, longitude: 117.5 },
            southwest: { latitude: 39.4, longitude: 115.4 },
          },
          message: "北京市, 中国\n📏 Coordinates: 39.904200, 116.407400",
          stats: { queryTime: 10, resultsCount: 1 },
        },
        isError: false,
      },
    );
    expect(rec).not.toBeNull();
    expect(rec?.query).toBe("北京市");
    expect(rec?.location.latitude).toBeCloseTo(39.9042);
    expect(rec?.bbox?.southwest.longitude).toBeCloseTo(115.4);
    expect(rec?.displayName).toBe("北京市, 中国");
  });

  it("types/type/class 机会性提取（当前 vendor 输出不带，缺失时 types 为 undefined）", () => {
    const withTypes = extractGeocodeRecord(
      { address: "x" },
      {
        structuredContent: {
          success: true,
          location: { latitude: 1, longitude: 2 },
          types: ["place", "city"],
          message: "x",
        },
      },
    );
    expect(withTypes?.types).toEqual(["place", "city"]);

    const rawNominatim = extractGeocodeRecord(
      { address: "x" },
      {
        structuredContent: {
          success: true,
          location: { latitude: 1, longitude: 2 },
          class: "place",
          type: "town",
          message: "x",
        },
      },
    );
    expect(rawNominatim?.types).toEqual(["town", "place"]);

    const noTypes = extractGeocodeRecord(
      { address: "x" },
      { structuredContent: { success: true, location: { latitude: 1, longitude: 2 }, message: "x" } },
    );
    expect(noTypes?.types).toBeUndefined();
  });

  it("失败/畸形结果 → null", () => {
    expect(
      extractGeocodeRecord({ address: "x" }, { structuredContent: { success: false, message: "no" }, isError: true }),
    ).toBeNull();
    expect(extractGeocodeRecord({ address: "x" }, { ok: true })).toBeNull();
    expect(
      extractGeocodeRecord({ address: "x" }, { structuredContent: { success: true, message: "no location" } }),
    ).toBeNull();
  });
});

describe("fillInferredCameraHeight（参数规范化纯函数）", () => {
  const historyWithCityBbox = () => {
    const h = new GeocodeHistory();
    h.record("s1", {
      location: { latitude: 39.9, longitude: 116.4 },
      bbox: bbox(39.8, 116.2, 40.0, 116.6),
    });
    return h;
  };

  it("destination 缺 height → 填入推算值（不可变拷贝，原 input 不动）", () => {
    const h = historyWithCityBbox();
    const input = { destination: { longitude: 116.4, latitude: 39.9 }, duration: 3 };
    const r = fillInferredCameraHeight(h, "s1", "camera_fly_to", input);
    expect(r).not.toBeNull();
    const dest = (r!.input as unknown as { destination: { height: number } }).destination;
    expect(dest.height).toBe(heightFromBbox(bbox(39.8, 116.2, 40.0, 116.6)));
    expect((input.destination as { height?: number }).height).toBeUndefined();
  });

  it("camera_look_at_transform 走 target 字段", () => {
    const h = historyWithCityBbox();
    const r = fillInferredCameraHeight(h, "s1", "camera_look_at_transform", {
      target: { longitude: 116.4, latitude: 39.9 },
    });
    expect(r).not.toBeNull();
    expect(((r!.input as { target: { height: number } }).target.height)).toBeGreaterThan(0);
  });

  it("模型显式给 height → 返回 null（尊重不覆盖）", () => {
    const h = historyWithCityBbox();
    expect(
      fillInferredCameraHeight(h, "s1", "camera_fly_to", {
        destination: { longitude: 116.4, latitude: 39.9, height: 1234 },
      }),
    ).toBeNull();
    // height=0 也算显式
    expect(
      fillInferredCameraHeight(h, "s1", "camera_set_view", {
        destination: { longitude: 116.4, latitude: 39.9, height: 0 },
      }),
    ).toBeNull();
  });

  it("无 geocode 历史 → 缺省 10km", () => {
    const r = fillInferredCameraHeight(new GeocodeHistory(), "s-empty", "camera_set_view", {
      destination: { longitude: 116.4, latitude: 39.9 },
    });
    expect(r).not.toBeNull();
    expect(r!.inferred.height).toBe(HEIGHT_DEFAULT_M);
  });

  it("非 camera 工具 / destination 缺失 → null", () => {
    const h = historyWithCityBbox();
    expect(fillInferredCameraHeight(h, "s1", "entity_add_point", {})).toBeNull();
    expect(fillInferredCameraHeight(h, "s1", "camera_fly_to", {})).toBeNull();
    expect(fillInferredCameraHeight(h, "s1", "camera_fly_to", null)).toBeNull();
  });
});

describe("R2 记录-目的地距离守卫（并行调用串位防护）", () => {
  // 开发测试环境 实测：geocode 北京落点 (39.9057136, 116.3912972)，bbox 对角线 ~288km
  const BEIJING_REC = {
    location: { latitude: 39.9057136, longitude: 116.3912972 },
    query: "北京",
    bbox: bbox(39.1707096, 115.416849, 41.059236, 117.7371243),
  };

  it("destinationGuard：北京记录 vs 上海目的地（相距 ~1070km）→ 不可用", () => {
    const g = destinationGuard(BEIJING_REC, "camera_fly_to", {
      destination: { longitude: 121.47361, latitude: 31.230391 },
    });
    expect(g.usable).toBe(false);
    expect(g.distM).toBeGreaterThan(1_000_000);
    // 守卫阈值随 1.5×bbox 跨度（~432km）放大，远超 50km 下限
    expect(g.guardM).toBeGreaterThan(400_000);
    expect(g.guardM).toBeLessThan(RECORD_DESTINATION_GUARD_MIN_M * 20);
  });

  it("destinationGuard：0.4km 坐标转述偏差 → 放行", () => {
    // 开发测试环境 实测：模型凭记忆填 (121.47361,31.230391) vs geocode (121.4700152,31.2312707)
    const g = destinationGuard(
      {
        location: { latitude: 31.2312707, longitude: 121.4700152 },
        query: "上海",
      },
      "camera_fly_to",
      { destination: { longitude: 121.47361, latitude: 31.230391 } },
    );
    expect(g.usable).toBe(true);
    expect(g.distM).toBeLessThan(1_000);
  });

  it("destinationGuard：省级大 bbox 宽限——目的地距省中心 400km 仍可用", () => {
    const g = destinationGuard(
      {
        location: { latitude: 29.2, longitude: 119.8 },
        query: "浙江省",
        bbox: bbox(27.0, 118.0, 31.2, 123.0), // 对角线 ~670km → 守卫 ~1000km
      },
      "camera_fly_to",
      { destination: { longitude: 123.0, latitude: 31.0 } }, // 省域东北角附近
    );
    expect(g.usable).toBe(true);
  });

  it("destinationGuard：目的地无坐标 / 非 camera 工具 → 不拦截", () => {
    expect(destinationGuard(BEIJING_REC, "camera_fly_to", { destination: {} }).usable).toBe(true);
    expect(destinationGuard(BEIJING_REC, "entity_add_point", {}).usable).toBe(true);
  });

  it("fillInferredCameraHeight：错位记录被弃用 → 缺省 10km，reason 注明错位", () => {
    const h = new GeocodeHistory();
    h.record("s1", { ...BEIJING_REC });
    const r = fillInferredCameraHeight(h, "s1", "camera_fly_to", {
      destination: { longitude: 121.47361, latitude: 31.230391 },
    });
    expect(r).not.toBeNull();
    expect(r!.inferred.height).toBe(HEIGHT_DEFAULT_M);
    expect(r!.inferred.reason).toContain("错位");
    expect(r!.inferred.reason).toContain("北京");
    const dest = (r!.input as { destination: { height: number } }).destination;
    expect(dest.height).toBe(HEIGHT_DEFAULT_M);
  });

  it("fillInferredCameraHeight：阈值内记录正常推算（不回归）", () => {
    const h = new GeocodeHistory();
    h.record("s1", { ...BEIJING_REC });
    const r = fillInferredCameraHeight(h, "s1", "camera_fly_to", {
      destination: { longitude: 116.3912972, latitude: 39.9057136 },
    });
    expect(r!.inferred.height).toBe(heightFromBbox(BEIJING_REC.bbox));
  });

  it("distanceMeters：北京-上海 ~1067km；同点 0", () => {
    const d = distanceMeters(
      { latitude: 39.9057136, longitude: 116.3912972 },
      { latitude: 31.230391, longitude: 121.47361 },
    );
    expect(d).toBeGreaterThan(1_000_000);
    expect(d).toBeLessThan(1_150_000);
    expect(distanceMeters({ latitude: 1, longitude: 2 }, { latitude: 1, longitude: 2 })).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// secure-tools 挂点集成测试
// ---------------------------------------------------------------------------

const CAMERA_CONTRACT: ContractTool = {
  name: "camera_fly_to",
  domain: "camera",
  side: "browser",
  riskLevel: "write",
  description: "fly camera",
  inputSchema: {
    type: "object",
    properties: {
      destination: {
        type: "object",
        properties: {
          longitude: { type: "number", minimum: -180, maximum: 180 },
          latitude: { type: "number", minimum: -90, maximum: 90 },
          height: { type: "number", minimum: 0 },
        },
        required: ["longitude", "latitude", "height"],
      },
    },
    required: ["destination"],
  },
};

const GEOCODE_CONTRACT: ContractTool = {
  name: "geolocation_geocode",
  domain: "geolocation",
  side: "server",
  riskLevel: "write",
  description: "geocode",
  inputSchema: {
    type: "object",
    properties: { address: { type: "string", minLength: 1 } },
    required: ["address"],
  },
};

const SEARCH_CONTRACT: ContractTool = {
  name: "geolocation_search",
  domain: "geolocation",
  side: "server",
  riskLevel: "write",
  description: "search POIs",
  inputSchema: {
    type: "object",
    properties: { query: { type: "string", minLength: 1 } },
    required: ["query"],
  },
};

const OPTS = { toolCallId: "call-1", messages: [] } as unknown as ToolExecutionOptions<unknown>;

type ExecuteFn = (input: unknown, options: ToolExecutionOptions<unknown>) => Promise<unknown>;

function makeHarness(
  contracts: ContractTool[],
  mcpResults: Record<string, unknown>,
  extraDeps?: { callGeoTool?: SecureToolDeps["callGeoTool"] },
) {
  const geocodeHistory = new GeocodeHistory();
  const mcpExecutes: Record<string, ReturnType<typeof vi.fn>> = {};
  const tools: Record<string, { description: string; execute: ReturnType<typeof vi.fn> }> = {};
  for (const c of contracts) {
    const mock = vi.fn().mockResolvedValue(mcpResults[c.name] ?? { ok: true });
    mcpExecutes[c.name] = mock;
    tools[c.name] = { description: c.description, execute: mock };
  }
  const deps: SecureToolDeps = {
    sessionId: "s1",
    username: "tester",
    registry: new Map(contracts.map((c) => [c.name, c])),
    commandRouter: { registerCall: vi.fn(async () => () => {}) } as never,
    approvals: new ApprovalManager(120_000, { info: () => {}, warn: () => {} }),
    validator: new ArgsValidator(),
    isApprovalRequired: () => false,
    getWriter: () => ({ write: vi.fn() }) as unknown as UIMessageStreamWriter,
    geocodeHistory,
    callGeoTool: extraDeps?.callGeoTool,
  };
  const wrapped = wrapToolsForSession(tools as never, deps);
  const execute = (name: string) =>
    (wrapped[name] as unknown as { execute: ExecuteFn }).execute;
  const camMock = () => mcpExecutes[CAMERA_CONTRACT.name]!;
  return { geocodeHistory, mcpExecutes, execute, camMock };
}

const CITY_BBOX = {
  northeast: { latitude: 40.0, longitude: 116.6 },
  southwest: { latitude: 39.8, longitude: 116.2 },
};

describe("secure-tools 挂点：缺 height 推算（ajv 之后、callTool 之前）", () => {
  it("camera_fly_to 缺 height（契约 required，ajv 初检不过）→ 推算填入后过检走 MCP", async () => {
    const { geocodeHistory, execute, camMock } = makeHarness([CAMERA_CONTRACT], {});
    geocodeHistory.record("s1", {
      location: { latitude: 39.9, longitude: 116.4 },
      bbox: CITY_BBOX,
    });

    const result = await execute("camera_fly_to")(
      { destination: { longitude: 116.4, latitude: 39.9 } },
      OPTS,
    );
    expect(result).toEqual({ ok: true });
    expect(camMock()).toHaveBeenCalledTimes(1);
    const called = camMock().mock.calls[0]?.[0] as {
      destination: { longitude: number; latitude: number; height: number };
    };
    expect(called.destination.height).toBe(heightFromBbox(CITY_BBOX));
  });

  it("显式 height → 原样透传不覆盖", async () => {
    const { geocodeHistory, execute, camMock } = makeHarness([CAMERA_CONTRACT], {});
    geocodeHistory.record("s1", {
      location: { latitude: 39.9, longitude: 116.4 },
      bbox: CITY_BBOX,
    });

    await execute("camera_fly_to")(
      { destination: { longitude: 116.4, latitude: 39.9, height: 7777 } },
      OPTS,
    );
    const called = camMock().mock.calls[0]?.[0] as {
      destination: { height: number };
    };
    expect(called.destination.height).toBe(7777);
  });

  it("缺 height 且其他字段违例（longitude 超界）→ 不吞错，仍 validation_failed", async () => {
    const { geocodeHistory, execute, camMock } = makeHarness([CAMERA_CONTRACT], {});
    geocodeHistory.record("s1", {
      location: { latitude: 39.9, longitude: 116.4 },
      bbox: CITY_BBOX,
    });

    const result = (await execute("camera_fly_to")(
      { destination: { longitude: 999, latitude: 39.9 } },
      OPTS,
    )) as { isError: boolean; content: Array<{ text: string }> };
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain("参数校验未通过");
    expect(camMock()).not.toHaveBeenCalled();
  });

  it("geocode 成功结果被记录：同 session 后续 camera 调用用上该 bbox", async () => {
    const geocodeResult = {
      content: [{ type: "text", text: "📍 北京市 (5ms)" }],
      structuredContent: {
        success: true,
        location: { latitude: 39.9042, longitude: 116.4074, height: 0 },
        displayName: "北京市, 中国",
        boundingBox: CITY_BBOX,
        message: "北京市, 中国",
        stats: { queryTime: 5, resultsCount: 1 },
      },
      isError: false,
    };
    const { execute, camMock } = makeHarness(
      [GEOCODE_CONTRACT, CAMERA_CONTRACT],
      { [GEOCODE_CONTRACT.name]: geocodeResult },
    );

    await execute(GEOCODE_CONTRACT.name)({ address: "北京市" }, OPTS);
    await execute(CAMERA_CONTRACT.name)(
      { destination: { longitude: 116.4074, latitude: 39.9042 } },
      OPTS,
    );

    const called = camMock().mock.calls[0]?.[0] as {
      destination: { height: number };
    };
    expect(called.destination.height).toBe(heightFromBbox(CITY_BBOX));
  });

  it("geocode 失败结果不记录 → 后续 camera 用缺省 10km", async () => {
    const failResult = {
      structuredContent: { success: false, message: "Geocoding failed", stats: { queryTime: 1, resultsCount: 0 } },
      isError: true,
    };
    const { execute, camMock } = makeHarness(
      [GEOCODE_CONTRACT, CAMERA_CONTRACT],
      { [GEOCODE_CONTRACT.name]: failResult },
    );

    await execute(GEOCODE_CONTRACT.name)({ address: "不存在的地方" }, OPTS);
    await execute(CAMERA_CONTRACT.name)(
      { destination: { longitude: 116.4, latitude: 39.9 } },
      OPTS,
    );

    const called = camMock().mock.calls[0]?.[0] as {
      destination: { height: number };
    };
    expect(called.destination.height).toBe(HEIGHT_DEFAULT_M);
  });
});

describe("secure-tools 挂点 v2：extent 异步预取与 search types 合并", () => {
  const GUGONG_GEOCODE_RESULT = {
    content: [{ type: "text", text: "📍 故宫 (5ms)" }],
    structuredContent: {
      success: true,
      location: { latitude: 39.9163, longitude: 116.3972, height: 0 },
      displayName: "故宫, 东城区, 北京市, 中国",
      message: "故宫",
      stats: { queryTime: 5, resultsCount: 1 },
    },
    isError: false,
  };

  const GUGONG_EXTENT_OUTPUT = {
    structuredContent: {
      found: true,
      extent: {
        northeast: { lat: 39.9211913, lon: 116.3953903 },
        southwest: { lat: 39.9116214, lon: 116.386202 },
        diagonalMeters: 1330,
      },
      osmType: "relation",
      osmId: 9511883,
      tags: { name: "故宫" },
      message: "故宫: relation 9511883, extent diagonal ≈ 1330m",
    },
    isError: false,
  };

  const EXTENT_MISS_OUTPUT = {
    structuredContent: { found: false, message: "no named way/relation with bounds found" },
    isError: false,
  };

  const flushPrefetch = () => new Promise((r) => setTimeout(r, 10));

  it("geocode 成功后异步预取 extent：后续 camera 推算命中第 1 级（故宫 2.7×1330=3591m）", async () => {
    const callGeoTool = vi.fn().mockResolvedValue(GUGONG_EXTENT_OUTPUT);
    const { geocodeHistory, execute, camMock } = makeHarness(
      [GEOCODE_CONTRACT, CAMERA_CONTRACT],
      { [GEOCODE_CONTRACT.name]: GUGONG_GEOCODE_RESULT },
      { callGeoTool },
    );

    await execute(GEOCODE_CONTRACT.name)({ address: "故宫博物院" }, OPTS);
    await vi.waitFor(() => {
      expect(geocodeHistory.latest("s1")?.extent?.diagonalMeters).toBe(1330);
    });
    // 预取走 geo MCP client 委托，入参 {name, at}
    expect(callGeoTool).toHaveBeenCalledWith("geolocation_extent", {
      name: "故宫博物院",
      at: { latitude: 39.9163, longitude: 116.3972 },
    });

    await execute(CAMERA_CONTRACT.name)(
      { destination: { longitude: 116.3972, latitude: 39.9163 } },
      OPTS,
    );
    const called = camMock().mock.calls[0]?.[0] as { destination: { height: number } };
    expect(called.destination.height).toBe(3591);
  });

  it("预取名称兜底：查询名未命中 → displayName 首段再试", async () => {
    const callGeoTool = vi.fn().mockImplementation(async (_tool: string, input: unknown) => {
      const n = (input as { name: string }).name;
      return n === "故宫" ? GUGONG_EXTENT_OUTPUT : EXTENT_MISS_OUTPUT;
    });
    const { geocodeHistory, execute } = makeHarness(
      [GEOCODE_CONTRACT],
      { [GEOCODE_CONTRACT.name]: GUGONG_GEOCODE_RESULT },
      { callGeoTool },
    );

    await execute(GEOCODE_CONTRACT.name)({ address: "故宫博物院" }, OPTS);
    await vi.waitFor(() => {
      expect(geocodeHistory.latest("s1")?.extent?.diagonalMeters).toBe(1330);
    });
    const names = callGeoTool.mock.calls.map((c) => (c[1] as { name: string }).name);
    expect(names).toEqual(["故宫博物院", "故宫"]);
  });

  it("预取失败静默（extent 工具不可用）：不阻塞主链，camera 回落 bbox 推算", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const callGeoTool = vi.fn().mockRejectedValue(new Error("geo MCP 工具不可用: geolocation_extent"));
      const geocodeResult = {
        structuredContent: {
          success: true,
          location: { latitude: 39.9042, longitude: 116.4074, height: 0 },
          displayName: "北京市, 中国",
          boundingBox: CITY_BBOX,
          message: "北京市, 中国",
          stats: { queryTime: 5, resultsCount: 1 },
        },
        isError: false,
      };
      const { geocodeHistory, execute, camMock } = makeHarness(
        [GEOCODE_CONTRACT, CAMERA_CONTRACT],
        { [GEOCODE_CONTRACT.name]: geocodeResult },
        { callGeoTool },
      );

      await execute(GEOCODE_CONTRACT.name)({ address: "北京市" }, OPTS);
      await vi.waitFor(() => expect(callGeoTool).toHaveBeenCalled());
      await flushPrefetch();
      expect(geocodeHistory.latest("s1")?.extent).toBeUndefined();

      await execute(CAMERA_CONTRACT.name)(
        { destination: { longitude: 116.4074, latitude: 39.9042 } },
        OPTS,
      );
      const called = camMock().mock.calls[0]?.[0] as { destination: { height: number } };
      expect(called.destination.height).toBe(heightFromBbox(CITY_BBOX));
    } finally {
      warnSpy.mockRestore();
    }
  });

  it("extent 已命中也不覆盖模型显式 height", async () => {
    const { geocodeHistory, execute, camMock } = makeHarness([CAMERA_CONTRACT], {});
    geocodeHistory.record("s1", {
      location: { latitude: 39.9163, longitude: 116.3972 },
      extent: { diagonalMeters: 1330, osmType: "relation", osmId: 9511883 },
    });

    await execute(CAMERA_CONTRACT.name)(
      { destination: { longitude: 116.3972, latitude: 39.9163, height: 7777 } },
      OPTS,
    );
    const called = camMock().mock.calls[0]?.[0] as { destination: { height: number } };
    expect(called.destination.height).toBe(7777);
  });

  it("geolocation_search 成功 → types 合并入历史，后续 camera 走类型表（奥运大厦 building → 500m）", async () => {
    const pointGeocode = {
      structuredContent: {
        success: true,
        location: { latitude: 39.99, longitude: 116.39, height: 0 },
        displayName: "奥运大厦, 北京市, 中国",
        // 点状 bbox（对角线≈0）：无 types 时走 bbox 级落下限 500m
        boundingBox: {
          northeast: { latitude: 39.99, longitude: 116.39 },
          southwest: { latitude: 39.99, longitude: 116.39 },
        },
        message: "奥运大厦",
        stats: { queryTime: 1, resultsCount: 1 },
      },
      isError: false,
    };
    const searchResult = {
      structuredContent: {
        success: true,
        places: [
          {
            name: "奥运大厦",
            location: { latitude: 39.99, longitude: 116.39 },
            types: ["building", "office"],
          },
        ],
        message: "Found 1 place(s): 奥运大厦",
        stats: { queryTime: 3, resultsCount: 1 },
      },
      isError: false,
    };
    const callGeoTool = vi.fn().mockResolvedValue(EXTENT_MISS_OUTPUT); // extent 预取未命中
    const { geocodeHistory, execute, camMock } = makeHarness(
      [GEOCODE_CONTRACT, SEARCH_CONTRACT, CAMERA_CONTRACT],
      {
        [GEOCODE_CONTRACT.name]: pointGeocode,
        [SEARCH_CONTRACT.name]: searchResult,
      },
      { callGeoTool },
    );

    await execute(GEOCODE_CONTRACT.name)({ address: "奥运大厦" }, OPTS);
    await vi.waitFor(() => expect(callGeoTool).toHaveBeenCalled());
    await flushPrefetch();
    expect(geocodeHistory.latest("s1")?.extent).toBeUndefined();

    await execute(SEARCH_CONTRACT.name)({ query: "奥运大厦" }, OPTS);
    expect(geocodeHistory.latest("s1")?.types).toEqual(["building", "office"]);

    await execute(CAMERA_CONTRACT.name)(
      { destination: { longitude: 116.39, latitude: 39.99 } },
      OPTS,
    );
    const called = camMock().mock.calls[0]?.[0] as { destination: { height: number } };
    expect(called.destination.height).toBe(500);
  });

  it("search 失败结果不合并 → 点状 bbox 会话走 bbox 级落下限 500m", async () => {
    const pointGeocode = {
      structuredContent: {
        success: true,
        location: { latitude: 39.99, longitude: 116.39, height: 0 },
        boundingBox: {
          northeast: { latitude: 39.99, longitude: 116.39 },
          southwest: { latitude: 39.99, longitude: 116.39 },
        },
        message: "x",
        stats: { queryTime: 1, resultsCount: 1 },
      },
      isError: false,
    };
    const searchFail = {
      structuredContent: { success: false, places: [], message: "Search failed", stats: { queryTime: 1, resultsCount: 0 } },
      isError: true,
    };
    const { execute, camMock } = makeHarness(
      [GEOCODE_CONTRACT, SEARCH_CONTRACT, CAMERA_CONTRACT],
      { [GEOCODE_CONTRACT.name]: pointGeocode, [SEARCH_CONTRACT.name]: searchFail },
    );

    await execute(GEOCODE_CONTRACT.name)({ address: "奥运大厦" }, OPTS);
    await execute(SEARCH_CONTRACT.name)({ query: "奥运大厦" }, OPTS);
    await execute(CAMERA_CONTRACT.name)(
      { destination: { longitude: 116.39, latitude: 39.99 } },
      OPTS,
    );
    const called = camMock().mock.calls[0]?.[0] as { destination: { height: number } };
    expect(called.destination.height).toBe(HEIGHT_MIN_M);
  });
});

describe("secure-tools 挂点 v2.1：extent 内联补齐（首查竞态修复）", () => {
  const GUGONG_LOC = { latitude: 39.9163, longitude: 116.3972 };
  const GUGONG_EXTENT_OUTPUT = {
    structuredContent: {
      found: true,
      extent: {
        northeast: { lat: 39.9211913, lon: 116.3953903 },
        southwest: { lat: 39.9116214, lon: 116.386202 },
        diagonalMeters: 1330,
      },
      osmType: "relation",
      osmId: 9511883,
      tags: { name: "故宫" },
      message: "故宫: relation 9511883, extent diagonal ≈ 1330m",
    },
    isError: false,
  };
  const EXTENT_MISS_OUTPUT = {
    structuredContent: { found: false, message: "no named way/relation with bounds found" },
    isError: false,
  };

  it("首查无缓存：历史无 extent → 内联 await extent（延迟 50ms）→ 命中第 1 级 3591m", async () => {
    const callGeoTool = vi.fn(async () => {
      await new Promise((r) => setTimeout(r, 50));
      return GUGONG_EXTENT_OUTPUT;
    });
    const { geocodeHistory, execute, camMock } = makeHarness([CAMERA_CONTRACT], {}, { callGeoTool });
    // 模拟 geocode 已记录但 extent 预取尚未回填的首查竞态
    geocodeHistory.record("s1", {
      location: GUGONG_LOC,
      query: "故宫博物院",
      displayName: "故宫博物院, 东城区, 北京市, 中国",
    });

    const result = await execute("camera_fly_to")(
      { destination: { longitude: 116.3972, latitude: 39.9163 } },
      OPTS,
    );
    expect(result).toEqual({ ok: true });
    expect(callGeoTool).toHaveBeenCalledWith("geolocation_extent", {
      name: "故宫博物院",
      at: GUGONG_LOC,
    });
    const called = camMock().mock.calls[0]?.[0] as { destination: { height: number } };
    expect(called.destination.height).toBe(heightFromExtent({ diagonalMeters: 1330 }));
  });

  it("并发同地点推算：在途查询去重，extent 只查一次", async () => {
    const callGeoTool = vi.fn(async () => {
      await new Promise((r) => setTimeout(r, 50));
      return GUGONG_EXTENT_OUTPUT;
    });
    const { geocodeHistory, execute, camMock } = makeHarness([CAMERA_CONTRACT], {}, { callGeoTool });
    geocodeHistory.record("s1", {
      location: { latitude: 39.901, longitude: 116.401 }, // 独立坐标避免与其他用例撞去重键
      query: "太庙",
      displayName: "太庙, 东城区, 北京市, 中国",
    });

    await Promise.all([
      execute("camera_fly_to")(
        { destination: { longitude: 116.401, latitude: 39.901 } },
        OPTS,
      ),
      execute("camera_fly_to")(
        { destination: { longitude: 116.401, latitude: 39.901 } },
        { toolCallId: "call-2", messages: [] } as unknown as ToolExecutionOptions<unknown>,
      ),
    ]);
    expect(callGeoTool).toHaveBeenCalledTimes(1);
    for (const call of camMock().mock.calls) {
      expect((call[0] as { destination: { height: number } }).destination.height).toBe(
        heightFromExtent({ diagonalMeters: 1330 }),
      );
    }
  });

  it("内联未命中：回落 bbox 推算（不阻塞、不报错）", async () => {
    const callGeoTool = vi.fn(async () => EXTENT_MISS_OUTPUT);
    const { geocodeHistory, execute, camMock } = makeHarness([CAMERA_CONTRACT], {}, { callGeoTool });
    geocodeHistory.record("s1", {
      location: { latitude: 39.9, longitude: 116.4 },
      query: "无名地",
      bbox: CITY_BBOX,
    });

    await execute("camera_fly_to")(
      { destination: { longitude: 116.4, latitude: 39.9 } },
      OPTS,
    );
    expect(callGeoTool).toHaveBeenCalledTimes(1);
    const called = camMock().mock.calls[0]?.[0] as { destination: { height: number } };
    expect(called.destination.height).toBe(heightFromBbox(CITY_BBOX));
  });

  it("内联超时：extent 查询挂起 → 有界等待后落缺省 10km，主链不卡死", async () => {
    vi.useFakeTimers();
    try {
      const callGeoTool = vi.fn(() => new Promise(() => {})); // 永不 resolve
      const { geocodeHistory, execute, camMock } = makeHarness([CAMERA_CONTRACT], {}, { callGeoTool });
      geocodeHistory.record("s1", {
        location: { latitude: 10.1234, longitude: 20.1234 }, // 独立坐标避免在途键污染
        query: "挂起地",
      });

      const p = execute("camera_fly_to")(
        { destination: { longitude: 20.1234, latitude: 10.1234 } },
        OPTS,
      );
      await vi.advanceTimersByTimeAsync(EXTENT_INLINE_TIMEOUT_MS + 100);
      await p;
      const called = camMock().mock.calls[0]?.[0] as { destination: { height: number } };
      expect(called.destination.height).toBe(HEIGHT_DEFAULT_M);
    } finally {
      vi.useRealTimers();
    }
  });

  it("模型显式 height：不触发内联 extent 查询，原值透传", async () => {
    const callGeoTool = vi.fn(async () => GUGONG_EXTENT_OUTPUT);
    const { geocodeHistory, execute, camMock } = makeHarness([CAMERA_CONTRACT], {}, { callGeoTool });
    geocodeHistory.record("s1", { location: GUGONG_LOC, query: "故宫博物院" });

    await execute("camera_fly_to")(
      { destination: { longitude: 116.3972, latitude: 39.9163, height: 7777 } },
      OPTS,
    );
    expect(callGeoTool).not.toHaveBeenCalled();
    const called = camMock().mock.calls[0]?.[0] as { destination: { height: number } };
    expect(called.destination.height).toBe(7777);
  });

  it("R2+R3 挂点：错位记录不触发内联 extent 查询，落缺省 10km 并打决策日志", async () => {
    const callGeoTool = vi.fn(async () => EXTENT_MISS_OUTPUT);
    const infoSpy = vi.spyOn(console, "info").mockImplementation(() => {});
    try {
      const { geocodeHistory, execute, camMock } = makeHarness([CAMERA_CONTRACT], {}, { callGeoTool });
      // 开发测试环境 实测串位现场：会话最新记录是北京，模型并行发起的 camera 目的地是上海
      geocodeHistory.record("s1", {
        location: { latitude: 39.9057136, longitude: 116.3912972 },
        query: "北京",
        bbox: bbox(39.1707096, 115.416849, 41.059236, 117.7371243),
      });

      await execute("camera_fly_to")(
        { destination: { longitude: 121.47361, latitude: 31.230391 } },
        OPTS,
      );
      // R2：记录与目的地错位 → 不为它补 extent（省一次 Overpass 查询）
      expect(callGeoTool).not.toHaveBeenCalled();
      const called = camMock().mock.calls[0]?.[0] as { destination: { height: number } };
      expect(called.destination.height).toBe(HEIGHT_DEFAULT_M);
      // R3：推算决策 console 可见
      const line = infoSpy.mock.calls
        .map((c) => String(c[0]))
        .find((s) => s.includes("[height-inference] 推算填入"));
      expect(line).toBeDefined();
      expect(line).toContain("错位");
      expect(line).toContain(String(HEIGHT_DEFAULT_M));
    } finally {
      infoSpy.mockRestore();
    }
  });
});

describe("fillTopDownOrientation（S3 垂直俯视缺省）", () => {
  it("camera_fly_to 缺 orientation → 填入正北垂直俯视（不可变拷贝）", () => {
    const input = { destination: { longitude: 116.4, latitude: 39.9, height: 1000 } };
    const r = fillTopDownOrientation("camera_fly_to", input);
    expect(r).not.toBeNull();
    const o = (r!.input as { orientation: { heading: number; pitch: number; roll: number } })
      .orientation;
    expect(o).toEqual(TOP_DOWN_ORIENTATION);
    expect(o.pitch).toBe(-90);
    expect((input as { orientation?: unknown }).orientation).toBeUndefined();
  });

  it("camera_set_view 缺 orientation → 同样填入", () => {
    const r = fillTopDownOrientation("camera_set_view", {
      destination: { longitude: 1, latitude: 2, height: 3 },
    });
    expect(r).not.toBeNull();
  });

  it("模型显式给 orientation → 返回 null（尊重不覆盖）", () => {
    expect(
      fillTopDownOrientation("camera_fly_to", {
        destination: { longitude: 116.4, latitude: 39.9 },
        orientation: { heading: 90, pitch: -30, roll: 0 },
      }),
    ).toBeNull();
  });

  it("非视角工具 / 非对象入参 → null", () => {
    expect(fillTopDownOrientation("camera_look_at_transform", { target: {} })).toBeNull();
    expect(fillTopDownOrientation("entity_add_point", {})).toBeNull();
    expect(fillTopDownOrientation("camera_fly_to", null)).toBeNull();
  });
});

describe("secure-tools 挂点：缺 orientation 俯视填入", () => {
  it("camera_fly_to 缺 height+orientation → height 推算 + 俯视注入，一并通过 ajv 走 MCP", async () => {
    const { geocodeHistory, execute, camMock } = makeHarness([CAMERA_CONTRACT], {});
    geocodeHistory.record("s1", {
      location: { latitude: 39.9, longitude: 116.4 },
      bbox: CITY_BBOX,
    });

    const result = await execute("camera_fly_to")(
      { destination: { longitude: 116.4, latitude: 39.9 } },
      OPTS,
    );
    expect(result).toEqual({ ok: true });
    const called = camMock().mock.calls[0]?.[0] as {
      destination: { height: number };
      orientation: { heading: number; pitch: number; roll: number };
    };
    expect(called.destination.height).toBe(heightFromBbox(CITY_BBOX));
    expect(called.orientation).toEqual(TOP_DOWN_ORIENTATION);
  });

  it("显式 orientation（pitch -30）→ 原样透传不覆盖", async () => {
    const { execute, camMock } = makeHarness([CAMERA_CONTRACT], {});
    await execute("camera_fly_to")(
      {
        destination: { longitude: 116.4, latitude: 39.9, height: 500 },
        orientation: { heading: 90, pitch: -30, roll: 0 },
      },
      OPTS,
    );
    const called = camMock().mock.calls[0]?.[0] as {
      orientation: { heading: number; pitch: number; roll: number };
    };
    expect(called.orientation).toEqual({ heading: 90, pitch: -30, roll: 0 });
  });
});

describe("relaxCameraHeightRequired（S3 模型侧 schema 放宽）", () => {
  const mcpCamTool = () => ({
    description: "fly camera",
    inputSchema: jsonSchema({
      type: "object",
      properties: {
        destination: {
          type: "object",
          properties: {
            longitude: { type: "number" },
            latitude: { type: "number" },
            height: { type: "number" },
          },
          required: ["longitude", "latitude", "height"],
        },
      },
      required: ["destination"],
      additionalProperties: false,
    }),
    execute: async () => ({ ok: true }),
  });

  it("destination.required 中 height 被摘除，其余 required 保留；execute/description 不变", () => {
    const t = relaxCameraHeightRequired(mcpCamTool() as never, "destination");
    const plain = unwrapForTest(t);
    const dest = (
      (plain.properties as Record<string, Record<string, unknown>>).destination as {
        required: string[];
      }
    );
    expect(dest.required).toEqual(["longitude", "latitude"]);
    expect((t as { description?: string }).description).toBe("fly camera");
    expect(typeof (t as { execute?: unknown }).execute).toBe("function");
  });

  it("无 height required / 非目标结构 → 原样返回（同一引用）", () => {
    const t = mcpCamTool() as never;
    expect(relaxCameraHeightRequired(t, "target")).toBe(t);
    expect(relaxCameraHeightRequired({ inputSchema: null } as never, "destination")).toEqual({
      inputSchema: null,
    });
  });

  it("buildExposedTools 仅放宽 camera 三件，其他工具 schema 不动", () => {
    const cam = mcpCamTool() as never;
    const other = {
      description: "add label",
      inputSchema: jsonSchema({
        type: "object",
        properties: { text: { type: "string" } },
        required: ["text"],
      }),
      execute: async () => ({}),
    } as never;
    const contracts = { version: 1, tools: [] } as never;
    const registry = new Map([
      ["camera_fly_to", {}],
      ["entity_add_label", {}],
    ]) as never;
    const tools = buildExposedTools(
      { camera_fly_to: cam, entity_add_label: other },
      contracts,
      registry,
      false,
    );
    const camPlain = unwrapForTest(tools.camera_fly_to);
    expect(
      (
        (camPlain.properties as Record<string, Record<string, unknown>>).destination as {
          required: string[];
        }
      ).required,
    ).not.toContain("height");
    const otherPlain = unwrapForTest(tools.entity_add_label);
    expect((otherPlain as { required: string[] }).required).toEqual(["text"]);
  });
});
