<script setup lang="ts">
import type { McpField, McpPartnerInput } from '../../services/mcp'

defineProps<{ title: string; searchable?: boolean }>()
const permission = defineModel<McpPartnerInput['search']>({ required: true })
const fixedFields = ['活动标识', '标题', '时间', '公开状态']
const optionalFields: { value: McpField; label: string }[] = [
  { value: 'location', label: '地点' },
  { value: 'fee', label: '费用' },
  { value: 'cover', label: '封面' },
  { value: 'description', label: '公开介绍' },
]
function changeEnabled(value: unknown) {
  permission.value = { enabled: value === true, fields: [] }
}
</script>

<template>
  <section class="permission-group">
    <div class="permission-heading">
      <h2>{{ title }}</h2>
      <el-switch :model-value="permission.enabled" :aria-label="title" @change="changeEnabled" />
    </div>
    <p v-if="!permission.enabled" class="permission-note muted">未授权，不返回{{ searchable ? '搜索结果' : '详情' }}。</p>
    <template v-else>
      <div class="permission-label">基础字段（固定）</div>
      <div class="fixed-fields">
        <el-tag v-for="field in fixedFields" :key="field" type="info" effect="light">{{ field }}</el-tag>
      </div>
      <div class="permission-label">可选字段（默认不开放）</div>
      <el-checkbox-group v-model="permission.fields" :aria-label="title + '可选字段'">
        <el-checkbox v-for="field in optionalFields" :key="field.value" :value="field.value">{{ field.label }}</el-checkbox>
      </el-checkbox-group>
      <p class="permission-note muted">未勾选的字段不返回，也不能用于筛选。</p>
      <div v-if="searchable" class="permission-preview">
        <strong>筛选权限预览</strong>
        <p>可按时间{{ permission.fields.includes('location') ? '、地点' : '' }}{{ permission.fields.includes('fee') ? '、费用' : '' }}筛选。{{ permission.fields.includes('fee') ? '' : '不返回费用，也不可按费用筛选。' }}</p>
        <p>{{ permission.fields.includes('description') ? '关键词匹配标题和公开介绍。' : '关键词仅匹配标题。' }}封面仅用于展示。</p>
      </div>
    </template>
  </section>
</template>

<style scoped>
.permission-group { padding: 16px; border: 1px solid var(--huiju-border); border-radius: 10px; margin-bottom: 14px; }
.permission-heading { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
.permission-heading h2 { margin: 0; font-size: 15px; }
.permission-label { margin: 10px 0 6px; font-size: 13px; font-weight: 600; }
.fixed-fields { display: flex; flex-wrap: wrap; gap: 8px; }
.permission-note, .permission-preview { margin: 5px 0 0; font-size: 13px; }
.permission-preview { padding: 10px 12px; border-radius: 8px; background: #f5f7f5; }
.permission-preview p { margin: 4px 0 0; }
</style>
