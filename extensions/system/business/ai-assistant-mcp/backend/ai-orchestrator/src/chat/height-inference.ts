/**
 * 文件作用：height-inference 模块
 * 作者：JasonLee <shuiyuntian@foxmail.com>
 * 创建日期：2026-07-26
 * 版本：1.0.0
 * 修改记录：
 *   - 1.0.0 (2026-07-26) 初始创建
 *
 * 版权所有 (C) 2026 AGRSEarth 项目
 */

/**
 * 相机高度智能推算 v2（方案B）：确定性代码层，不靠模型自觉。
 *
 * 背景：camera_fly_to / camera_set_view / camera_look_at_transform 的契约 schema
 * 要求 destination/target.height（观察高度，米）。模型经常只给经纬度不给高度，
 * 或拍出脑袋拍一个数量级离谱的高度；而 vendor geocode 的 boundingBox 常是点状框
 * （对角线≈0），v1 等比公式因此过度保守（飞故宫博物院只推 500m）。
 *
 * v2 四级回退链（参数集中于 HEIGHT_RULES：factor=2.7、min=500m、max=500km、typeTable）：
 *  1. geolocation_extent 命中 → clamp(2.7 × extent 对角线, 500m, 500km)。
 *     extent 两个来源：geocode 成功后异步预取回填（预热）；camera_* 缺 height
 *     推算时历史仍无 extent → 内联有界（8s）await 一次补齐（首查竞态修复，
 *     并发同地点去重），补齐后再走本链；
 *     **R1 交叉校验**：bbox 对角线 ≥10km（行政区等实体真框）时，extent 必须与
 *     bbox 同量级（ratio ∈ [1/3, 1.5]）才可信，否则是误命中（同名小 POI /
 *     父级区域——北京曾命中 213m 对象、上海曾命中 534km 区域），回落第 3 级 bbox
 *     （Nominatim 真名解析优先）；bbox <10km 是 POI/合成框域，extent 直接用；
 *  2. 类型表（geolocation_search 返回的 types 合并入历史 / geocode 输出机会性携带）：
 *     building/amenity/shop/office→500m；tourism/museum/attraction/park/school/hospital/
 *     leisure→3km；road/street→2km；suburb/district/town→20km；city→80km；state→400km；
 *     country→1500km（按具体度取最具体匹配：building 系 > tourism 系 > road >
 *     suburb/district/town > city > state > country）；
 *  3. geocode boundingBox → clamp(1.0 × 对角线, 500m, 500km)。bbox 与 extent 不同源：
 *     Nominatim 村落级返回 ±0.02° 合成框（如篁岭对角线 ~5.9km），2.7 倍会过远，
 *     故 bbox 用 1.0 倍（几何取景，对角线≈观察高度）；点状框（楼宇级 POI，如
 *     奥运大厦对角线 ~89m）自然落下限 500m；省级真框（浙江 ~700km）落上限 500km；
 *  4. 缺省 10km（仅在无记录或记录无 extent/类型/bbox 时）。
 *
 *  R2 记录-目的地距离守卫（fillInferredCameraHeight / destinationGuard）：
 *  模型并行发起 geocode+camera 或凭记忆填坐标时，会话最新记录可能属于另一个地点
 *  （上海 flight 曾错用北京 extent → 575m）。记录落点与 camera 目的地距离超过
 *  max(50km, 1.5×bbox 跨度) 即弃用该记录，落缺省 10km 并在 reason 注明。
 *
 * 挂点在 secure-tools 的 ajv 校验之后、callTool 之前（camera_* 缺 height 初检必败 →
 * 推算填入 → 复检）；模型显式给 height 时尊重原值，绝不覆盖；
 * camera_fly_to/camera_set_view 缺 orientation 时填入正北垂直俯视
 * （vendor 缺省是 pitch -15° 斜视，见文件下部 TOP_DOWN_ORIENTATION 注释）。
 */

// ---------------------------------------------------------------------------
// 会话级 geocode 历史
// ---------------------------------------------------------------------------

export interface GeocodeBoundingBox {
  northeast: { latitude: number; longitude: number };
  southwest: { latitude: number; longitude: number };
}

/** geolocation_extent 命中结果（推算链第 1 级；由 secure-tools 异步预取/内联补齐回填） */
export interface ExtentInfo {
  /** bounds 对角线跨度（haversine，米） */
  diagonalMeters: number;
  osmType?: "relation" | "way";
  osmId?: number;
}

export interface GeocodeRecord {
  /** 记录时间（ms epoch），TTL 判定用 */
  at: number;
  /** geocode 入参 address（模型查询串） */
  query?: string;
  displayName?: string;
  address?: string;
  location: { latitude: number; longitude: number };
  bbox?: GeocodeBoundingBox;
  /** 类型线索（geocode 输出机会性携带 / geolocation_search 结果合并） */
  types?: string[];
  /** extent 预取命中后回填（同名地点后续推算直接命中） */
  extent?: ExtentInfo;
}

/** 每 session 最近一次 geocode 成功结果（内存态；TTL 对齐会话 TTL 12h，超限淘汰最旧） */
export class GeocodeHistory {
  private readonly bySession = new Map<string, GeocodeRecord>();

  constructor(
    private readonly ttlMs: number = 12 * 3600 * 1000,
    private readonly maxEntries: number = 500,
  ) {}

  record(sessionId: string, rec: Omit<GeocodeRecord, "at">): void {
    if (!this.bySession.has(sessionId) && this.bySession.size >= this.maxEntries) {
      // Map 保持插入序，删最旧一条
      const oldest = this.bySession.keys().next().value;
      if (oldest !== undefined) this.bySession.delete(oldest);
    }
    this.bySession.set(sessionId, { ...rec, at: Date.now() });
  }

  latest(sessionId: string): GeocodeRecord | undefined {
    const rec = this.bySession.get(sessionId);
    if (!rec) return undefined;
    if (Date.now() - rec.at > this.ttlMs) {
      this.bySession.delete(sessionId);
      return undefined;
    }
    return rec;
  }

  /** 取未过期记录（内部用；过期顺手清除） */
  private alive(sessionId: string): GeocodeRecord | undefined {
    return this.latest(sessionId);
  }

  /**
   * extent 预取完成后回填到当前记录（异步，不阻塞主链）。
   * 防串位：仅当当前记录 location 与预取发起时的 geocode 落点完全一致才写入
   * （期间用户 geocode 了别处 → 丢弃本次预取结果）。
   */
  updateExtent(
    sessionId: string,
    extent: ExtentInfo,
    location: { latitude: number; longitude: number },
  ): void {
    const rec = this.alive(sessionId);
    if (!rec) return;
    if (
      rec.location.latitude !== location.latitude ||
      rec.location.longitude !== location.longitude
    ) {
      return;
    }
    rec.extent = extent;
  }

  /** 合并 geolocation_search 结果的类型线索到当前记录（无记录/已过期则忽略） */
  mergeTypes(sessionId: string, types: readonly string[]): void {
    const rec = this.alive(sessionId);
    if (!rec || types.length === 0) return;
    rec.types = [...new Set([...(rec.types ?? []), ...types])];
  }
}

// ---------------------------------------------------------------------------
// geocode 工具结果解析
// ---------------------------------------------------------------------------

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function isFiniteNumber(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

function parseLatLon(v: unknown): { latitude: number; longitude: number } | undefined {
  if (!isRecord(v)) return undefined;
  if (!isFiniteNumber(v.latitude) || !isFiniteNumber(v.longitude)) return undefined;
  return { latitude: v.latitude, longitude: v.longitude };
}

function parseBbox(v: unknown): GeocodeBoundingBox | undefined {
  if (!isRecord(v)) return undefined;
  const northeast = parseLatLon(v.northeast);
  const southwest = parseLatLon(v.southwest);
  if (!northeast || !southwest) return undefined;
  return { northeast, southwest };
}

function parseTypes(sc: Record<string, unknown>): string[] | undefined {
  const out: string[] = [];
  if (Array.isArray(sc.types)) {
    for (const t of sc.types) if (typeof t === "string" && t) out.push(t);
  }
  // 兼容原始 nominatim 形态（class/category/type）被直接透传的情况
  for (const key of ["type", "class", "category"] as const) {
    const t = sc[key];
    if (typeof t === "string" && t) out.push(t);
  }
  return out.length > 0 ? out : undefined;
}

/**
 * 从 geolocation_geocode 的工具输出提取记录；非成功结果返回 null。
 * 输出形态以 structuredContent 为准（AI SDK MCP 工具透传 CallToolResult），
 * 兼容 structuredContent 缺失但顶层即结构化结果的情况。
 */
export function extractGeocodeRecord(
  input: unknown,
  output: unknown,
): Omit<GeocodeRecord, "at"> | null {
  if (!isRecord(output)) return null;
  const sc = isRecord(output.structuredContent) ? output.structuredContent : output;
  if (sc.success !== true) return null;
  const location = parseLatLon(sc.location);
  if (!location) return null;

  const query =
    isRecord(input) && typeof input.address === "string" ? input.address : undefined;
  return {
    query,
    displayName: typeof sc.displayName === "string" ? sc.displayName : undefined,
    address: typeof sc.address === "string" ? sc.address : undefined,
    location,
    bbox: parseBbox(sc.boundingBox),
    types: parseTypes(sc),
  };
}

/**
 * 从 geolocation_extent 的工具输出提取 extent（未命中/畸形返回 null）。
 * 输出形态（geolocation-http 桥 extent.mjs）：
 * { found:true, extent:{northeast:{lat,lon}, southwest:{lat,lon}, diagonalMeters},
 *   osmType:"relation"|"way", osmId, tags, message }。
 */
export function extractExtentResult(output: unknown): ExtentInfo | null {
  if (!isRecord(output)) return null;
  const sc = isRecord(output.structuredContent) ? output.structuredContent : output;
  if (sc.found !== true) return null;
  const extent = sc.extent;
  if (!isRecord(extent)) return null;
  if (!isFiniteNumber(extent.diagonalMeters) || extent.diagonalMeters <= 0) return null;
  return {
    diagonalMeters: extent.diagonalMeters,
    osmType:
      sc.osmType === "relation" || sc.osmType === "way" ? sc.osmType : undefined,
    osmId: isFiniteNumber(sc.osmId) ? sc.osmId : undefined,
  };
}

/**
 * 从 geolocation_search 的工具输出提取类型线索（前 10 个结果的 types 并集）。
 * vendor 输出：{ success, places:[{ name, location, types?, ... }], message, stats }，
 * places[].types 来自 OSM tag 值（amenity/shop/tourism/leisure 等）。
 */
export function extractSearchTypes(output: unknown): string[] | undefined {
  if (!isRecord(output)) return undefined;
  const sc = isRecord(output.structuredContent) ? output.structuredContent : output;
  if (sc.success !== true || !Array.isArray(sc.places)) return undefined;
  const out: string[] = [];
  for (const place of sc.places.slice(0, 10)) {
    if (isRecord(place) && Array.isArray(place.types)) {
      for (const t of place.types) {
        if (typeof t === "string" && t) out.push(t);
      }
    }
  }
  return out.length > 0 ? [...new Set(out)] : undefined;
}

// ---------------------------------------------------------------------------
// 高度推算规则（v2 四级回退链）
// ---------------------------------------------------------------------------

/**
 * 推算链集中参数：extent 高度 = clamp(factor × 对角线, min, max)。
 * factor=2.7 标定点：故宫 extent 对角线 1.33km → ≈3.6km（60° 视场俯视框住并留边距），
 * 楼宇级小 extent（对角线 <185m）→ 下限 500m（如奥运大厦），省级对角线 >185km → 上限 500km。
 * bboxFactor=1.0（仅第 3 级 bbox 用）：Nominatim 村落级 bbox 是 ±0.02° 合成框
 * （篁岭 ~5.9km），2.7 倍过远；1.0 倍即几何取景高度（对角线≈观察高度）。
 */
export const HEIGHT_RULES = {
  /** extent 范围对角线 → 观察高度的倍率 */
  factor: 2.7,
  /** geocode bbox 对角线 → 观察高度的倍率（合成框不可信，取几何取景 1.0） */
  bboxFactor: 1.0,
  /** clamp 下限（米）：楼宇/POI 级观察高度 */
  minM: 500,
  /** clamp 上限（米）：500km */
  maxM: 500_000,
  /** 无任何线索时的缺省观察高度（米） */
  defaultM: 10_000,
  /**
   * 类型默认表（无 extent 时按地点类型取观察高度，米）。
   * 数组顺序即具体度优先级（building 系最具体，country 最泛）：
   * 命中检查按序进行，joined 小写子串匹配（"city_district" 先于 city 命中 district）。
   */
  typeTable: [
    { keywords: ["building", "amenity", "shop", "office"], height: 500 },
    {
      keywords: ["tourism", "museum", "attraction", "park", "school", "hospital", "leisure"],
      height: 3_000,
    },
    { keywords: ["road", "street"], height: 2_000 },
    { keywords: ["suburb", "district", "town"], height: 20_000 },
    { keywords: ["city"], height: 80_000 },
    { keywords: ["state"], height: 400_000 },
    { keywords: ["country"], height: 1_500_000 },
  ],
} as const;

/** clamp 区间（米），兼容旧导出 */
export const HEIGHT_MIN_M = HEIGHT_RULES.minM;
export const HEIGHT_MAX_M = HEIGHT_RULES.maxM;
/** 无任何线索时的缺省观察高度（米） */
export const HEIGHT_DEFAULT_M = HEIGHT_RULES.defaultM;

/** 类型默认表（兼容旧导出；事实源在 HEIGHT_RULES.typeTable） */
export const TYPE_HEIGHT_TABLE: ReadonlyArray<{ keywords: readonly string[]; height: number }> =
  HEIGHT_RULES.typeTable;

const EARTH_RADIUS_M = 6_371_000;

function toRad(deg: number): number {
  return (deg * Math.PI) / 180;
}

/** 两点球面距离（haversine，米） */
export function distanceMeters(
  a: { latitude: number; longitude: number },
  b: { latitude: number; longitude: number },
): number {
  const dLat = toRad(b.latitude - a.latitude);
  const dLon = toRad(b.longitude - a.longitude);
  const lat1 = toRad(a.latitude);
  const lat2 = toRad(b.latitude);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** bbox 对角线跨度（haversine，米） */
export function bboxSpanMeters(bbox: GeocodeBoundingBox): number {
  const dLat = toRad(bbox.northeast.latitude - bbox.southwest.latitude);
  const dLon = toRad(bbox.northeast.longitude - bbox.southwest.longitude);
  const lat1 = toRad(bbox.southwest.latitude);
  const lat2 = toRad(bbox.northeast.latitude);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(a)));
}

function clampHeight(h: number): number {
  return Math.round(Math.min(HEIGHT_RULES.maxM, Math.max(HEIGHT_RULES.minM, h)));
}

/** 范围对角线（米）→ 观察高度：factor 倍缩放后 clamp 到 [500m, 500km] */
export function heightFromDiagonal(diagonalMeters: number): number {
  if (!(diagonalMeters > 0)) return HEIGHT_RULES.minM;
  return clampHeight(HEIGHT_RULES.factor * diagonalMeters);
}

/** bbox → 观察高度（bboxFactor 1.0 缩放后 clamp；点状框自然落下限 500m） */
export function heightFromBbox(bbox: GeocodeBoundingBox): number {
  return clampHeight(HEIGHT_RULES.bboxFactor * bboxSpanMeters(bbox));
}

/** extent 命中结果 → 观察高度 */
export function heightFromExtent(extent: ExtentInfo): number {
  return heightFromDiagonal(extent.diagonalMeters);
}

/** 类型表查高度（按具体度取最具体匹配）；命中返回 { height, matched }，未命中返回 undefined */
export function heightFromTypes(
  types: readonly string[],
): { height: number; matched: string } | undefined {
  const joined = types.join(",").toLowerCase();
  if (!joined) return undefined;
  for (const bucket of HEIGHT_RULES.typeTable) {
    for (const kw of bucket.keywords) {
      if (joined.includes(kw)) return { height: bucket.height, matched: kw };
    }
  }
  return undefined;
}

export interface HeightInference {
  height: number;
  reason: string;
}

// ---------------------------------------------------------------------------
// extent/bbox 交叉校验（R1：extent 误命中防护）
// ---------------------------------------------------------------------------

/**
 * bbox 对角线 ≥10km 视为实体真框（行政区等）：extent 必须与 bbox 同量级才可信，
 * 否则是误命中——同名小 POI（北京→213m 对象 vs 市域 bbox 288km）或父级区域
 * （上海→534km vs bbox 499km 量级尚属一致，超过 1.5× 才判父级）。
 * bbox <10km 是 POI/合成框域（Nominatim ±0.02° 合成框实测 ~5.9km），
 * 正是 extent（OSM 真实脚印）的存在意义，不做校验直接用 extent。
 */
export const EXTENT_BBOX_TRUST_MIN_M = 10_000;
/** extent 与 bbox 对角线比值的可信区间 [1/3, 1.5]，出界即错配回落 bbox */
export const EXTENT_BBOX_RATIO_MIN = 1 / 3;
export const EXTENT_BBOX_RATIO_MAX = 1.5;

/**
 * 依据会话 geocode 历史推算观察高度（v2 回退链 + R1 交叉校验）：
 * extent（2.7×对角线 clamp，经 bbox 量级校验）→ 类型表 → geocode bbox（1.0× clamp）→ 缺省 10km
 */
export function inferHeightMeters(record: GeocodeRecord | undefined): HeightInference {
  if (record?.extent && record.extent.diagonalMeters > 0) {
    const extentDiag = record.extent.diagonalMeters;
    const bboxSpan = record.bbox ? bboxSpanMeters(record.bbox) : undefined;
    // R1：bbox 为实体真框（≥10km）时校验 extent 与 bbox 量级一致性，
    // 错配（同名小 POI / 父级大区域）回落 bbox——Nominatim 真名解析优先
    if (bboxSpan !== undefined && bboxSpan >= EXTENT_BBOX_TRUST_MIN_M && record.bbox) {
      const ratio = extentDiag / bboxSpan;
      if (ratio < EXTENT_BBOX_RATIO_MIN || ratio > EXTENT_BBOX_RATIO_MAX) {
        return {
          height: heightFromBbox(record.bbox),
          reason: `extent 对角线 ${Math.round(extentDiag)}m 与 bbox 跨度 ${Math.round(bboxSpan)}m` +
            ` 量级错配（ratio ${ratio.toFixed(3)}），回落 bbox ×${HEIGHT_RULES.bboxFactor}`,
        };
      }
    }
    const diag = Math.round(extentDiag);
    return {
      height: heightFromExtent(record.extent),
      reason: `extent 对角线 ${diag}m ×${HEIGHT_RULES.factor}` +
        (record.extent.osmType ? `（OSM ${record.extent.osmType} ${record.extent.osmId ?? ""}）` : ""),
    };
  }
  if (record?.types?.length) {
    const hit = heightFromTypes(record.types);
    if (hit) {
      return { height: hit.height, reason: `类型默认表（命中 ${hit.matched}）` };
    }
  }
  if (record?.bbox) {
    const span = bboxSpanMeters(record.bbox);
    return {
      height: heightFromBbox(record.bbox),
      reason: `bbox 对角线跨度 ${Math.round(span)}m ×${HEIGHT_RULES.bboxFactor}` +
        (span < 185 ? "（点状/楼宇级，落下限）" : ""),
    };
  }
  return {
    height: HEIGHT_RULES.defaultM,
    reason: record ? "geocode 结果无 extent/类型/bbox，缺省值" : "无 geocode 历史，缺省值",
  };
}

// ---------------------------------------------------------------------------
// camera_* 参数规范化
// ---------------------------------------------------------------------------

/** 需要高度推算的 camera 工具及其位置字段 */
export const CAMERA_HEIGHT_FIELDS: Readonly<Record<string, "destination" | "target">> = {
  camera_fly_to: "destination",
  camera_set_view: "destination",
  camera_look_at_transform: "target",
};

export function isCameraHeightTool(name: string): boolean {
  return name in CAMERA_HEIGHT_FIELDS;
}

/**
 * camera_* 调用是否缺 height（内联 extent 补齐的触发条件）：
 * 非 camera 工具 / 位置字段缺失 / 模型已显式给 height 时返回 false。
 */
export function cameraHeightFieldMissing(name: string, input: unknown): boolean {
  const field = CAMERA_HEIGHT_FIELDS[name];
  if (!field || !isRecord(input)) return false;
  const target = input[field];
  if (!isRecord(target)) return false;
  return !isFiniteNumber(target.height);
}

/**
 * 记录-目的地距离守卫（R2：会话记录串位防护）阈值：
 * 模型并行发起 geocode+camera（或凭记忆填坐标）时，会话最新记录可能属于另一个地点
 * （上海 flight 实测用了北京的 extent → 575m）。距离下限 50km 宽容模型的坐标转述误差
 * （实测偏离仅 0.4km）；记录带 bbox 时阈值随 1.5×bbox 跨度放大（省级记录允许目的地
 * 落在省域内任意点）。
 */
export const RECORD_DESTINATION_GUARD_MIN_M = 50_000;
export const RECORD_DESTINATION_GUARD_BBOX_FACTOR = 1.5;

export interface DestinationGuardResult {
  usable: boolean;
  distM?: number;
  guardM?: number;
}

/**
 * R2 守卫判定：记录落点与本次 camera 目的地距离在阈值内才可用。
 * 非 camera 工具/入参畸形/目的地无坐标时不拦截（交校验链处理），返回 usable=true。
 */
export function destinationGuard(
  rec: Omit<GeocodeRecord, "at">,
  name: string,
  input: unknown,
): DestinationGuardResult {
  const field = CAMERA_HEIGHT_FIELDS[name];
  if (!field || !isRecord(input)) return { usable: true };
  const destination = parseLatLon(input[field]);
  if (!destination) return { usable: true };
  const distM = distanceMeters(rec.location, destination);
  const guardM = Math.max(
    RECORD_DESTINATION_GUARD_MIN_M,
    RECORD_DESTINATION_GUARD_BBOX_FACTOR * (rec.bbox ? bboxSpanMeters(rec.bbox) : 0),
  );
  return { usable: distM <= guardM, distM, guardM };
}

/**
 * camera_* 调用缺 height 时返回填入推算高度后的新入参（不可变拷贝）；
 * 不适用（非 camera 工具/字段缺失/模型已显式给 height）返回 null。
 * R2：记录与目的地错位（并行调用串位）时弃用记录，落缺省值并在 reason 注明。
 */
export function fillInferredCameraHeight(
  history: GeocodeHistory,
  sessionId: string,
  name: string,
  input: unknown,
): { input: unknown; inferred: HeightInference } | null {
  const field = CAMERA_HEIGHT_FIELDS[name];
  if (!field || !isRecord(input)) return null;
  const target = input[field];
  if (!isRecord(target)) return null;
  // 模型显式给 height（含 0）→ 尊重，不覆盖
  if (isFiniteNumber(target.height)) return null;

  const record = history.latest(sessionId);
  if (record) {
    const guard = destinationGuard(record, name, input);
    if (!guard.usable) {
      const label = record.query ?? record.displayName ?? "?";
      const inferred: HeightInference = {
        height: HEIGHT_RULES.defaultM,
        reason: `记录（${label}）与目的地错位（相距 ${Math.round((guard.distM ?? 0) / 1000)}km` +
          ` > 守卫 ${Math.round((guard.guardM ?? 0) / 1000)}km），弃用记录落缺省值`,
      };
      return {
        input: { ...input, [field]: { ...target, height: inferred.height } },
        inferred,
      };
    }
  }

  const inferred = inferHeightMeters(record);
  return {
    input: { ...input, [field]: { ...target, height: inferred.height } },
    inferred,
  };
}

// ---------------------------------------------------------------------------
// camera_* 视角缺省（垂直俯视）
// ---------------------------------------------------------------------------

/**
 * 垂直俯视缺省（S3）：vendor camera-server 的 DEFAULT_ORIENTATION 是 pitch -15°——
 * 模型省略 orientation 时 vendor 会把视角掰成斜视。「飞到某地」类调用缺省时
 * 由本层确定性地填入正北垂直俯视；模型显式给 orientation 时尊重原值。
 * 仅适用于带 orientation 字段的 camera_fly_to / camera_set_view
 * （camera_look_at_transform 走 lookAt offset 语义，其缺省已是 pitch -90）。
 */
export const TOP_DOWN_ORIENTATION = { heading: 0, pitch: -90, roll: 0 } as const;

/** 需要俯视缺省填入的 camera 工具（orientation 字段） */
export const CAMERA_ORIENTATION_TOOLS: ReadonlySet<string> = new Set([
  "camera_fly_to",
  "camera_set_view",
]);

/**
 * camera_* 调用缺 orientation 时返回填入垂直俯视角的新入参（不可变拷贝）；
 * 不适用（非 camera 工具/模型已显式给 orientation）返回 null。
 */
export function fillTopDownOrientation(
  name: string,
  input: unknown,
): { input: unknown } | null {
  if (!CAMERA_ORIENTATION_TOOLS.has(name) || !isRecord(input)) return null;
  // 模型显式给 orientation → 尊重，不覆盖
  if (input.orientation !== undefined && input.orientation !== null) return null;
  return { input: { ...input, orientation: { ...TOP_DOWN_ORIENTATION } } };
}
