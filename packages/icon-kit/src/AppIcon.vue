<!--
文件作用：AppIcon Vue 组件
作者：JasonLee （shuiyuntian@foxmail.com）
创建日期：2026-08-08
版本：1.0.0
修改记录：
  - 1.0.0 (2026-08-08) 初始创建

版权所有 (C) 2026 AGRSEarth 项目
-->

<script lang="ts">
// 模块级共享缓存：URL → SVG 文本，避免多实例/重复渲染反复请求同一图标
const svgCache = new Map<string, string>()
// 进行中的请求去重：URL → Promise，避免同一 URL 并发重复 fetch
const pendingRequests = new Map<string, Promise<string>>()

function fetchSvg(url: string): Promise<string> {
  const cached = svgCache.get(url)
  if (cached !== undefined) return Promise.resolve(cached)
  const pending = pendingRequests.get(url)
  if (pending) return pending
  const req = fetch(url)
    .then((res) => {
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      return res.text()
    })
    .then((text) => {
      svgCache.set(url, text)
      return text
    })
    .finally(() => {
      pendingRequests.delete(url)
    })
  pendingRequests.set(url, req)
  return req
}
</script>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import * as Icons from '@element-plus/icons-vue'
import { resolveIconUrl } from './resolve'

/**
 * 统一图标渲染组件
 * - EP 图标名     → 渲染 @element-plus/icons-vue 对应组件（未命中回退 MoreFilled）
 * - iconlib:/calcite: → fetch SVG 文本内联渲染（缓存 + 失败回退 MoreFilled）
 */
const props = defineProps<{
  /** 图标引用：EP 图标名 / iconlib:<instanceId> / calcite:<name> */
  name: string
  /** 图标尺寸（数字按 px 处理），默认 1em（随字体大小） */
  size?: number | string
  /** 图标颜色，映射为容器 color（SVG fill: currentColor 继承） */
  color?: string
}>()

const MoreFilled = (Icons as any).MoreFilled

/** 远程引用解析出的 SVG URL；null 表示走 EP 本地组件 */
const iconUrl = computed(() => resolveIconUrl(props.name))

/** EP 图标组件查表（未命中回退 MoreFilled） */
const epComponent = computed(() => (Icons as any)[props.name || ''] || MoreFilled)

const svgText = ref<string | null>(null)
const loadFailed = ref(false)

watch(
  iconUrl,
  (url) => {
    svgText.value = null
    loadFailed.value = false
    if (!url) return
    fetchSvg(url)
      .then((text) => {
        svgText.value = text
      })
      .catch((err) => {
        console.warn(`[icon-kit] 图标加载失败: ${url}`, err)
        loadFailed.value = true
      })
  },
  { immediate: true }
)

const sizeCss = computed(() => {
  if (props.size === undefined || props.size === null) return '1em'
  return typeof props.size === 'number' ? `${props.size}px` : props.size
})

const containerStyle = computed(() => ({
  width: sizeCss.value,
  height: sizeCss.value,
  color: props.color
}))
</script>

<template>
  <span class="app-icon" :style="containerStyle">
    <!-- EP 本地图标组件 -->
    <component v-if="!iconUrl" :is="epComponent" />
    <!-- 远程 SVG 内联渲染 -->
    <span v-else-if="svgText" class="app-icon-svg" v-html="svgText"></span>
    <!-- 加载失败回退 -->
    <component v-else-if="loadFailed" :is="MoreFilled" />
    <!-- 加载中渲染空占位，避免布局跳动 -->
  </span>
</template>

<style scoped>
.app-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  line-height: 1;
}
.app-icon :deep(svg),
.app-icon-svg :deep(svg) {
  width: 100%;
  height: 100%;
  fill: currentColor;
}
</style>
