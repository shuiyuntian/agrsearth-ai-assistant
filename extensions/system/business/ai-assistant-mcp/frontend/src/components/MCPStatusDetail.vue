<!--
文件作用：MCPStatusDetail Vue 组件（orchestrator / 命令通道连接状态详情）
作者：JasonLee （shuiyuntian@foxmail.com）
创建日期：2026-06-02
版本：2.1.0
修改记录：
  - 2.1.0 (2026-07-26) S2-A：启用工具白名单按域展示对齐契约 45 工具名——补 geolocation
                      域图标（🧭）与域排序（geolocation/cesium 入 domainOrder；discovery
                      3 个 server 工具按 cesium 前缀归域展示）。
  - 2.0.0 (2026-07-22) P1-B：MCP Gateway 状态面改为 ai-orchestrator 状态面：
                      展示 orchestrator 会话状态、命令通道（channel SSE）状态、会话 ID、
                      启用工具白名单（按域分组，只读）；移除 MCP 工具批量测试（工具执行已归
                      orchestrator 编排，前端不再直连工具）。
  - 1.0.0 (2026-07-12) 随 AI 助手插件迁移到 plugins/ai-assistant/components

版权所有 (C) 2026 AGRSEarth 项目
-->
<template>
  <div class="mcp-status-detail">
    <!-- 触发按钮 -->
    <div class="flex items-center gap-2 cursor-pointer" @click="toggleExpand">
      <el-tag :type="statusTagType" size="small" class="cursor-pointer">
        Orchestrator: {{ statusText }}
      </el-tag>
      <span v-if="enabledTools.length > 0" class="text-green-400 text-xs">{{ enabledTools.length }} tools</span>
      <el-icon class="text-gray-400 transition-transform" :class="{ 'rotate-180': expanded }">
        <ArrowDown />
      </el-icon>
    </div>

    <!-- 详情面板 -->
    <el-collapse-transition>
      <div v-show="expanded" class="detail-panel mt-2">
        <!-- 连接诊断信息 -->
        <div class="connection-info mb-2 p-2 rounded bg-gray-800/50 space-y-1">
          <div class="flex items-center justify-between">
            <span class="text-xs text-gray-400">Orchestrator</span>
            <span class="text-xs text-gray-300 font-mono truncate max-w-[200px]" :title="orchestratorUrl">{{ orchestratorUrl }}</span>
          </div>
          <div class="flex items-center justify-between">
            <span class="text-xs text-gray-400">会话状态</span>
            <div class="flex items-center gap-1">
              <span class="w-2 h-2 rounded-full" :class="httpStatusClass"></span>
              <span class="text-xs" :class="statusColorClass">{{ statusText }}</span>
            </div>
          </div>
          <div class="flex items-center justify-between">
            <span class="text-xs text-gray-400">命令通道</span>
            <div class="flex items-center gap-1">
              <span class="w-2 h-2 rounded-full" :class="channelStatusClass"></span>
              <span class="text-xs" :class="channelStatusColor">{{ channelStatusText }}</span>
            </div>
          </div>
          <div class="flex items-center justify-between">
            <span class="text-xs text-gray-400">启用工具</span>
            <span class="text-xs text-green-400 font-mono">{{ enabledTools.length }}</span>
          </div>
          <div v-if="sessionId" class="flex items-center justify-between">
            <span class="text-xs text-gray-400">会话 ID</span>
            <span class="text-xs text-gray-500 font-mono truncate max-w-[200px]" :title="sessionId">{{ sessionId }}</span>
          </div>
          <div v-if="error" class="mt-1 p-1.5 rounded bg-red-900/30 border border-red-800/50">
            <span class="text-xs text-red-400">{{ error }}</span>
          </div>
        </div>

        <!-- 按域分组的启用工具列表（只读） -->
        <div class="domains-list space-y-1.5 max-h-72 overflow-y-auto pr-1">
          <div
            v-for="domain in allDomains"
            :key="domain.name"
            class="domain-group rounded bg-gray-800/30 border border-gray-700/50"
          >
            <!-- 域标题 -->
            <div
              class="domain-header flex items-center justify-between p-1.5 cursor-pointer hover:bg-gray-700/30 rounded transition-colors"
              @click="toggleDomain(domain.name)"
            >
              <div class="flex items-center gap-1.5">
                <el-icon class="text-gray-500 text-xs transition-transform" :class="{ 'rotate-90': isDomainExpanded(domain.name) }">
                  <ArrowRight />
                </el-icon>
                <span class="text-xs font-medium text-gray-200">{{ domainIcon(domain.name) }} {{ domain.name }}</span>
                <el-tag size="small" type="info" class="text-xs">
                  {{ domain.tools.length }}
                </el-tag>
              </div>
            </div>

            <!-- 工具列表 -->
            <el-collapse-transition>
              <div v-show="isDomainExpanded(domain.name)" class="tool-list px-2 pb-1.5">
                <div
                  v-for="tool in domain.tools"
                  :key="tool"
                  class="tool-item flex items-center py-0.5 px-1.5 rounded hover:bg-gray-700/20 transition-colors"
                >
                  <el-icon class="text-xs flex-shrink-0 text-green-500 mr-1.5"><CircleCheck /></el-icon>
                  <span class="text-xs text-gray-300 truncate" :title="tool">{{ tool }}</span>
                </div>
              </div>
            </el-collapse-transition>
          </div>
        </div>

        <!-- 底部操作 -->
        <div class="flex justify-between items-center mt-2 pt-2 border-t border-gray-700/50">
          <span class="text-xs text-gray-500">
            启用 {{ allDomains.length }} 个 domain, {{ enabledTools.length }} 个工具
          </span>
          <el-button v-if="orchestratorStatus === 'error'" size="small" type="warning" @click="$emit('reconnect')">
            <el-icon class="mr-1"><Refresh /></el-icon>
            重连
          </el-button>
        </div>
      </div>
    </el-collapse-transition>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue'
import { ArrowDown, ArrowRight, CircleCheck, Refresh } from '@element-plus/icons-vue'

/**
 * 组件 Props 定义
 * @description 接收父组件传入的 orchestrator 会话状态、命令通道状态与启用工具白名单
 */
const props = defineProps<{
  /** orchestrator 会话状态 */
  orchestratorStatus: 'idle' | 'connecting' | 'connected' | 'error'
  /** 会话状态文本描述 */
  statusText: string
  /** orchestrator 错误信息 */
  error: string | null
  /** orchestrator 基础地址 */
  orchestratorUrl: string
  /** 启用工具白名单 */
  enabledTools: string[]
  /** 命令通道（channel SSE）连接状态 */
  channelStatus?: 'connected' | 'disconnected' | 'error'
  /** 服务端签发的会话 ID */
  sessionId?: string | null
}>()

/**
 * 组件 Emits 定义
 */
const emit = defineEmits<{
  /** 触发重连操作 */
  reconnect: []
}>()

/** 详情面板展开状态 */
const expanded = ref(false)
/** 已展开的域名称集合 */
const expandedDomains = ref<Set<string>>(new Set())

/**
 * 切换详情面板展开/收起状态
 */
const toggleExpand = () => {
  expanded.value = !expanded.value
}

/**
 * 切换指定域的展开/收起状态
 * @param name 域名称
 */
const toggleDomain = (name: string) => {
  if (expandedDomains.value.has(name)) {
    expandedDomains.value.delete(name)
  } else {
    expandedDomains.value.add(name)
  }
}

/**
 * 判断指定域是否处于展开状态
 * @param name 域名称
 * @returns 是否展开
 */
const isDomainExpanded = (name: string) => expandedDomains.value.has(name)

/**
 * 计算会话状态对应的 Tag 类型
 */
const statusTagType = computed(() => {
  switch (props.orchestratorStatus) {
    case 'connected': return 'success'
    case 'connecting': return 'warning'
    case 'error': return 'danger'
    default: return 'info'
  }
})

/**
 * 计算会话状态文本颜色类名
 */
const statusColorClass = computed(() => {
  switch (props.orchestratorStatus) {
    case 'connected': return 'text-green-400'
    case 'connecting': return 'text-yellow-400'
    case 'error': return 'text-red-400'
    default: return 'text-gray-400'
  }
})

/**
 * 计算会话状态指示点样式类名
 */
const httpStatusClass = computed(() => {
  switch (props.orchestratorStatus) {
    case 'connected': return 'bg-green-500'
    case 'connecting': return 'bg-yellow-500 animate-pulse'
    case 'error': return 'bg-red-500'
    default: return 'bg-gray-500'
  }
})

/**
 * 计算命令通道状态文本
 */
const channelStatusText = computed(() => {
  switch (props.channelStatus) {
    case 'connected': return '已连接'
    case 'error': return '断开'
    default: return '未连接'
  }
})

/**
 * 计算命令通道状态指示点样式类名
 */
const channelStatusClass = computed(() => {
  switch (props.channelStatus) {
    case 'connected': return 'bg-green-500'
    case 'error': return 'bg-red-500'
    default: return 'bg-gray-500'
  }
})

/**
 * 计算命令通道状态文本颜色类名
 */
const channelStatusColor = computed(() => {
  switch (props.channelStatus) {
    case 'connected': return 'text-green-400'
    case 'error': return 'text-red-400'
    default: return 'text-gray-400'
  }
})

/**
 * 获取域对应的图标映射
 * @param name 域名称
 * @returns 对应的 Emoji 图标字符串
 */
const domainIcon = (name: string): string => {
  const icons: Record<string, string> = {
    camera: '📷', entity: '📍', animation: '🎬',
    imagery: '🗺️', tileset: '🧱', terrain: '⛰️',
    clock: '⏱️', globe: '🌐', geolocation: '🧭'
  }
  return icons[name] || '🔧'
}

interface DomainGroup {
  name: string
  tools: string[]
}

/**
 * 按域分组的启用工具列表（按下划线前缀分组，按预设顺序排序）
 */
const allDomains = computed((): DomainGroup[] => {
  const groups = new Map<string, string[]>()
  for (const name of props.enabledTools) {
    const domain = name.split('_')[0] || 'unknown'
    if (!groups.has(domain)) groups.set(domain, [])
    groups.get(domain)!.push(name)
  }

  const domainOrder = ['camera', 'entity', 'animation', 'clock', 'globe', 'imagery', 'tileset', 'terrain', 'geolocation', 'cesium']
  const result: DomainGroup[] = []
  for (const name of domainOrder) {
    const tools = groups.get(name)
    if (tools?.length) {
      result.push({ name, tools })
      groups.delete(name)
    }
  }
  for (const [name, tools] of groups) {
    result.push({ name, tools })
  }
  return result
})
</script>
<!-- 组件样式统一收拢于 src/panel-inject.css（远程加载链下 scoped CSS 不进宿主资产，activate 时运行时注入） -->
