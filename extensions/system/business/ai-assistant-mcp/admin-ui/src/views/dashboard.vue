<!--
文件作用：dashboard Vue 组件
作者：JasonLee （shuiyuntian@foxmail.com）
创建日期：2026-08-09
版本：1.0.0
修改记录：
  - 1.0.0 (2026-08-09) 初始创建

版权所有 (C) 2026 AGRSEarth 项目
-->

<template>
  <div class="app-container">
    <!-- 时间范围 -->
    <el-form :inline="true">
      <el-form-item label="时间范围">
        <el-date-picker
          v-model="dateRange"
          type="daterange"
          range-separator="至"
          start-placeholder="开始日期"
          end-placeholder="结束日期"
          value-format="YYYY-MM-DD HH:mm:ss"
          :default-time="[new Date(2000, 0, 1, 0, 0, 0), new Date(2000, 0, 1, 23, 59, 59)]"
          style="width: 340px"
        />
      </el-form-item>
      <el-form-item>
        <el-button type="primary" icon="Search" @click="handleQuery">查询</el-button>
        <el-button icon="Refresh" @click="handleRefresh">刷新</el-button>
      </el-form-item>
    </el-form>

    <!-- 统计卡片 -->
    <el-row :gutter="16" class="stat-row">
      <el-col :span="6">
        <el-card shadow="hover" class="stat-card">
          <div class="stat-label">请求量</div>
          <div class="stat-value">{{ summary.requests }}</div>
        </el-card>
      </el-col>
      <el-col :span="6">
        <el-card shadow="hover" class="stat-card">
          <div class="stat-label">会话数</div>
          <div class="stat-value">{{ summary.sessions }}</div>
        </el-card>
      </el-col>
      <el-col :span="6">
        <el-card shadow="hover" class="stat-card">
          <div class="stat-label">活跃用户</div>
          <div class="stat-value">{{ summary.activeUsers }}</div>
        </el-card>
      </el-col>
      <el-col :span="6">
        <el-card shadow="hover" class="stat-card">
          <div class="stat-label">Token 总量</div>
          <div class="stat-value">{{ totalTokens }}</div>
          <div class="stat-sub">prompt {{ summary.promptTokens }} + completion {{ summary.completionTokens }}</div>
        </el-card>
      </el-col>
    </el-row>

    <!-- 图表区 -->
    <el-row :gutter="16">
      <el-col :span="10">
        <el-card shadow="never" class="chart-card">
          <template #header>请求量与 Token 消耗趋势</template>
          <div ref="trendChartRef" class="chart" />
          <div class="chart-note">暂无时序接口，展示当前区间汇总值</div>
        </el-card>
      </el-col>
      <el-col :span="8">
        <el-card shadow="never" class="chart-card">
          <template #header>工具调用 TOP{{ topN }}</template>
          <div ref="toolsChartRef" class="chart" />
        </el-card>
      </el-col>
      <el-col :span="6">
        <el-card shadow="never" class="chart-card">
          <template #header>审批通过率 / 错误率</template>
          <div ref="rateChartRef" class="chart" />
          <div class="chart-note">
            平均耗时 {{ fmtMs(summary.avgDurationMs) }}，P95 {{ fmtMs(summary.p95DurationMs) }}
          </div>
        </el-card>
      </el-col>
    </el-row>

    <!-- 最近操作日志 -->
    <el-card shadow="never" class="log-card">
      <template #header>最近操作日志</template>
      <el-table v-loading="logsLoading" :data="logList" style="width: 100%">
        <el-table-column label="时间" prop="createdAt" width="160" :show-overflow-tooltip="true" />
        <el-table-column label="类型" align="center" width="90">
          <template #default="scope">
            <el-tag size="small" :type="kindTagType(scope.row.kind)">{{ scope.row.kind }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="用户" prop="username" width="110" :show-overflow-tooltip="true" />
        <el-table-column label="工具" width="200" :show-overflow-tooltip="true">
          <template #default="scope">
            <span>{{ scope.row.toolName || '-' }}</span>
          </template>
        </el-table-column>
        <el-table-column label="风险等级" align="center" width="90">
          <template #default="scope">
            <el-tag v-if="scope.row.riskLevel" size="small" :type="riskTagType(scope.row.riskLevel)">{{ scope.row.riskLevel }}</el-tag>
            <span v-else>-</span>
          </template>
        </el-table-column>
        <el-table-column label="结果" align="center" width="90">
          <template #default="scope">
            <el-tag v-if="scope.row.outcome" size="small" :type="outcomeTagType(scope.row.outcome)">{{ scope.row.outcome }}</el-tag>
            <span v-else>-</span>
          </template>
        </el-table-column>
        <el-table-column label="参数摘要" prop="argsSummary" min-width="220" :show-overflow-tooltip="true">
          <template #default="scope">
            <el-tooltip :content="scope.row.argsSummary || ''" placement="top" :disabled="!scope.row.argsSummary">
              <span class="args-cell">{{ scope.row.argsSummary || '-' }}</span>
            </el-tooltip>
          </template>
        </el-table-column>
        <el-table-column label="耗时(ms)" prop="durationMs" align="right" width="90" />
        <el-table-column label="Token" align="right" width="110">
          <template #default="scope">
            <span v-if="scope.row.promptTokens != null || scope.row.completionTokens != null">
              {{ (scope.row.promptTokens || 0) + (scope.row.completionTokens || 0) }}
            </span>
            <span v-else>-</span>
          </template>
        </el-table-column>
      </el-table>
      <pagination
        v-show="logTotal > 0"
        :total="logTotal"
        v-model:page="logQuery.pageNum"
        v-model:limit="logQuery.pageSize"
        @pagination="getLogs"
      />
    </el-card>
  </div>
</template>

<script setup lang="ts" name="AiAssistantDashboard">
import * as echarts from 'echarts'
import 'echarts/theme/macarons'
import { listLogs, getStatsSummary, getStatsTools, type AiLogItem, type AiStatsSummary, type AiToolStat, type TimeRangeParams } from '@/api/aiassistant/stats'

const end = new Date()
const begin = new Date()
begin.setTime(begin.getTime() - 3600 * 1000 * 24 * 7)

const dateRange = ref<string[]>([formatDate(begin), formatDate(end)])
const topN = ref<number>(10)
const summary = reactive<AiStatsSummary>({
  requests: 0,
  sessions: 0,
  activeUsers: 0,
  promptTokens: 0,
  completionTokens: 0,
  approvalRate: 0,
  errorRate: 0,
  avgDurationMs: 0,
  p95DurationMs: 0
})
const toolStats = ref<AiToolStat[]>([])
const logsLoading = ref<boolean>(false)
const logList = ref<AiLogItem[]>([])
const logTotal = ref<number>(0)
const logQuery = reactive({
  pageNum: 1,
  pageSize: 10
})

const trendChartRef = ref<HTMLElement>()
const toolsChartRef = ref<HTMLElement>()
const rateChartRef = ref<HTMLElement>()
let trendChart: echarts.ECharts | null = null
let toolsChart: echarts.ECharts | null = null
let rateChart: echarts.ECharts | null = null

const totalTokens = computed(() => (summary.promptTokens || 0) + (summary.completionTokens || 0))

function formatDate(date: Date): string {
  const pad = (n: number) => (n < 10 ? '0' + n : '' + n)
  return date.getFullYear() + '-' + pad(date.getMonth() + 1) + '-' + pad(date.getDate()) + ' ' +
    pad(date.getHours()) + ':' + pad(date.getMinutes()) + ':' + pad(date.getSeconds())
}

/** 耗时展示：null 显示 -，小数取整 */
function fmtMs(val?: number | null): string {
  if (val == null) return '-'
  return Math.round(Number(val)) + ' ms'
}

function rangeParams(): TimeRangeParams {
  const params: TimeRangeParams = {}
  if (dateRange.value && dateRange.value.length === 2) {
    params.beginTime = dateRange.value[0]
    params.endTime = dateRange.value[1]
  }
  return params
}

/** 查询按钮操作 */
function handleQuery() {
  logQuery.pageNum = 1
  getSummary()
  getToolStats()
  getLogs()
}

/** 刷新按钮操作 */
function handleRefresh() {
  handleQuery()
}

/** 查询汇总统计 */
function getSummary() {
  getStatsSummary(rangeParams()).then(response => {
    Object.assign(summary, response.data || {})
    renderTrendChart()
    renderRateChart()
  })
}

/** 查询工具调用 TOPN */
function getToolStats() {
  getStatsTools(topN.value).then(response => {
    toolStats.value = response.data || []
    renderToolsChart()
  })
}

/** 查询操作日志 */
function getLogs() {
  logsLoading.value = true
  listLogs(Object.assign({}, logQuery, rangeParams())).then(response => {
    logList.value = response.rows || []
    logTotal.value = response.total || 0
    logsLoading.value = false
  }).catch(() => {
    logsLoading.value = false
  })
}

/** 初始化图表 */
function initCharts() {
  trendChart = echarts.init(trendChartRef.value!, 'macarons')
  toolsChart = echarts.init(toolsChartRef.value!, 'macarons')
  rateChart = echarts.init(rateChartRef.value!, 'macarons')
}

/** 窗口缩放时重绘 */
function resizeCharts() {
  trendChart?.resize()
  toolsChart?.resize()
  rateChart?.resize()
}

/** ① 请求量与 token 消耗双轴趋势（暂无时序接口，展示当前区间汇总值占位） */
function renderTrendChart() {
  if (!trendChart) return
  trendChart.setOption({
    tooltip: { trigger: 'axis' },
    legend: { data: ['请求量', 'Token 消耗'], bottom: 0 },
    grid: { left: 10, right: 10, top: 30, bottom: 40, containLabel: true },
    xAxis: { type: 'category', data: ['当前区间'] },
    yAxis: [
      { type: 'value', name: '请求量' },
      { type: 'value', name: 'Token' }
    ],
    series: [
      {
        name: '请求量',
        type: 'line',
        smooth: true,
        areaStyle: { opacity: 0.15 },
        data: [summary.requests || 0]
      },
      {
        name: 'Token 消耗',
        type: 'line',
        smooth: true,
        yAxisIndex: 1,
        areaStyle: { opacity: 0.15 },
        data: [totalTokens.value]
      }
    ]
  })
}

/** ② 工具调用 TOPN 横向柱状图 */
function renderToolsChart() {
  if (!toolsChart) return
  const rows = toolStats.value.slice(0, topN.value)
  toolsChart.setOption({
    tooltip: {
      trigger: 'axis',
      axisPointer: { type: 'shadow' },
      formatter: (params: any) => {
        const p = params[0]
        const row = rows[p.dataIndex] || {}
        const rate = row.successRate != null ? (row.successRate * 100).toFixed(1) + '%' : '-'
        return p.name + '<br/>调用 ' + p.value + ' 次<br/>成功率 ' + rate + '<br/>平均耗时 ' + (row.avgDurationMs != null ? row.avgDurationMs + ' ms' : '-')
      }
    },
    grid: { left: 10, right: 30, top: 10, bottom: 10, containLabel: true },
    xAxis: { type: 'value' },
    yAxis: {
      type: 'category',
      inverse: true,
      data: rows.map(r => r.toolName),
      axisLabel: {
        formatter: (val: string) => (val.length > 22 ? val.slice(0, 22) + '…' : val)
      }
    },
    series: [{
      name: '调用次数',
      type: 'bar',
      barMaxWidth: 18,
      itemStyle: { color: '#3888fa' },
      data: rows.map(r => r.calls)
    }]
  })
}

/** ③ 审批通过率与错误率饼图 */
function renderRateChart() {
  if (!rateChart) return
  const approval = Number(summary.approvalRate || 0)
  const error = Number(summary.errorRate || 0)
  const normal = Math.max(0, 1 - approval - error)
  rateChart.setOption({
    tooltip: { trigger: 'item', formatter: '{b}: {d}%' },
    legend: { bottom: 0 },
    series: [{
      type: 'pie',
      radius: ['40%', '65%'],
      center: ['50%', '45%'],
      label: { formatter: '{b}\n{d}%' },
      data: [
        { name: '审批通过', value: +(approval * 100).toFixed(2), itemStyle: { color: '#67c23a' } },
        { name: '错误', value: +(error * 100).toFixed(2), itemStyle: { color: '#f56c6c' } },
        { name: '其他', value: +(normal * 100).toFixed(2), itemStyle: { color: '#c0c4cc' } }
      ]
    }]
  })
}

function kindTagType(kind?: string) {
  const map: Record<string, string> = { tool: 'primary', llm: 'success', approval: 'warning' }
  return (map[kind || ''] || 'info') as 'primary' | 'success' | 'warning' | 'info'
}

function riskTagType(riskLevel?: string) {
  const map: Record<string, string> = { read: 'success', write: 'warning', destructive: 'danger' }
  return (map[riskLevel || ''] || 'info') as 'success' | 'warning' | 'danger' | 'info'
}

function outcomeTagType(outcome?: string) {
  const val = (outcome || '').toLowerCase()
  if (val === 'success' || val === 'ok' || val === 'approved') return 'success'
  if (val === 'error' || val === 'failed' || val === 'denied' || val === 'rejected') return 'danger'
  return 'info'
}

onMounted(() => {
  initCharts()
  handleQuery()
  window.addEventListener('resize', resizeCharts)
})

onBeforeUnmount(() => {
  window.removeEventListener('resize', resizeCharts)
  trendChart?.dispose()
  toolsChart?.dispose()
  rateChart?.dispose()
  trendChart = null
  toolsChart = null
  rateChart = null
})
</script>

<style scoped>
.stat-row {
  margin-bottom: 16px;
}
.stat-card {
  text-align: center;
}
.stat-label {
  font-size: 13px;
  color: #909399;
  margin-bottom: 8px;
}
.stat-value {
  font-size: 28px;
  font-weight: 600;
  color: #303133;
}
.stat-sub {
  margin-top: 6px;
  font-size: 12px;
  color: #909399;
}
.chart-card {
  margin-bottom: 16px;
}
.chart {
  height: 320px;
  width: 100%;
}
.chart-note {
  text-align: center;
  font-size: 12px;
  color: #909399;
  padding-bottom: 8px;
}
.log-card {
  margin-bottom: 16px;
}
.args-cell {
  display: inline-block;
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  vertical-align: middle;
}
</style>
