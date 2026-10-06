<!--
文件作用：风场球端面板（开关/图例/数据时间戳/统计概览；深色 token 遵循 docs/L10-UI规范.md B.2）
作者：JasonLee（shuiyuntian@foxmail.com）
创建日期：2026-10-06
版本：1.0.0
修改记录：
  - 1.0.0 (2026-10-06) 风场插件初始版本（数据源为包内样例数据；图层开关经控制器回收入口 index.ts）

版权所有 (C) 2026 CesiumAI 项目
-->
<template>
  <div class="h-full flex flex-col bg-gray-900/95 text-gray-300 text-sm">
    <!-- 图层开关 -->
    <div class="flex items-center justify-between px-4 py-3 border-b border-gray-700 shrink-0">
      <span class="text-white">风场图层</span>
      <el-switch
        :model-value="controller.layerVisible"
        :loading="controller.busy"
        @change="controller.toggleLayer"
      />
    </div>

    <!-- 数据信息 -->
    <div class="px-4 py-3 border-b border-gray-700 shrink-0 space-y-1.5">
      <div class="flex justify-between">
        <span class="text-gray-500">数据时间</span>
        <span class="text-gray-200">{{ controller.validTimeLabel }}</span>
      </div>
      <div class="flex justify-between">
        <span class="text-gray-500">网格</span>
        <span>{{ controller.gridLabel }}</span>
      </div>
      <div class="flex justify-between">
        <span class="text-gray-500">范围</span>
        <span>{{ controller.boundsLabel }}</span>
      </div>
    </div>

    <!-- 统计 -->
    <div class="px-4 py-3 border-b border-gray-700 shrink-0 space-y-1.5">
      <div class="flex justify-between">
        <span class="text-gray-500">最大风速</span>
        <span class="text-red-400 font-medium">{{ controller.stats?.maxSpeed ?? '-' }} m/s</span>
      </div>
      <div class="flex justify-between">
        <span class="text-gray-500">平均风速</span>
        <span>{{ controller.stats?.avgSpeed ?? '-' }} m/s</span>
      </div>
      <div class="flex justify-between">
        <span class="text-gray-500">最小风速</span>
        <span class="text-green-400">{{ controller.stats?.minSpeed ?? '-' }} m/s</span>
      </div>
      <div class="flex justify-between">
        <span class="text-gray-500">格点数</span>
        <span>{{ controller.stats?.pointCount ?? '-' }}</span>
      </div>
    </div>

    <!-- 图例 -->
    <div class="px-4 py-3 flex-1 min-h-0">
      <div class="text-gray-500 mb-2">风速图例（m/s）</div>
      <div
        class="h-3 rounded"
        style="background: linear-gradient(to right, hsl(137,85%,55%), hsl(103,85%,55%), hsl(69,85%,55%), hsl(34,85%,55%), hsl(0,85%,55%))"
      ></div>
      <div class="flex justify-between mt-1 text-xs text-gray-500">
        <span>0</span>
        <span>{{ legendMid }} </span>
        <span>{{ legendMax }}</span>
      </div>
      <div class="mt-4 text-xs text-gray-500 leading-5">
        箭头指向为风向（东/北分量为 u/v），圆点为网格观测点；颜色越红风速越大。
      </div>
    </div>

    <!-- 底部来源 -->
    <div class="px-4 py-2 border-t border-gray-700 text-xs text-gray-500 shrink-0">
      {{ controller.sourceLabel }}
    </div>
  </div>
</template>

<script setup lang="ts">
/**
 * 文件作用：风场球端面板逻辑（展示控制器状态；图层开关/时间戳/图例为纯展示，交互回收入口）
 * 作者：JasonLee <shuiyuntian@foxmail.com>
 * 创建日期：2026-10-06
 * 版本：1.0.0
 * 修改记录：
 *   - 1.0.0 (2026-10-06) 风场插件初始版本
 *
 * 版权所有 (C) 2026 CesiumAI 项目
 */
import { computed } from 'vue'
import type { WindFieldController } from './controller'

const props = defineProps<{
  controller: WindFieldController
}>()

const controller = props.controller

const legendMax = computed(() => controller.legendMax.toFixed(0))
const legendMid = computed(() => (controller.legendMax / 2).toFixed(0))
</script>
