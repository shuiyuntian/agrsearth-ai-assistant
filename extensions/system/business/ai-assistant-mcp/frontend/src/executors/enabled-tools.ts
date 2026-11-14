/**
 * 文件作用：可执行工具白名单（enabledTools）解析与类型定义
 * 作者：JasonLee <shuiyuntian@foxmail.com>
 * 创建日期：2026-07-22
 * 版本：2.0.0
 * 修改记录：
 *   - 2.0.0 (2026-07-26) S2-A：白名单语义对齐契约（contracts/tool-contracts.json v1，
 *                       upstream cesium-ai-integrations 2606b49）：全集由 28 个命令类型
 *                       改为 45 个契约 MCP 工具名（+cesium_execute_code 本地 codegen 工具，
 *                       共 46 项）。类型层次：
 *                         EnabledTool（白名单全集 46）
 *                         ├─ BrowserContractTool（浏览器契约工具 39，side=browser）
 *                         ├─ ServerContractTool（服务端契约工具 6：discovery 3 + geolocation 3；
 *                         │   不经浏览器执行，白名单按契约全集含它们，前端无 executor）
 *                         └─ cesium_execute_code（chat 流内执行，非命令通道）
 *                       执行器分发经 COMMAND_TYPE_TO_TOOL_NAMES（命令类型 → 契约工具名族，
 *                       29 键 = 28 命令通道类型 + codegen 防御 stub）与 resolveCommandType
 *                       （与 orchestrator command-router.resolveCommandType 逐字对齐：
 *                       entity_add_*→entity_add、globe_set_lighting→globe_lighting）。
 *   - 1.0.0 (2026-07-22) P1-B：白名单编译期守卫（配套 executors/index.ts）。
 *                       ALL_EXECUTABLE_TOOLS 与命令执行终端（原 useSSEConnection
 *                       commandHandlers，现 executors/index.ts TOOL_EXECUTORS）的实现一一对应；
 *                       manifest config 的 enabledTools 缺省/为空 = 全量启用。
 *
 * 版权所有 (C) 2026 AGRSEarth 项目
 */

/**
 * 浏览器契约工具名（39 个，契约 side=browser；经命令通道驱动浏览器执行）
 * @description 与 contracts/tool-contracts.json 中 side=browser 且非 codegen 的工具一一对应
 * （对账断言见 test/enabled-tools.test.ts，契约变更时测试立即变红）。
 */
export const BROWSER_CONTRACT_TOOLS = [
  // ── Camera (7) ──
  'camera_fly_to',
  'camera_set_view',
  'camera_look_at_transform',
  'camera_start_orbit',
  'camera_stop_orbit',
  'camera_get_position',
  'camera_set_controller_options',
  // ── Entity (14)：entity_add_* 12 个图形工具 + list/remove ──
  'entity_add_point',
  'entity_add_label',
  'entity_add_billboard',
  'entity_add_model',
  'entity_add_polygon',
  'entity_add_polyline',
  'entity_add_rectangle',
  'entity_add_wall',
  'entity_add_corridor',
  'entity_add_ellipse',
  'entity_add_cylinder',
  'entity_add_box',
  'entity_list',
  'entity_remove',
  // ── Animation (8)（契约 domain=animation，含 clock_control 与 globe_set_lighting） ──
  'animation_create',
  'animation_control',
  'animation_remove',
  'animation_list_active',
  'animation_update_path',
  'animation_camera_tracking',
  'clock_control',
  'globe_set_lighting',
  // ── Imagery (3) ──
  'imagery_add',
  'imagery_remove',
  'imagery_list',
  // ── Tileset (4) ──
  'tileset_add',
  'tileset_remove',
  'tileset_list',
  'tileset_style',
  // ── Terrain (3) ──
  'terrain_set',
  'terrain_get',
  'terrain_remove'
] as const

/**
 * 服务端契约工具名（6 个，契约 side=server：discovery 3 + geolocation 3）
 * @description 不经浏览器执行（orchestrator 侧直连 MCP gateway / geolocation HTTP 桥）。
 * 白名单语义按契约全集含它们——enabledTools 显式清单可配置、MCPStatusDetail 按域展示，
 * 但前端没有也不会收到它们的执行器命令（无 executor）。
 */
export const SERVER_CONTRACT_TOOLS = [
  // ── Discovery (3) ──
  'cesium_list_domains',
  'cesium_enable_domain',
  'cesium_disable_domain',
  // ── Geolocation (3) ──
  'geolocation_geocode',
  'geolocation_route',
  'geolocation_search'
] as const

/**
 * 前端可识别的全部工具（白名单全集 = 契约 45 个 MCP 工具名 + cesium_execute_code，共 46 项）
 * @description 与 contracts/tool-contracts.json 的 tools 全集一致（含 source=local 的
 * cesium_execute_code；对账断言见 test/enabled-tools.test.ts）。
 */
export const ALL_EXECUTABLE_TOOLS = [
  ...BROWSER_CONTRACT_TOOLS,
  ...SERVER_CONTRACT_TOOLS,
  // 注意：cesium_execute_code 为 chat 流内执行工具（非命令通道工具，见 executors/codegen.ts）；
  // 放入全集使类型守卫可识别，但 manifest.json 显式 enabledTools 清单不含它 = 默认关闭，
  // 由能力包配置显式开启（执行侧另有 enabledTools 运行时门，见 useAIAssistant）
  'cesium_execute_code'
] as const

/** 浏览器契约工具名（BROWSER_CONTRACT_TOOLS 的联合类型） */
export type BrowserContractTool = (typeof BROWSER_CONTRACT_TOOLS)[number]

/** 服务端契约工具名（SERVER_CONTRACT_TOOLS 的联合类型） */
export type ServerContractTool = (typeof SERVER_CONTRACT_TOOLS)[number]

/** 可启用工具名（ALL_EXECUTABLE_TOOLS 的联合类型，46 项） */
export type EnabledTool = (typeof ALL_EXECUTABLE_TOOLS)[number]

/**
 * 工具名 → MCP 命令类型归一（与 orchestrator command-router.resolveCommandType 逐字对齐）。
 * MCP 侧绝大多数 browser 工具 toolName === command.type，例外两族（vendor pristine 不可改）：
 *  - entity_add_* 12 个工具统一发 command.type = "entity_add"；
 *  - globe_set_lighting 发 command.type = "globe_lighting"。
 * server 工具（discovery/geolocation）不经命令通道，无浏览器命令类型（此处恒等返回兜底，
 * 调用方不应把 server 工具名当命令类型用——isExecutorCommandType 会判 false）。
 * @param toolName - 契约 MCP 工具名
 * @returns 命令通道下发的 command.type
 */
export function resolveCommandType(toolName: string): string {
  if (toolName.startsWith('entity_add_')) return 'entity_add'
  if (toolName === 'globe_set_lighting') return 'globe_lighting'
  return toolName
}

/**
 * 命令类型 → 契约工具名族（执行器分发单一事实源）。
 * 键 = 浏览器侧可执行的 29 个命令类型（28 个命令通道类型 + cesium_execute_code 防御 stub），
 * 与 executors/index.ts TOOL_EXECUTORS 的键一一对应（Record 全键编译期守卫 + 测试运行时对账）；
 * 值 = 归一到该命令类型的契约工具名族（白名单按族判定：族内任一工具启用即放行该命令类型——
 * 命令通道下发的 command 只带 type 不带工具名，entity_add 族无法也无须再细分）。
 * 族全集 = BROWSER_CONTRACT_TOOLS ∪ {cesium_execute_code}，由 test/enabled-tools.test.ts 对账。
 */
export const COMMAND_TYPE_TO_TOOL_NAMES = {
  // ── Camera (7) ──
  camera_fly_to: ['camera_fly_to'],
  camera_set_view: ['camera_set_view'],
  camera_look_at_transform: ['camera_look_at_transform'],
  camera_start_orbit: ['camera_start_orbit'],
  camera_stop_orbit: ['camera_stop_orbit'],
  camera_get_position: ['camera_get_position'],
  camera_set_controller_options: ['camera_set_controller_options'],
  // ── Entity (3 命令类型 ← 14 工具名) ──
  entity_add: [
    'entity_add_point',
    'entity_add_label',
    'entity_add_billboard',
    'entity_add_model',
    'entity_add_polygon',
    'entity_add_polyline',
    'entity_add_rectangle',
    'entity_add_wall',
    'entity_add_corridor',
    'entity_add_ellipse',
    'entity_add_cylinder',
    'entity_add_box'
  ],
  entity_list: ['entity_list'],
  entity_remove: ['entity_remove'],
  // ── Animation / Clock / Globe (8) ──
  animation_create: ['animation_create'],
  animation_control: ['animation_control'],
  animation_remove: ['animation_remove'],
  animation_list_active: ['animation_list_active'],
  animation_update_path: ['animation_update_path'],
  animation_camera_tracking: ['animation_camera_tracking'],
  clock_control: ['clock_control'],
  globe_lighting: ['globe_set_lighting'],
  // ── Imagery (3) ──
  imagery_add: ['imagery_add'],
  imagery_remove: ['imagery_remove'],
  imagery_list: ['imagery_list'],
  // ── Tileset (4) ──
  tileset_add: ['tileset_add'],
  tileset_remove: ['tileset_remove'],
  tileset_list: ['tileset_list'],
  tileset_style: ['tileset_style'],
  // ── Terrain (3) ──
  terrain_set: ['terrain_set'],
  terrain_get: ['terrain_get'],
  terrain_remove: ['terrain_remove'],
  // ── Codegen (1)：非命令通道工具；命令通道误收同名命令时由 stub 拒绝（纵深防御） ──
  cesium_execute_code: ['cesium_execute_code']
} as const satisfies Record<string, readonly EnabledTool[]>

/** 执行器命令类型（TOOL_EXECUTORS 全键 Record 守卫的键域，29 个） */
export type ExecutorCommandType = keyof typeof COMMAND_TYPE_TO_TOOL_NAMES

/** 全部工具的 Set 形式（运行时查找用） */
const ALL_SET: ReadonlySet<string> = new Set(ALL_EXECUTABLE_TOOLS)

/**
 * 类型守卫：判断任意字符串是否为已知可启用工具（白名单全集 46 项，
 * 含 server 契约工具；注意命令类型 entity_add/globe_lighting 不是工具名，判 false）
 * @param name - 工具名
 */
export function isEnabledTool(name: unknown): name is EnabledTool {
  return typeof name === 'string' && ALL_SET.has(name)
}

/**
 * 类型守卫：判断任意字符串是否为执行器命令类型（命令通道可分发的 29 键；
 * 注意契约工具名 entity_add_point/globe_set_lighting 不是命令类型，判 false）
 * @param name - 命令通道下发的 command.type
 */
export function isExecutorCommandType(name: unknown): name is ExecutorCommandType {
  return typeof name === 'string' && name in COMMAND_TYPE_TO_TOOL_NAMES
}

/**
 * 解析启用的工具白名单
 * @description 缺省（undefined/null/空数组/非数组）= 全量启用（46 项，含 codegen——
 * 生产 manifest.json 以显式清单为准，显式清单不含 cesium_execute_code 即默认关闭）；
 * 显式数组时过滤掉未知工具名（告警），只保留契约内的工具名。
 * @param configured - manifest config 的 enabledTools 值
 * @returns 实际启用的工具名列表
 */
export function resolveEnabledTools(configured?: unknown): EnabledTool[] {
  if (!Array.isArray(configured) || configured.length === 0) {
    return [...ALL_EXECUTABLE_TOOLS]
  }
  const resolved: EnabledTool[] = []
  for (const name of configured) {
    if (isEnabledTool(name)) {
      resolved.push(name)
    } else {
      console.warn('[EnabledTools] unknown tool ignored:', name)
    }
  }
  return resolved
}
