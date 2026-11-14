// 文件作用：extent Node ES 模块
// 作者：JasonLee <shuiyuntian@foxmail.com>
// 创建日期：2026-07-26
// 版本：1.0.0
// 修改记录：
//   - 1.0.0 (2026-07-26) 初始创建
//
// 版权所有 (C) 2026 AGRSEarth 项目

// geolocation_extent 工具的纯函数部分：Overpass QL 构建 / 候选选取 / bounds 对角线 / LRU 缓存。
// 与 server.mjs 分离以便 node:test 直接单测（桥无测试框架，用 Node 内置 node:test，零新依赖）。
//
// 背景：vendor geolocation_geocode 返回的 boundingBox 常是点状框（对角线≈0），
// geolocation_search 不查 relation 且无 bounds，orchestrator 高度推算缺真实范围数据。
// 本模块支撑桥的第 4 个 MCP 工具 geolocation_extent：按名称查 Overpass way/relation
// 的 bounds 与 tags，供推算层按「2.7 × extent 对角线」定观察高度。
//
// 查询阶梯（开发测试环境 实测：nwr["name"~"^X$"] 全扫 14.8s 不可接受，已彻底移除）：
//  1. union QL 索引化精确匹配（name/official_name/name:zh 走 tag 索引 ~0.1s）+
//     alt_name 包含（值少 ~0.5s，regex 仅此一处）；
//  2. 未命中做后缀剥离重试（故宫博物院→故宫，剥离后长度≥2），再走第 1 步 union。

const EARTH_RADIUS_M = 6_371_000;

function toRad(deg) {
  return (deg * Math.PI) / 180;
}

/** haversine 球面距离（米） */
export function haversineMeters(lat1, lon1, lat2, lon2) {
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(a)));
}

/** bounds {minlat,minlon,maxlat,maxlon} 对角线跨度（haversine，米） */
export function boundsDiagonalMeters(bounds) {
  return haversineMeters(bounds.minlat, bounds.minlon, bounds.maxlat, bounds.maxlon);
}

/** bounds 中心点（候选距 at 排序用） */
export function boundsCenter(bounds) {
  return {
    lat: (bounds.minlat + bounds.maxlat) / 2,
    lon: (bounds.minlon + bounds.maxlon) / 2,
  };
}

/** Overpass 正则（POSIX ERE）转义：alt_name 包含匹配用 */
export function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** QL 双引号字符串字面量转义：精确匹配（"key"="value"）用 */
export function escapeQlString(s) {
  return s.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

export const EXTENT_DEFAULT_RADIUS_KM = 50;
export const EXTENT_MAX_RADIUS_KM = 500;
export const EXTENT_AROUND_TIMEOUT_SEC = 25;
export const EXTENT_GLOBAL_TIMEOUT_SEC = 60;
export const EXTENT_OUT_LIMIT = 8;

/**
 * 构建 extent 查询 QL：索引化 union——name/official_name/name:zh 精确（走 tag 索引
 * ~0.1s）+ alt_name 包含（值少 ~0.5s，regex 仅此一处）；输出 tags + bounds，限 8 条。
 * 有 at 时加 around 圈定（半径 radiusKm，超时 25s）；无 at 时全球查询（超时 60s）。
 * 严禁回到 nwr["name"~"^X$"] 锚定正则——开发测试环境 实测全表扫描 14.8s。
 */
export function buildExtentQuery({ name, at, radiusKm = EXTENT_DEFAULT_RADIUS_KM }) {
  const timeout = at ? EXTENT_AROUND_TIMEOUT_SEC : EXTENT_GLOBAL_TIMEOUT_SEC;
  const around = at
    ? `(around:${Math.round(radiusKm * 1000)},${at.latitude},${at.longitude})`
    : "";
  const exact = escapeQlString(name);
  const contains = escapeRegex(name);
  return (
    `[out:json][timeout:${timeout}];(` +
    `nwr["name"="${exact}"]${around};` +
    `nwr["official_name"="${exact}"]${around};` +
    `nwr["name:zh"="${exact}"]${around};` +
    `nwr["alt_name"~"${contains}"]${around};` +
    `);out tags bb ${EXTENT_OUT_LIMIT};`
  );
}

/**
 * POI 通名后缀表（长到短匹配，剥一次即止）。用于名称阶梯第二级：
 * 用户/geocode 给的全称常带通名（故宫博物院），而 OSM name 常是专名（故宫）。
 */
export const POI_SUFFIXES = [
  "博物院",
  "博物馆",
  "纪念馆",
  "公园",
  "大厦",
  "中心",
  "广场",
  "景区",
  "大学",
  "学院",
  "医院",
  "车站",
  "机场",
  "遗址",
  "体育",
  "寺",
  "塔",
  "山",
  "湖",
  "河",
  "桥",
  "门",
  "楼",
  "府",
  "陵",
];

/**
 * 剥一个尾部 POI 通名后缀（故宫博物院→故宫），剩余长度≥2 才返回候选，否则 null。
 * 只剥一次、只剥一个（命中最长后缀即返回），不做级联。
 */
export function stripPoiSuffix(name) {
  for (const suffix of POI_SUFFIXES) {
    if (name.endsWith(suffix)) {
      const stripped = name.slice(0, name.length - suffix.length);
      if (stripped.length >= 2) return stripped;
    }
  }
  return null;
}

function hasValidBounds(el) {
  const b = el?.bounds;
  return (
    b &&
    typeof b.minlat === "number" &&
    typeof b.minlon === "number" &&
    typeof b.maxlat === "number" &&
    typeof b.maxlon === "number"
  );
}

/**
 * 候选选取：relation 优先于 way（node 无 bounds 天然出局）；
 * 同类型多个候选且有 at 时取 bounds 中心距 at 最近者（无 at 取第一个）。
 * 返回选中的 element 或 undefined。
 */
export function selectExtentCandidate(elements, at) {
  const withBounds = (Array.isArray(elements) ? elements : []).filter(hasValidBounds);
  const relations = withBounds.filter((el) => el.type === "relation");
  const ways = withBounds.filter((el) => el.type === "way");
  const pool = relations.length > 0 ? relations : ways;
  if (pool.length === 0) return undefined;
  if (!at) return pool[0];
  let best;
  let bestDist = Infinity;
  for (const el of pool) {
    const c = boundsCenter(el.bounds);
    const d = haversineMeters(at.latitude, at.longitude, c.lat, c.lon);
    if (d < bestDist) {
      best = el;
      bestDist = d;
    }
  }
  return best;
}

/**
 * 解析 Overpass 响应为工具结果形态：
 * 命中 → {found, extent:{northeast, southwest, diagonalMeters}, osmType, osmId, tags, message}
 * 未命中 → {found:false, message}
 */
export function parseExtentResponse(json, at) {
  const el = selectExtentCandidate(json?.elements, at);
  if (!el) {
    return { found: false, message: "no named way/relation with bounds found" };
  }
  const diagonalMeters = Math.round(boundsDiagonalMeters(el.bounds));
  const tags = el.tags && typeof el.tags === "object" ? el.tags : {};
  const label = typeof tags.name === "string" ? tags.name : `${el.type}/${el.id}`;
  return {
    found: true,
    extent: {
      northeast: { lat: el.bounds.maxlat, lon: el.bounds.maxlon },
      southwest: { lat: el.bounds.minlat, lon: el.bounds.minlon },
      diagonalMeters,
    },
    osmType: el.type,
    osmId: el.id,
    tags,
    message: `${label}: ${el.type} ${el.id}, extent diagonal ≈ ${diagonalMeters}m`,
  };
}

/**
 * extent 查询 LRU 缓存（容量 200；正结果 TTL 1h，未命中负结果 TTL 5min——
 * 负结果粘性太大会挡住数据补录与调试；错误不缓存）。
 * set 第三参 ttlMs 可覆盖单条 TTL（server 侧按 found 分级）。
 */
export class ExtentCache {
  constructor({ capacity = 200, ttlMs = 3_600_000, negativeTtlMs = 300_000, now = () => Date.now() } = {}) {
    this.capacity = capacity;
    this.ttlMs = ttlMs;
    this.negativeTtlMs = negativeTtlMs;
    this.now = now;
    /** @type {Map<string, {value: unknown, expiresAt: number}>} 插入序即 LRU 序 */
    this.map = new Map();
  }

  get(key) {
    const entry = this.map.get(key);
    if (!entry) return undefined;
    if (this.now() >= entry.expiresAt) {
      this.map.delete(key);
      return undefined;
    }
    // LRU touch：重插到最新位
    this.map.delete(key);
    this.map.set(key, entry);
    return entry.value;
  }

  set(key, value, ttlMs = this.ttlMs) {
    if (this.map.has(key)) this.map.delete(key);
    else if (this.map.size >= this.capacity) {
      const oldest = this.map.keys().next().value;
      this.map.delete(oldest);
    }
    this.map.set(key, { value, expiresAt: this.now() + ttlMs });
  }

  get size() {
    return this.map.size;
  }
}

/** 缓存键：名称 + at（4 位小数≈11m 粒度） + 半径 */
export function extentCacheKey({ name, at, radiusKm = EXTENT_DEFAULT_RADIUS_KM }) {
  const atKey = at ? `${at.latitude.toFixed(4)},${at.longitude.toFixed(4)}` : "global";
  return `${name}|${atKey}|${radiusKm}`;
}
