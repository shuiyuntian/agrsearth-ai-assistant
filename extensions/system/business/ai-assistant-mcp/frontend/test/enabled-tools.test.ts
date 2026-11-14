/**
 * 文件作用：enabled-tools.test 模块
 * 作者：JasonLee <shuiyuntian@foxmail.com>
 * 创建日期：2026-07-23
 * 版本：1.0.0
 * 修改记录：
 *   - 1.0.0 (2026-07-23) 初始创建
 *
 * 版权所有 (C) 2026 AGRSEarth 项目
 */

/**
 * enabled-tools（可执行工具白名单解析）单元测试
 * @description 覆盖：全集 = 契约 45 工具名 + codegen（46 项）并与 contracts/tool-contracts.json
 * 全量对账（契约变更立即变红）；browser/server 分层与契约 side 字段对账；
 * resolveCommandType 归一（对齐 orchestrator）；COMMAND_TYPE_TO_TOOL_NAMES 族表与
 * BROWSER_CONTRACT_TOOLS 对账；缺省/显式清单解析；isEnabledTool / isExecutorCommandType 守卫。
 */

import { afterEach, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import {
  ALL_EXECUTABLE_TOOLS,
  BROWSER_CONTRACT_TOOLS,
  SERVER_CONTRACT_TOOLS,
  COMMAND_TYPE_TO_TOOL_NAMES,
  isEnabledTool,
  isExecutorCommandType,
  resolveCommandType,
  resolveEnabledTools
} from '../src/executors/enabled-tools'

/** 契约文件（extensions/system/business/ai-assistant-mcp/contracts/tool-contracts.json）为工具事实源 */
const contracts = JSON.parse(
  readFileSync(fileURLToPath(new URL('../../contracts/tool-contracts.json', import.meta.url)), 'utf8')
) as { toolCount: number; tools: Array<{ name: string; side: string }> }

afterEach(() => {
  vi.restoreAllMocks()
})

describe('ALL_EXECUTABLE_TOOLS 全集（契约对账）', () => {
  it('全集 = 契约 45 个 MCP 工具名 + cesium_execute_code（共 46 项）', () => {
    expect(ALL_EXECUTABLE_TOOLS).toHaveLength(46)
    expect(ALL_EXECUTABLE_TOOLS).toContain('cesium_execute_code')
    // 各分组抽查（含 server 契约工具：白名单语义按契约全集含它们）
    expect(ALL_EXECUTABLE_TOOLS).toContain('camera_fly_to')
    expect(ALL_EXECUTABLE_TOOLS).toContain('entity_add_point')
    expect(ALL_EXECUTABLE_TOOLS).toContain('globe_set_lighting')
    expect(ALL_EXECUTABLE_TOOLS).toContain('geolocation_geocode')
    expect(ALL_EXECUTABLE_TOOLS).toContain('cesium_list_domains')
  })

  it('全集无重复项', () => {
    expect(new Set(ALL_EXECUTABLE_TOOLS).size).toBe(ALL_EXECUTABLE_TOOLS.length)
  })

  it('与 contracts/tool-contracts.json 全量一致（契约变更时本测试应变红）', () => {
    const contractNames = contracts.tools.map((t) => t.name).sort()
    expect([...ALL_EXECUTABLE_TOOLS].sort()).toEqual(contractNames)
    expect(contracts.toolCount).toBe(ALL_EXECUTABLE_TOOLS.length)
  })

  it('browser/server 分层与契约 side 字段一致', () => {
    const contractBrowser = contracts.tools
      .filter((t) => t.side === 'browser' && t.name !== 'cesium_execute_code')
      .map((t) => t.name)
      .sort()
    const contractServer = contracts.tools
      .filter((t) => t.side === 'server')
      .map((t) => t.name)
      .sort()
    expect([...BROWSER_CONTRACT_TOOLS].sort()).toEqual(contractBrowser)
    expect([...SERVER_CONTRACT_TOOLS].sort()).toEqual(contractServer)
    expect(BROWSER_CONTRACT_TOOLS).toHaveLength(39)
    expect(SERVER_CONTRACT_TOOLS).toHaveLength(6)
  })
})

describe('resolveCommandType（与 orchestrator command-router 对齐）', () => {
  it('entity_add_* 12 个工具统一归一为 entity_add', () => {
    const entityAddTools = BROWSER_CONTRACT_TOOLS.filter((t) => t.startsWith('entity_add_'))
    expect(entityAddTools).toHaveLength(12)
    for (const t of entityAddTools) {
      expect(resolveCommandType(t)).toBe('entity_add')
    }
  })

  it('globe_set_lighting 归一为 globe_lighting', () => {
    expect(resolveCommandType('globe_set_lighting')).toBe('globe_lighting')
  })

  it('其余 browser 工具 toolName === commandType（恒等）', () => {
    for (const t of BROWSER_CONTRACT_TOOLS) {
      if (t.startsWith('entity_add_') || t === 'globe_set_lighting') continue
      expect(resolveCommandType(t)).toBe(t)
    }
  })
})

describe('COMMAND_TYPE_TO_TOOL_NAMES（命令类型 → 契约工具名族）', () => {
  it('29 键 = 28 个命令通道类型 + cesium_execute_code', () => {
    expect(Object.keys(COMMAND_TYPE_TO_TOOL_NAMES)).toHaveLength(29)
    expect(COMMAND_TYPE_TO_TOOL_NAMES).toHaveProperty('entity_add')
    expect(COMMAND_TYPE_TO_TOOL_NAMES).toHaveProperty('globe_lighting')
    expect(COMMAND_TYPE_TO_TOOL_NAMES).toHaveProperty('cesium_execute_code')
  })

  it('族全集 = BROWSER_CONTRACT_TOOLS ∪ {cesium_execute_code}（无遗漏无多余）', () => {
    const flattened = Object.values(COMMAND_TYPE_TO_TOOL_NAMES).flat().sort()
    expect(flattened).toEqual([...BROWSER_CONTRACT_TOOLS, 'cesium_execute_code'].sort())
  })

  it('每个 browser 工具名归一后落在对应族内（resolveCommandType 与族表互洽）', () => {
    for (const t of [...BROWSER_CONTRACT_TOOLS, 'cesium_execute_code'] as const) {
      const cmdType = resolveCommandType(t)
      const family = (COMMAND_TYPE_TO_TOOL_NAMES as Record<string, readonly string[]>)[cmdType]
      expect(family, `${t} -> ${cmdType}`).toBeDefined()
      expect(family).toContain(t)
    }
  })

  it('entity_add 族恰含 12 个 entity_add_* 工具，globe_lighting 族恰含 globe_set_lighting', () => {
    expect(COMMAND_TYPE_TO_TOOL_NAMES.entity_add).toHaveLength(12)
    expect([...COMMAND_TYPE_TO_TOOL_NAMES.globe_lighting]).toEqual(['globe_set_lighting'])
  })
})

describe('resolveEnabledTools — 缺省即全量', () => {
  it('undefined → 全量启用（与全集等长同序）', () => {
    expect(resolveEnabledTools(undefined)).toEqual([...ALL_EXECUTABLE_TOOLS])
  })

  it('null → 全量启用', () => {
    expect(resolveEnabledTools(null)).toEqual([...ALL_EXECUTABLE_TOOLS])
  })

  it('空数组 [] → 全量启用', () => {
    expect(resolveEnabledTools([])).toEqual([...ALL_EXECUTABLE_TOOLS])
  })

  it('非数组（字符串/对象）→ 全量启用', () => {
    expect(resolveEnabledTools('camera_fly_to')).toEqual([...ALL_EXECUTABLE_TOOLS])
    expect(resolveEnabledTools({ tools: [] })).toEqual([...ALL_EXECUTABLE_TOOLS])
  })
})

describe('resolveEnabledTools — 显式清单', () => {
  it('显式子集 → 精确返回且保持清单顺序', () => {
    const resolved = resolveEnabledTools(['entity_add_point', 'camera_fly_to', 'terrain_get'])
    expect(resolved).toEqual(['entity_add_point', 'camera_fly_to', 'terrain_get'])
  })

  it('server 契约工具（geolocation/discovery）可被显式清单启用（白名单语义含它们）', () => {
    const resolved = resolveEnabledTools(['geolocation_geocode', 'cesium_list_domains'])
    expect(resolved).toEqual(['geolocation_geocode', 'cesium_list_domains'])
  })

  it('未知名被过滤并 console.warn 告警（命令类型 entity_add 不是工具名，同样过滤）', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const resolved = resolveEnabledTools(['camera_fly_to', 'delete_everything', 'entity_add'])
    expect(resolved).toEqual(['camera_fly_to'])
    expect(warnSpy).toHaveBeenCalledTimes(2)
    expect(warnSpy).toHaveBeenCalledWith('[EnabledTools] unknown tool ignored:', 'delete_everything')
    expect(warnSpy).toHaveBeenCalledWith('[EnabledTools] unknown tool ignored:', 'entity_add')
  })

  it('cesium_execute_code 不在显式清单则不含（默认关闭），显式列出可启用', () => {
    const without = resolveEnabledTools(['camera_fly_to'])
    expect(without).not.toContain('cesium_execute_code')

    const withCodegen = resolveEnabledTools(['camera_fly_to', 'cesium_execute_code'])
    expect(withCodegen).toContain('cesium_execute_code')
  })

  it('非字符串项（数字/null/对象）视为未知名过滤', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const resolved = resolveEnabledTools(['camera_fly_to', 42, null, { name: 'x' }])
    expect(resolved).toEqual(['camera_fly_to'])
    expect(warnSpy).toHaveBeenCalledTimes(3)
  })
})

describe('isEnabledTool 类型守卫（白名单全集 46 项）', () => {
  it('已知工具名 → true（含 server 契约工具与 codegen）', () => {
    expect(isEnabledTool('camera_fly_to')).toBe(true)
    expect(isEnabledTool('entity_add_point')).toBe(true)
    expect(isEnabledTool('geolocation_route')).toBe(true)
    expect(isEnabledTool('cesium_list_domains')).toBe(true)
    expect(isEnabledTool('cesium_execute_code')).toBe(true)
  })

  it('命令类型/未知工具名/非字符串 → false', () => {
    // 命令类型不是工具名（白名单语义为契约工具名）
    expect(isEnabledTool('entity_add')).toBe(false)
    expect(isEnabledTool('globe_lighting')).toBe(false)
    expect(isEnabledTool('delete_everything')).toBe(false)
    expect(isEnabledTool('')).toBe(false)
    expect(isEnabledTool(undefined)).toBe(false)
    expect(isEnabledTool(123)).toBe(false)
  })
})

describe('isExecutorCommandType 类型守卫（执行器 29 键）', () => {
  it('命令通道类型 → true', () => {
    expect(isExecutorCommandType('camera_fly_to')).toBe(true)
    expect(isExecutorCommandType('entity_add')).toBe(true)
    expect(isExecutorCommandType('globe_lighting')).toBe(true)
    expect(isExecutorCommandType('cesium_execute_code')).toBe(true)
  })

  it('契约工具名/server 工具/未知名/非字符串 → false', () => {
    // 工具名不是命令类型（entity_add_point 归一后才是 entity_add）
    expect(isExecutorCommandType('entity_add_point')).toBe(false)
    expect(isExecutorCommandType('globe_set_lighting')).toBe(false)
    // server 契约工具不经命令通道
    expect(isExecutorCommandType('geolocation_geocode')).toBe(false)
    expect(isExecutorCommandType('cesium_list_domains')).toBe(false)
    expect(isExecutorCommandType('delete_everything')).toBe(false)
    expect(isExecutorCommandType(123)).toBe(false)
  })
})
