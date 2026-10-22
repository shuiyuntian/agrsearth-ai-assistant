<!--
文件作用：风场管理页（插件信息/运行状态/数据更新时间卡片；走 admin-sdk 契约，无自建 createApp、无 import.meta.env）
作者：JasonLee（shuiyuntian@foxmail.com）
创建日期：2026-10-06
版本：1.0.0
修改记录：
  - 1.0.0 (2026-10-06) 风场插件初始版本（卡片式概览页；后端不可达时降级展示静态信息）

版权所有 (C) 2026 AGRSEarth 项目
-->
<template>
  <div class="app-container">
    <el-row :gutter="12">
      <el-col :span="8">
        <el-card shadow="hover">
          <template #header><span>插件信息</span></template>
          <el-descriptions :column="1" border size="small">
            <el-descriptions-item label="插件名称">{{ pkg.name }}</el-descriptions-item>
            <el-descriptions-item label="包 ID">{{ pkg.id }}</el-descriptions-item>
            <el-descriptions-item label="版本">{{ pkg.version }}</el-descriptions-item>
            <el-descriptions-item label="轨道 / 分层">{{ pkg.track }} / {{ pkg.tier }}</el-descriptions-item>
            <el-descriptions-item label="交付方式">{{ pkg.delivery }}</el-descriptions-item>
            <el-descriptions-item label="作者">{{ pkg.author }}</el-descriptions-item>
          </el-descriptions>
        </el-card>
      </el-col>

      <el-col :span="8">
        <el-card shadow="hover">
          <template #header><span>运行状态</span></template>
          <el-descriptions :column="1" border size="small">
            <el-descriptions-item label="发布状态">
              <el-tag type="success" size="small">已发布（测试底座）</el-tag>
            </el-descriptions-item>
            <el-descriptions-item label="后端服务">{{ pkg.serviceId }}</el-descriptions-item>
            <el-descriptions-item label="服务版本">{{ serviceInfo?.version ?? '-' }}</el-descriptions-item>
            <el-descriptions-item label="组件">
              球端面板 + 管理页 + 后端微服务
            </el-descriptions-item>
          </el-descriptions>
        </el-card>
      </el-col>

      <el-col :span="8">
        <el-card shadow="hover" v-loading="loading">
          <template #header>
            <span>数据信息</span>
            <el-button text size="small" style="float: right" :icon="Refresh" @click="loadMeta">刷新</el-button>
          </template>
          <template v-if="sampleMeta">
            <el-descriptions :column="1" border size="small">
              <el-descriptions-item label="数据更新时间">{{ sampleMeta.validTime }}</el-descriptions-item>
              <el-descriptions-item label="数据集">{{ sampleMeta.name }}</el-descriptions-item>
              <el-descriptions-item label="网格">
                {{ sampleMeta.grid.nx }}×{{ sampleMeta.grid.ny }} · 步长 {{ sampleMeta.grid.step }}°
              </el-descriptions-item>
              <el-descriptions-item label="风速范围">
                {{ sampleMeta.speedRange[0] }} ~ {{ sampleMeta.speedRange[1] }} {{ sampleMeta.unit }}
              </el-descriptions-item>
            </el-descriptions>
          </template>
          <el-empty v-else description="后端不可达，仅展示静态信息" :image-size="60" />
        </el-card>
      </el-col>
    </el-row>
  </div>
</template>

<script setup lang="ts" name="WindFieldIndex">
/**
 * 文件作用：风场管理页逻辑（挂载时拉取 /wind/sample-meta 与 /info；失败降级静态展示）
 * 作者：JasonLee <shuiyuntian@foxmail.com>
 * 创建日期：2026-10-06
 * 版本：1.0.0
 * 修改记录：
 *   - 1.0.0 (2026-10-06) 风场插件初始版本
 *
 * 版权所有 (C) 2026 AGRSEarth 项目
 */
import { ref, onMounted } from 'vue'
import { Refresh } from '@element-plus/icons-vue'
import { getSampleMeta, getServiceInfo } from '@/api/windfield'
import type { WindSampleMeta, WindServiceInfo } from '@/api/windfield'

/** 包元信息（与 manifest.json 一致；管理页不读 manifest，维护一份静态展示值） */
const pkg = {
  id: 'wind-field-demo',
  name: '风场',
  version: '0.1.0',
  track: 'tool',
  tier: 'business',
  delivery: 'optional',
  author: '插件团队 <plugin-dev@example.com>',
  serviceId: 'wind-field-demo-server'
}

const loading = ref(false)
const sampleMeta = ref<WindSampleMeta | null>(null)
const serviceInfo = ref<WindServiceInfo | null>(null)

async function loadMeta() {
  loading.value = true
  try {
    const [meta, info] = await Promise.allSettled([getSampleMeta(), getServiceInfo()])
    sampleMeta.value = meta.status === 'fulfilled' ? meta.value : null
    serviceInfo.value = info.status === 'fulfilled' ? info.value : null
  } finally {
    loading.value = false
  }
}

onMounted(loadMeta)
</script>
