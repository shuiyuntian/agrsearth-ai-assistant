<!--
文件作用：config Vue 组件
作者：JasonLee （shuiyuntian@foxmail.com）
创建日期：2026-08-09
版本：1.0.0
修改记录：
  - 1.0.0 (2026-08-09) 初始创建

版权所有 (C) 2026 AGRSEarth 项目
-->

<template>
  <div class="app-container">
    <el-form :model="form" v-loading="loading" label-width="140px" style="max-width: 860px">
      <el-divider content-position="left">模型服务</el-divider>
      <el-form-item label="vLLM Base URL" prop="llmBaseUrl">
        <el-input v-model="form.llmBaseUrl" placeholder="如 http://vllm:8000/v1" clearable />
      </el-form-item>
      <el-form-item label="模型名" prop="llmModel">
        <el-input v-model="form.llmModel" placeholder="如 Qwen/Qwen2.5-72B-Instruct" clearable />
      </el-form-item>
      <el-form-item label="API Key 引用" prop="llmApiKeyRef">
        <el-input v-model="form.llmApiKeyRef" placeholder="密钥引用（已脱敏展示，留空表示不修改）" clearable />
      </el-form-item>

      <el-divider content-position="left">Agent 参数</el-divider>
      <el-form-item label="最大步数" prop="agentMaxSteps">
        <el-input-number v-model="form.agentMaxSteps" :min="1" :max="20" controls-position="right" />
        <span class="form-tip">单轮对话允许的最大工具调用步数（1-20）</span>
      </el-form-item>
      <el-form-item label="Temperature" prop="temperature">
        <el-slider v-model="form.temperature" :min="0" :max="2" :step="0.1" show-input style="max-width: 520px" />
      </el-form-item>
      <el-form-item label="Max Tokens" prop="maxTokens">
        <el-input-number v-model="form.maxTokens" :min="1" :step="256" controls-position="right" />
      </el-form-item>
      <el-form-item label="限流（次/分）" prop="rateLimitRpm">
        <el-input-number v-model="form.rateLimitRpm" :min="1" :max="1000" controls-position="right" />
        <span class="form-tip">单用户每分钟请求上限（1-1000）</span>
      </el-form-item>
      <el-form-item label="代码生成" prop="codegenEnabled">
        <el-switch v-model="form.codegenEnabled" disabled />
        <el-tag size="small" type="info" style="margin-left: 8px">P3 上线，暂为禁用态</el-tag>
      </el-form-item>

      <el-divider content-position="left">工具白名单</el-divider>
      <el-form-item label="启用工具">
        <div class="tools-toolbar">
          <el-button link type="primary" @click="checkAllTools">全选</el-button>
          <el-button link type="primary" @click="uncheckAllTools">清空</el-button>
          <span class="form-tip">已选 {{ form.enabledTools.length }} / {{ toolCatalog.length }} 个工具</span>
          <el-tag v-if="enabledToolsDefaultAll && !toolsDirty" size="small" type="info">默认全量（未改动则不提交）</el-tag>
        </div>
        <div v-for="group in toolGroups" :key="group.domain" class="tool-group">
          <div class="tool-group-title">
            <el-checkbox
              :indeterminate="group.indeterminate"
              :model-value="group.allChecked"
              @change="(val: string | number | boolean) => toggleDomain(group.domain, val)"
            >
              <b>{{ group.label }}</b><span class="form-tip">（{{ group.domain }}，{{ group.tools.length }} 个）</span>
            </el-checkbox>
          </div>
          <el-checkbox-group v-model="form.enabledTools">
            <el-checkbox v-for="tool in group.tools" :key="tool.name" :value="tool.name" class="tool-checkbox">
              {{ tool.name }}
              <el-tag v-if="tool.riskLevel === 'destructive'" size="small" type="danger">destructive</el-tag>
              <el-tag v-else-if="tool.riskLevel === 'write'" size="small" type="warning">write</el-tag>
              <el-tag v-else size="small" type="success">read</el-tag>
              <el-tooltip :content="tool.description" placement="top" :show-after="300">
                <el-icon class="tool-help"><QuestionFilled /></el-icon>
              </el-tooltip>
            </el-checkbox>
          </el-checkbox-group>
        </div>
      </el-form-item>

      <el-divider content-position="left">审批策略</el-divider>
      <el-form-item label="高危工具">
        <el-tag v-for="name in destructiveTools" :key="name" size="small" type="danger" class="destructive-tag">{{ name }}</el-tag>
        <div class="form-tip">以上 remove 类工具执行前需人工审批，由契约层管理，此处只读展示</div>
      </el-form-item>

      <el-form-item>
        <el-button type="primary" :loading="saving" @click="handleSave" v-hasPermi="['aiassistant:config:edit']">保存并热更</el-button>
        <el-button @click="handleReset">重置</el-button>
      </el-form-item>
    </el-form>
  </div>
</template>

<script setup lang="ts" name="AiAssistantConfig">
import { getConfig, updateConfig } from '@/api/aiassistant/config'
import { TOOL_CATALOG, DOMAIN_LABELS, type ToolCatalogItem } from './tool-catalog'

interface ToolGroup {
  domain: string
  label: string
  tools: ToolCatalogItem[]
  allChecked?: boolean
  indeterminate?: boolean
}

const { proxy } = getCurrentInstance()

const loading = ref<boolean>(false)
const saving = ref<boolean>(false)
const toolCatalog = TOOL_CATALOG

const form = reactive({
  llmBaseUrl: '',
  llmModel: '',
  llmApiKeyRef: '',
  agentMaxSteps: 5,
  temperature: 0.7,
  maxTokens: 4096,
  rateLimitRpm: 60,
  codegenEnabled: false,
  enabledTools: [] as string[],
  approvalPolicy: {
    destructiveTools: [] as string[]
  }
})

// 后端 enabledTools 为 null 时表示「契约全量」；此时页面展示全选，
// 且未改动勾选则不提交 enabledTools（保持 null 语义，避免落成显式清单）
const enabledToolsDefaultAll = ref<boolean>(false)
const toolsDirty = ref<boolean>(false)

/** 按 domain 分组的工具清单（附全选/半选状态） */
const toolGroups = computed<ToolGroup[]>(() => {
  const groups: Record<string, ToolGroup> = {}
  toolCatalog.forEach(tool => {
    if (!groups[tool.domain]) {
      groups[tool.domain] = { domain: tool.domain, label: DOMAIN_LABELS[tool.domain] || tool.domain, tools: [] }
    }
    groups[tool.domain].tools.push(tool)
  })
  return Object.keys(groups).map(domain => {
    const group = groups[domain]
    const checkedCount = group.tools.filter(t => form.enabledTools.includes(t.name)).length
    group.allChecked = checkedCount === group.tools.length && group.tools.length > 0
    group.indeterminate = checkedCount > 0 && checkedCount < group.tools.length
    return group
  })
})

/** 高危（需审批）工具：以后端下发为准，缺省回退到契约中的 destructive 工具 */
const destructiveTools = computed<string[]>(() => {
  const fromServer = form.approvalPolicy && form.approvalPolicy.destructiveTools
  if (fromServer && fromServer.length > 0) {
    return fromServer
  }
  return toolCatalog.filter(t => t.riskLevel === 'destructive').map(t => t.name)
})

/** 拉取配置 */
function fetchConfig() {
  loading.value = true
  getConfig().then(response => {
    const data = response.data || {}
    // enabledTools 为 null = 契约全量：展示全选并标记，未改动不提交
    enabledToolsDefaultAll.value = !Array.isArray(data.enabledTools)
    toolsDirty.value = false
    // approvalPolicy 兼容两种形态：字符串数组（orchestrator 实际形态）或 {destructiveTools: []}
    const destructive = Array.isArray(data.approvalPolicy)
      ? data.approvalPolicy.slice()
      : (data.approvalPolicy && data.approvalPolicy.destructiveTools) || []
    Object.assign(form, {
      llmBaseUrl: data.llmBaseUrl || '',
      llmModel: data.llmModel || '',
      llmApiKeyRef: data.llmApiKeyRef || '',
      agentMaxSteps: data.agentMaxSteps != null ? data.agentMaxSteps : 5,
      temperature: data.temperature != null ? data.temperature : 0.7,
      maxTokens: data.maxTokens != null ? data.maxTokens : 4096,
      rateLimitRpm: data.rateLimitRpm != null ? data.rateLimitRpm : 60,
      codegenEnabled: !!data.codegenEnabled,
      enabledTools: Array.isArray(data.enabledTools)
        ? data.enabledTools.slice()
        : toolCatalog.map(t => t.name),
      approvalPolicy: {
        destructiveTools: destructive
      }
    })
    loading.value = false
  }).catch(() => {
    loading.value = false
  })
}

/** 域级全选/全不选 */
function toggleDomain(domain: string, checked: string | number | boolean) {
  const names = toolCatalog.filter(t => t.domain === domain).map(t => t.name)
  const current = new Set(form.enabledTools)
  names.forEach(name => {
    if (checked) {
      current.add(name)
    } else {
      current.delete(name)
    }
  })
  form.enabledTools = Array.from(current)
  toolsDirty.value = true
}

/** 全选 */
function checkAllTools() {
  form.enabledTools = toolCatalog.map(t => t.name)
  toolsDirty.value = true
}

/** 清空 */
function uncheckAllTools() {
  form.enabledTools = []
  toolsDirty.value = true
}

/** 保存并热更 */
function handleSave() {
  saving.value = true
  const payload: Record<string, any> = {
    llmBaseUrl: form.llmBaseUrl,
    llmModel: form.llmModel,
    agentMaxSteps: form.agentMaxSteps,
    temperature: form.temperature,
    maxTokens: form.maxTokens,
    rateLimitRpm: form.rateLimitRpm
  }
  // llmApiKeyRef 为空或仍为脱敏值「******」时不提交，避免把掩码落成真实引用
  if (form.llmApiKeyRef && form.llmApiKeyRef !== '******') {
    payload.llmApiKeyRef = form.llmApiKeyRef
  }
  // 工具勾选有改动才提交 enabledTools；未改动保持后端原值（null=契约全量）
  if (toolsDirty.value) {
    payload.enabledTools = form.enabledTools
  }
  updateConfig(payload).then(() => {
    proxy.$modal.msgSuccess('已保存并热更')
    saving.value = false
    fetchConfig()
  }).catch(() => {
    saving.value = false
  })
}

/** 重置（重新拉取） */
function handleReset() {
  fetchConfig()
}

onMounted(() => {
  fetchConfig()
})
</script>

<style scoped>
.form-tip {
  margin-left: 8px;
  font-size: 12px;
  color: #909399;
}
.tools-toolbar {
  margin-bottom: 8px;
}
.tool-group {
  border: 1px solid #ebeef5;
  border-radius: 4px;
  padding: 8px 12px;
  margin-bottom: 10px;
}
.tool-group-title {
  border-bottom: 1px dashed #ebeef5;
  padding-bottom: 4px;
  margin-bottom: 6px;
}
.tool-checkbox {
  min-width: 320px;
  margin-right: 16px;
}
.tool-help {
  color: #909399;
  cursor: pointer;
  vertical-align: middle;
  margin-left: 4px;
}
.destructive-tag {
  margin-right: 8px;
}
</style>
