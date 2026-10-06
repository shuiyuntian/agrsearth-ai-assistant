<!--
文件作用：示例管理页骨架（页面结构：查询区/工具栏/表格/分页/编辑对话框）
作者：JasonLee（shuiyuntian@foxmail.com）
创建日期：2026-09-14
版本：1.0.1
修改记录：
  - 1.0.0 (2026-09-14) 模板仓骨架初始版本（组件 name 与菜单路由 name 一致，tagsView keep-alive 缓存匹配）
  - 1.0.1 (2026-10-06) script setup 补 lang="ts"（此前按 JS 解析，TS 语法报莫名 babel 错；
    骨架呈现为 TS 工程，缺 lang 是最常见踩坑点）

版权所有 (C) 2026 CesiumAI 项目
-->
<template>
  <div class="app-container">
    <!-- 查询区 -->
    <el-form :model="queryParams" ref="queryRef" :inline="true" v-show="showSearch" label-width="68px">
      <el-form-item label="名称" prop="name">
        <el-input
          v-model="queryParams.name"
          placeholder="请输入名称"
          clearable
          style="width: 200px"
          @keyup.enter="handleQuery"
        />
      </el-form-item>
      <el-form-item>
        <el-button type="primary" icon="Search" @click="handleQuery">搜索</el-button>
        <el-button icon="Refresh" @click="resetQuery">重置</el-button>
      </el-form-item>
    </el-form>

    <!-- 工具栏 -->
    <el-row :gutter="10" class="mb8">
      <el-col :span="1.5">
        <el-button
          type="primary"
          plain
          icon="Plus"
          @click="handleAdd"
          v-hasPermi="['example:example:add']"
        >新增</el-button>
      </el-col>
      <right-toolbar v-model:showSearch="showSearch" @queryTable="getList"></right-toolbar>
    </el-row>

    <!-- 表格 -->
    <el-table v-loading="loading" :data="exampleList">
      <el-table-column label="编号" align="center" prop="id" width="80" />
      <el-table-column label="名称" align="center" prop="name" :show-overflow-tooltip="true" />
      <el-table-column label="备注" align="center" prop="remark" :show-overflow-tooltip="true" />
      <!-- 操作列：固定宽 + fixed=right + 图标文字按钮（L10 A.2）。
           宽度按内容实测测算：width = Σ按钮宽 + (n-1)×12 + 24；
           基准：2 字按钮≈54 / 3 字≈68 / 4 字≈82 / 纯图标 dropdown≈30。
           本列 修改(54)+删除(54)+12+24 ≈ 144 → 取 150，宁宽勿折行（必须一行放下）。
           tooltip 规则：文字与按钮一致不加（本列不加）；仅补充信息/图标-only 才加 -->
      <el-table-column label="操作" align="center" width="150" fixed="right">
        <template #default="scope">
          <el-button
              link
              type="primary"
              icon="Edit"
              @click="handleUpdate(scope.row)"
              v-hasPermi="['example:example:edit']"
            >修改</el-button>
          <el-button
              link
              type="danger"
              icon="Delete"
              @click="handleDelete(scope.row)"
              v-hasPermi="['example:example:remove']"
            >删除</el-button>
        </template>
      </el-table-column>
    </el-table>
    <pagination
      v-show="total > 0"
      :total="total"
      v-model:page="queryParams.pageNum"
      v-model:limit="queryParams.pageSize"
      @pagination="getList"
    />

    <!-- 新增/修改对话框 -->
    <el-dialog :title="title" v-model="open" width="500px" append-to-body>
      <el-form ref="formRef" :model="form" :rules="rules" label-width="80px">
        <el-form-item label="名称" prop="name">
          <el-input v-model="form.name" placeholder="请输入名称" />
        </el-form-item>
        <el-form-item label="备注" prop="remark">
          <el-input v-model="form.remark" type="textarea" placeholder="请输入备注" />
        </el-form-item>
      </el-form>
      <template #footer>
        <div class="dialog-footer">
          <el-button type="primary" @click="submitForm">确 定</el-button>
          <el-button @click="cancel">取 消</el-button>
        </div>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts" name="ExampleIndex">
// 骨架说明：
// - ref/computed/getCurrentInstance 等由 unplugin-auto-import 隐式注入（勿重复 import）
// - request 封装在 src/api/example.ts；v-hasPermi/Pagination/RightToolbar 为宿主全局组件/指令
// - 接真实后端后：listExample 返回 { rows, total }；新增/修改/删除调对应 API 并 proxy.$modal.msgSuccess 反馈
import { listExample } from '@/api/example'

const { proxy } = getCurrentInstance()

const exampleList = ref([])
const open = ref(false)
const loading = ref(true)
const showSearch = ref(true)
const total = ref(0)
const title = ref('')

const queryParams = ref({ pageNum: 1, pageSize: 10, name: '' })
const form = ref({})
const rules = {
  name: [{ required: true, message: '名称不能为空', trigger: 'blur' }]
}

function getList() {
  loading.value = true
  listExample(queryParams.value).then((res) => {
    exampleList.value = res.rows || []
    total.value = res.total || 0
    loading.value = false
  })
}

function handleQuery() {
  queryParams.value.pageNum = 1
  getList()
}

function resetQuery() {
  proxy.resetForm('queryRef')
  handleQuery()
}

function handleAdd() {
  form.value = {}
  open.value = true
  title.value = '添加示例'
}

function handleUpdate(row) {
  form.value = { ...row }
  open.value = true
  title.value = '修改示例'
}

function handleDelete(row) {
  proxy.$modal
    .confirm(`确认删除编号为"${row.id}"的示例吗？`)
    .then(() => {
      proxy.$modal.msgSuccess('骨架示例：接平台方 API 后落库')
    })
    .catch(() => {})
}

function cancel() {
  open.value = false
}

function submitForm() {
  proxy.$refs.formRef.validate((valid) => {
    if (valid) {
      proxy.$modal.msgSuccess('骨架示例：接平台方 API 后落库')
      open.value = false
    }
  })
}

getList()
</script>
