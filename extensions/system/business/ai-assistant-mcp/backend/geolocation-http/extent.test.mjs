// 文件作用：extent.test Node ES 模块
// 作者：JasonLee <shuiyuntian@foxmail.com>
// 创建日期：2026-07-26
// 版本：1.0.0
// 修改记录：
//   - 1.0.0 (2026-07-26) 初始创建
//
// 版权所有 (C) 2026 AGRSEarth 项目

// geolocation_extent 纯函数单测（Node 内置 node:test，零新依赖）。
// 运行：node --test extent.test.mjs
//
// fixture 数据：开发测试环境 Overpass 实测（本地不可达，测试不打网）——
//   故宫 relation 9511883 bounds (39.9116214,116.386202)-(39.9211913,116.3953903)，对角线≈1.33km；
//   relation 8855824「明清故宫」跨城合集（bounds 跨北京/沈阳），多候选时必须被
//   「距 at 最近者」原则跳过。

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  EXTENT_DEFAULT_RADIUS_KM,
  ExtentCache,
  boundsDiagonalMeters,
  buildExtentQuery,
  escapeQlString,
  escapeRegex,
  extentCacheKey,
  haversineMeters,
  parseExtentResponse,
  selectExtentCandidate,
  stripPoiSuffix,
} from "./extent.mjs";

const GUGONG_RELATION = {
  type: "relation",
  id: 9511883,
  bounds: { minlat: 39.9116214, minlon: 116.386202, maxlat: 39.9211913, maxlon: 116.3953903 },
  tags: { name: "故宫", tourism: "museum", historic: "castle" },
};

/** 「明清故宫」跨城合集：bounds 跨北京/沈阳，中心远离故宫 */
const MINGQING_RELATION = {
  type: "relation",
  id: 8855824,
  bounds: { minlat: 39.9042, minlon: 116.3912, maxlat: 41.7967, maxlon: 123.4515 },
  tags: { name: "明清故宫", heritage: "1" },
};

const GUGONG_WAY = {
  type: "way",
  id: 12345678,
  bounds: { minlat: 39.912, minlon: 116.3865, maxlat: 39.9209, maxlon: 116.395 },
  tags: { name: "故宫" },
};

/** 故宫博物院中心（geocode 常见落点） */
const AT_GUGONG = { latitude: 39.9163, longitude: 116.3972 };

describe("haversineMeters / boundsDiagonalMeters", () => {
  it("故宫 bounds 对角线 ≈ 1.33km（实测参考值）", () => {
    const d = boundsDiagonalMeters(GUGONG_RELATION.bounds);
    assert.ok(d > 1290 && d < 1360, `diagonal=${d}`);
  });

  it("同一点距离为 0；纬度 1° ≈ 111km", () => {
    assert.equal(haversineMeters(39.9, 116.4, 39.9, 116.4), 0);
    const d = haversineMeters(39, 116, 40, 116);
    assert.ok(d > 110_000 && d < 112_500, `1° lat = ${d}`);
  });
});

describe("escapeRegex", () => {
  it("正则元字符全部转义", () => {
    assert.equal(escapeRegex("a.b*c+d?e^f$g{h}i(j)k[l]m\\n|o"), String.raw`a\.b\*c\+d\?e\^f\$g\{h\}i\(j\)k\[l\]m\\n\|o`);
  });
  it("中文名原样保留", () => {
    assert.equal(escapeRegex("故宫博物院"), "故宫博物院");
  });
});

describe("buildExtentQuery（索引化 union，禁全扫）", () => {
  it("有 at：四条子句均带 around 圈定（半径米）+ timeout 25", () => {
    const q = buildExtentQuery({ name: "故宫", at: AT_GUGONG, radiusKm: 50 });
    const around = `(around:50000,${AT_GUGONG.latitude},${AT_GUGONG.longitude})`;
    assert.equal(
      q,
      `[out:json][timeout:25];(` +
        `nwr["name"="故宫"]${around};` +
        `nwr["official_name"="故宫"]${around};` +
        `nwr["name:zh"="故宫"]${around};` +
        `nwr["alt_name"~"故宫"]${around};` +
        `);out tags bb 8;`,
    );
  });

  it("无 at：全球查询，无 around，timeout 60", () => {
    const q = buildExtentQuery({ name: "故宫" });
    assert.equal(
      q,
      `[out:json][timeout:60];(` +
        `nwr["name"="故宫"];nwr["official_name"="故宫"];nwr["name:zh"="故宫"];nwr["alt_name"~"故宫"];` +
        `);out tags bb 8;`,
    );
  });

  it("缺省半径 50km；精确匹配 QL 字符串转义、alt_name 正则转义", () => {
    const q = buildExtentQuery({ name: 'St. Peter"s (Basilica)', at: AT_GUGONG });
    // 精确匹配：双引号转义（QL 字符串字面量）
    assert.ok(q.includes(String.raw`nwr["name"="St. Peter\"s (Basilica)"]`));
    // alt_name 包含：正则元字符转义
    assert.ok(q.includes(String.raw`nwr["alt_name"~"St\. Peter"s \(Basilica\)"]`));
    assert.ok(q.includes(`around:${EXTENT_DEFAULT_RADIUS_KM * 1000}`));
  });

  it("红线：无 nwr[\"name\"~\"^X$\"] 锚定正则全扫残留（开发测试环境 实测 14.8s）", () => {
    const q = buildExtentQuery({ name: "故宫", at: AT_GUGONG });
    assert.ok(!q.includes(String.raw`"name"~"^`));
    assert.ok(!q.includes(String.raw`$"]`));
  });
});

describe("stripPoiSuffix（名称阶梯第二级）", () => {
  it("故宫博物院→故宫（最长后缀优先）", () => {
    assert.equal(stripPoiSuffix("故宫博物院"), "故宫");
  });

  it("奥运大厦→奥运；景山公园→景山", () => {
    assert.equal(stripPoiSuffix("奥运大厦"), "奥运");
    assert.equal(stripPoiSuffix("景山公园"), "景山");
  });

  it("无后缀/剥离后不足 2 字 → null；只剥一次", () => {
    assert.equal(stripPoiSuffix("故宫"), null);
    assert.equal(stripPoiSuffix("黄山"), null); // 剥「山」后「黄」不足 2 字
    assert.equal(stripPoiSuffix("xyz"), null);
    // 「博物馆」先命中，不会剥成「故宫博物院→故宫博物」的怪串
    assert.equal(stripPoiSuffix("自然博物馆"), "自然");
  });
});

describe("escapeQlString", () => {
  it("双引号与反斜杠转义", () => {
    assert.equal(escapeQlString('a"b\\c'), String.raw`a\"b\\c`);
  });
  it("中文名原样保留", () => {
    assert.equal(escapeQlString("故宫博物院"), "故宫博物院");
  });
});

describe("selectExtentCandidate（relation 优先 + 距 at 最近）", () => {
  it("relation 优先于 way", () => {
    const el = selectExtentCandidate([GUGONG_WAY, GUGONG_RELATION], AT_GUGONG);
    assert.equal(el.id, 9511883);
    assert.equal(el.type, "relation");
  });

  it("多 relation 候选：距 at 最近者胜出（明清故宫跨城合集被跳过）", () => {
    // 8855824 在前也不影响最近者原则
    const el = selectExtentCandidate([MINGQING_RELATION, GUGONG_RELATION], AT_GUGONG);
    assert.equal(el.id, 9511883);
  });

  it("无 at：取第一个 relation（不做距离排序）", () => {
    const el = selectExtentCandidate([MINGQING_RELATION, GUGONG_RELATION], undefined);
    assert.equal(el.id, 8855824);
  });

  it("无 relation 时回落 way；node 无 bounds 出局；空列表 → undefined", () => {
    const node = { type: "node", id: 1, lat: 39.9, lon: 116.4, tags: { name: "故宫" } };
    assert.equal(selectExtentCandidate([node, GUGONG_WAY], AT_GUGONG).id, 12345678);
    assert.equal(selectExtentCandidate([node], AT_GUGONG), undefined);
    assert.equal(selectExtentCandidate([], AT_GUGONG), undefined);
    assert.equal(selectExtentCandidate(undefined, AT_GUGONG), undefined);
  });
});

describe("parseExtentResponse（工具结果形态）", () => {
  it("命中：extent 四至/对角线/osmType/osmId/tags", () => {
    const r = parseExtentResponse({ elements: [MINGQING_RELATION, GUGONG_RELATION] }, AT_GUGONG);
    assert.equal(r.found, true);
    assert.equal(r.osmType, "relation");
    assert.equal(r.osmId, 9511883);
    assert.deepEqual(r.extent.northeast, { lat: 39.9211913, lon: 116.3953903 });
    assert.deepEqual(r.extent.southwest, { lat: 39.9116214, lon: 116.386202 });
    assert.ok(r.extent.diagonalMeters > 1290 && r.extent.diagonalMeters < 1360);
    assert.equal(r.tags.name, "故宫");
    assert.ok(r.message.includes("9511883"));
  });

  it("未命中（空 elements / 无 bounds 候选）→ found=false", () => {
    assert.equal(parseExtentResponse({ elements: [] }, AT_GUGONG).found, false);
    assert.equal(
      parseExtentResponse({ elements: [{ type: "node", id: 1 }] }, AT_GUGONG).found,
      false,
    );
    assert.equal(parseExtentResponse({}, AT_GUGONG).found, false);
    assert.equal(parseExtentResponse(null, AT_GUGONG).found, false);
  });
});

describe("ExtentCache（LRU 容量 / TTL）", () => {
  it("写入后命中；同一键重复写不重复占容", () => {
    const c = new ExtentCache({ capacity: 3 });
    c.set("a", { found: true });
    c.set("a", { found: false });
    assert.equal(c.size, 1);
    assert.deepEqual(c.get("a"), { found: false });
    assert.equal(c.get("missing"), undefined);
  });

  it("超容量淘汰最久未用（get 命中会刷新 LRU 序）", () => {
    const c = new ExtentCache({ capacity: 2 });
    c.set("a", 1);
    c.set("b", 2);
    c.get("a"); // a 变最新
    c.set("c", 3); // 淘汰 b
    assert.equal(c.get("a"), 1);
    assert.equal(c.get("b"), undefined);
    assert.equal(c.get("c"), 3);
  });

  it("TTL 过期视为未命中", () => {
    let now = 1_000_000;
    const c = new ExtentCache({ ttlMs: 1000, now: () => now });
    c.set("a", 1);
    assert.equal(c.get("a"), 1);
    now += 1001;
    assert.equal(c.get("a"), undefined);
    assert.equal(c.size, 0);
  });

  it("单条 TTL 覆盖（负结果 5min 短 TTL，正结果默认 1h）", () => {
    let now = 1_000_000;
    const c = new ExtentCache({ ttlMs: 3_600_000, negativeTtlMs: 300_000, now: () => now });
    c.set("hit", { found: true }); // 默认 1h
    c.set("miss", { found: false }, c.negativeTtlMs); // 5min
    now += 300_001; // 过 5min
    assert.equal(c.get("miss"), undefined);
    assert.equal(c.get("hit") !== undefined, true);
    now += 3_600_000; // 再过 1h
    assert.equal(c.get("hit"), undefined);
  });

  it("extentCacheKey：at 4 位小数粒度，无 at 为 global", () => {
    assert.equal(
      extentCacheKey({ name: "故宫", at: AT_GUGONG, radiusKm: 50 }),
      "故宫|39.9163,116.3972|50",
    );
    assert.equal(extentCacheKey({ name: "故宫" }), "故宫|global|50");
  });
});
