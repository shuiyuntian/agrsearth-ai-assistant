<!--
文件作用：CodeBlock Vue 组件（只读代码展示：等宽字体 + 行号 + el-scrollbar + 折叠展开）
作者：JasonLee （shuiyuntian@foxmail.com）
创建日期：2026-07-22
版本：1.0.0
修改记录：
  - 1.0.0 (2026-07-22) P3-B：codegen 审批卡/工具卡共用代码展示。
                      默认展开前 maxCollapsedLines 行，超出给「展开全部 N 行」开关。

版权所有 (C) 2026 AGRSEarth 项目
-->
<template>
  <div class="code-block rounded">
    <el-scrollbar :max-height="maxHeight">
      <div class="code-lines">
        <div v-for="(line, i) in displayLines" :key="i" class="code-line">
          <span class="lineno">{{ i + 1 }}</span>
          <span class="code-text" v-text="line === '' ? ' ' : line"></span>
        </div>
      </div>
    </el-scrollbar>
    <div
      v-if="lines.length > maxCollapsedLines"
      class="code-toggle"
      @click="expanded = !expanded"
    >
      {{ expanded ? '收起 ▲' : `展开全部 ${lines.length} 行 ▼` }}
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'

/**
 * 组件 Props
 * @property {string} code - 代码全文
 * @property {number} maxCollapsedLines - 折叠态默认展示行数（默认 20）
 * @property {string} maxHeight - el-scrollbar 最大高度（默认 260px）
 */
const props = withDefaults(defineProps<{
  code: string
  maxCollapsedLines?: number
  maxHeight?: string
}>(), {
  maxCollapsedLines: 20,
  maxHeight: '260px'
})

/** 折叠/展开状态（默认折叠 = 只展示前 maxCollapsedLines 行） */
const expanded = ref(false)

/** 代码按行切分 */
const lines = computed(() => (props.code || '').split('\n'))

/** 当前展示的行 */
const displayLines = computed(() =>
  expanded.value ? lines.value : lines.value.slice(0, props.maxCollapsedLines)
)
</script>
<!-- 组件样式统一收拢于 src/panel-inject.css（远程加载链下 scoped CSS 不进宿主资产，activate 时运行时注入） -->
