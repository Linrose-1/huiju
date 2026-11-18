<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { ElMessage } from 'element-plus'
import { AdminRequestError, errorMessage, formatDate, isSuperAdmin } from '../../services/admin'
import { mcpApi, mcpPageSize, type McpAudit, type McpField, type McpPartner, type McpPartnerInput, type McpStatus } from '../../services/mcp'
import { useRequestScope } from '../../services/request-scope'
import McpPermissionGroup from './McpPermissionGroup.vue'

type Page<T> = { items: T[]; hasMore: boolean; total: number }
type Permission = McpPartnerInput['search']
const status = ref<McpStatus | null>(null), statusError = ref(''), statusLoading = ref(false)
const beginStatus = useRequestScope(), beginSave = useRequestScope()

function paged<T>(request: (offset: number) => Promise<Page<T>>) {
  const page = ref<Page<T>>(), offset = ref(0), requested = ref(0)
  const loading = ref(false), error = ref('')
  const begin = useRequestScope()
  async function load(target = requested.value, supersede = false) {
    if (!isSuperAdmin.value || (loading.value && !supersede)) return
    requested.value = target
    const current = begin()
    loading.value = true; error.value = ''
    try {
      const value = await request(target)
      if (current()) { page.value = value; offset.value = target }
    } catch (failure) { if (current()) error.value = errorMessage(failure) }
    finally { if (current()) loading.value = false }
  }
  return { page, offset, loading, error, load }
}
const { page: partners, offset: partnerOffset, loading: partnersLoading, error: partnersError, load: loadPartners } = paged(mcpApi.partners)
const { page: audit, offset: auditOffset, loading: auditLoading, error: auditError, load: loadAudit } = paged(mcpApi.audit)
const selectedAudit = ref<McpAudit | null>(null)
const drawer = ref(false), saving = ref(false), formError = ref(''), conflict = ref(false)
const original = ref<McpPartner | null>(null)
const fieldLabels: Record<McpField, string> = { location: '地点', fee: '费用', cover: '封面', description: '公开介绍' }
const emptyPermission = (): Permission => ({ enabled: false, fields: [] })
const initialForm = (): McpPartnerInput => ({ name: '', remark: '', enabled: false, version: 1, search: emptyPermission(), detail: emptyPermission() })
const form = ref<McpPartnerInput>(initialForm())

function copyPermission(value: Permission): Permission { return { enabled: value.enabled, fields: value.enabled ? [...value.fields] : [] } }
function describePermission(value: Permission) {
  return value.enabled ? ['基础字段', ...value.fields.map(field => fieldLabels[field])].join('、') : '未授权'
}
function describePartner(value: McpPartner | null) {
  if (!value) return '新增前无配置'
  return [value.name, value.enabled ? '启用' : '停用', value.remark && `备注：${value.remark}`, `搜索：${describePermission(value.search)}`, `详情：${describePermission(value.detail)}`].filter(Boolean).join('\n')
}
const changes = computed(() => {
  const before = original.value
  if (!before) return ['新增对接方，默认停用、无权限。']
  const next = form.value
  return [
    before.name !== next.name.trim() ? `对接方更名为「${next.name.trim()}」` : '',
    before.remark !== next.remark.trim() ? '修改备注' : '',
    before.enabled !== next.enabled ? `对接方改为${next.enabled ? '启用' : '停用'}` : '',
    describePermission(before.search) !== describePermission(next.search) ? `搜索公开活动：${describePermission(next.search)}` : '',
    describePermission(before.detail) !== describePermission(next.detail) ? `查看公开活动详情：${describePermission(next.detail)}` : '',
  ].filter(Boolean)
})
async function loadStatus() {
  if (!isSuperAdmin.value || statusLoading.value) return
  const current = beginStatus()
  statusLoading.value = true; statusError.value = ''
  try { const value = await mcpApi.status(); if (current()) status.value = value }
  catch (failure) { if (current()) statusError.value = errorMessage(failure) }
  finally { if (current()) statusLoading.value = false }
}
function open(partner: McpPartner | null) {
  if (!isSuperAdmin.value || !status.value || saving.value || partnersLoading.value) return
  original.value = partner
  form.value = partner ? {
    name: partner.name, remark: partner.remark, enabled: partner.enabled, version: partner.version,
    search: copyPermission(partner.search), detail: copyPermission(partner.detail),
  } : initialForm()
  formError.value = ''; conflict.value = false; drawer.value = true
}
function closeDrawer(done?: () => void) {
  if (saving.value) return
  if (done) done()
  else drawer.value = false
}
async function save() {
  if (!isSuperAdmin.value || !drawer.value || !status.value || saving.value || conflict.value || !changes.value.length) return
  const { name: raw, remark: rawRemark, ...next } = form.value
  const name = raw.trim(), remark = rawRemark.trim(), before = original.value
  if (!name || name.length > 60 || remark.length > 200) { formError.value = '名称须为 1 至 60 字，备注最多 200 字。'; return }
  const current = beginSave()
  saving.value = true; formError.value = ''
  try {
    if (before) await mcpApi.update(before.id, { ...next, name, remark, search: copyPermission(next.search), detail: copyPermission(next.detail) })
    else await mcpApi.create({ name, remark })
    if (!current()) return
    drawer.value = false
    ElMessage.success('配置已保存')
    await Promise.all([loadPartners(before ? partnerOffset.value : 0, true), loadAudit(0, true)])
  } catch (failure) {
    if (!current()) return
    conflict.value = failure instanceof AdminRequestError && failure.code === 'MCP_PARTNER_VERSION_CONFLICT'
    formError.value = conflict.value ? '配置已被其他管理员更新。请重新读取后再编辑。' : errorMessage(failure)
  } finally { if (current()) saving.value = false }
}
function reloadPartners() {
  if (saving.value) return
  closeDrawer()
  void loadPartners(partnerOffset.value)
}
onMounted(() => { void Promise.all([loadStatus(), loadPartners(), loadAudit()]) })
</script>

<template>
  <section v-if="isSuperAdmin" class="mcp-page">
    <header class="mcp-heading">
      <h1>MCP 接入设置</h1>
      <el-tag type="info" effect="light">待接入</el-tag>
    </header>
    <section v-loading="statusLoading" class="panel mcp-overview">
      <div>
        <h2>MCP 总开关</h2>
        <p class="muted">当前仅可配置权限，暂未开放外部访问。</p>
      </div>
      <div class="overview-switch">
        <el-switch :model-value="false" disabled aria-label="MCP 总开关，关闭" />
        <span>关闭</span>
      </div>
      <div v-if="statusError" class="section-error" role="alert">
        <span>{{ statusError }}</span>
        <el-button link type="primary" @click="loadStatus">重试读取状态</el-button>
      </div>
    </section>

    <section class="panel">
      <div class="toolbar">
        <h2>对接方</h2>
        <el-button type="primary" :disabled="!status || partnersLoading || saving" @click="open(null)">新增对接方</el-button>
      </div>
      <div v-if="partnersError" class="section-error" role="alert">
        <span>{{ partnersError }}</span>
        <el-button link type="primary" :disabled="saving" @click="loadPartners()">重试</el-button>
      </div>
      <el-table v-loading="partnersLoading" :data="partners?.items ?? []" row-key="id" empty-text="暂无对接方">
        <el-table-column prop="name" label="对接方" min-width="180" />
        <el-table-column label="状态" width="100">
          <template #default="{ row }"><el-tag :type="row.enabled ? 'success' : 'info'">{{ row.enabled ? '启用' : '停用' }}</el-tag></template>
        </el-table-column>
        <el-table-column label="已配置能力" min-width="190">
          <template #default="{ row }">
            {{ [row.search.enabled && '搜索公开活动', row.detail.enabled && '查看公开活动详情'].filter(Boolean).join('、') || '未配置' }}
          </template>
        </el-table-column>
        <el-table-column label="接入状态" width="110">
          <template #default><el-tag type="info" effect="plain">待接入</el-tag></template>
        </el-table-column>
        <el-table-column label="操作" width="112">
          <template #default="{ row }"><el-button link type="primary" :disabled="!status || partnersLoading || saving" @click="open(row)">编辑权限</el-button></template>
        </el-table-column>
      </el-table>
      <div v-if="partners && (partnerOffset || partners.hasMore)" class="pagination">
        <span>第 {{ partnerOffset / mcpPageSize + 1 }} 页 · 共 {{ partners.total }} 条</span>
        <el-button :disabled="!partnerOffset || partnersLoading || saving" @click="loadPartners(partnerOffset - mcpPageSize)">上一页</el-button>
        <el-button :disabled="!partners.hasMore || partnersLoading || saving" @click="loadPartners(partnerOffset + mcpPageSize)">下一页</el-button>
      </div>
    </section>

    <section class="panel">
      <h2>变更记录</h2>
      <div v-if="auditError" class="section-error" role="alert">
        <span>{{ auditError }}</span>
        <el-button link type="primary" :disabled="saving" @click="loadAudit()">重试</el-button>
      </div>
      <el-table v-loading="auditLoading" :data="audit?.items ?? []" row-key="id" empty-text="暂无变更记录">
        <el-table-column label="时间" min-width="170">
          <template #default="{ row }">{{ formatDate(row.createdAt) }}</template>
        </el-table-column>
        <el-table-column prop="actorName" label="操作人" min-width="120" />
        <el-table-column prop="partnerName" label="对接方" min-width="160" />
        <el-table-column label="操作" width="112">
          <template #default="{ row }"><el-button link type="primary" @click="selectedAudit = row">查看变更</el-button></template>
        </el-table-column>
      </el-table>
      <div v-if="audit && (auditOffset || audit.hasMore)" class="pagination">
        <span>第 {{ auditOffset / mcpPageSize + 1 }} 页 · 共 {{ audit.total }} 条</span>
        <el-button :disabled="!auditOffset || auditLoading || saving" @click="loadAudit(auditOffset - mcpPageSize)">上一页</el-button>
        <el-button :disabled="!audit.hasMore || auditLoading || saving" @click="loadAudit(auditOffset + mcpPageSize)">下一页</el-button>
      </div>
    </section>

    <el-drawer
      v-model="drawer"
      :title="original ? '编辑权限' : '新增对接方'"
      size="min(560px, 100vw)"
      :before-close="closeDrawer"
      :close-on-click-modal="!saving"
      :close-on-press-escape="!saving"
      :show-close="!saving"
    >
      <p v-if="original" class="drawer-context">{{ original.name }} · {{ original.enabled ? '启用' : '停用' }} · 待接入</p>
      <el-alert title="保存配置不会开启外部访问。" type="info" :closable="false" show-icon />
      <el-form label-position="top" class="mcp-form" :disabled="saving" @submit.prevent="save">
        <el-form-item label="对接方名称">
          <el-input v-model="form.name" :maxlength="60" autocomplete="off" />
        </el-form-item>
        <el-form-item label="备注（选填）">
          <el-input v-model="form.remark" type="textarea" :maxlength="200" :rows="2" />
        </el-form-item>
        <template v-if="original">
          <el-form-item label="启用对接方">
            <el-switch v-model="form.enabled" aria-label="启用对接方" />
          </el-form-item>
          <McpPermissionGroup v-model="form.search" title="搜索公开活动" searchable />
          <McpPermissionGroup v-model="form.detail" title="查看公开活动详情" />
        </template>
        <section class="change-summary" aria-label="保存前确认">
          <strong>本次变更</strong>
          <ul v-if="changes.length"><li v-for="line in changes" :key="line">{{ line }}</li></ul>
          <p v-else>暂无变更。</p>
        </section>
      </el-form>
      <el-alert v-if="formError" :title="formError" type="error" :closable="false" show-icon class="form-error" />
      <template #footer>
        <el-button :disabled="saving" @click="closeDrawer()">取消</el-button>
        <el-button v-if="conflict" type="primary" @click="reloadPartners">重新读取</el-button>
        <el-button v-else type="primary" :loading="saving" :disabled="!changes.length" @click="save">保存配置</el-button>
      </template>
    </el-drawer>

    <el-dialog
      :model-value="!!selectedAudit"
      title="查看变更记录"
      width="min(640px, 92vw)"
      @update:model-value="selectedAudit = null"
    >
      <template v-if="selectedAudit">
        <p class="drawer-context">{{ selectedAudit.partnerName }} · {{ selectedAudit.actorName }} · {{ formatDate(selectedAudit.createdAt) }}</p>
        <div class="audit-compare">
          <section><h3>变更前</h3><p>{{ describePartner(selectedAudit.before) }}</p></section>
          <section><h3>变更后</h3><p>{{ describePartner(selectedAudit.after) }}</p></section>
        </div>
      </template>
    </el-dialog>
  </section>
</template>

<style scoped>
.mcp-page { display: grid; gap: 20px; }
.mcp-heading, .overview-switch { display: flex; align-items: center; gap: 12px; }
.mcp-heading h1, .toolbar h2 { margin: 0; }
.mcp-overview { display: flex; align-items: center; justify-content: space-between; gap: 16px; flex-wrap: wrap; }
.mcp-overview h2 { margin-bottom: 4px; }
.mcp-overview p, .drawer-context { margin: 0; font-size: 13px; }
.overview-switch { color: var(--huiju-muted); }
.section-error { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 8px 12px; margin: 0 0 12px; background: #fdf2f1; color: #9b3734; border-radius: 8px; font-size: 13px; }
.mcp-overview .section-error { flex-basis: 100%; margin: 0; }
.drawer-context { color: var(--huiju-muted); margin: 0 0 12px; overflow-wrap: anywhere; }
.mcp-form { margin: 16px 0; }
.change-summary { background: #f5f7f5; padding: 12px 16px; border-radius: 8px; font-size: 13px; overflow-wrap: anywhere; }
.change-summary ul { margin: 8px 0 0; padding-left: 18px; line-height: 1.7; }
.change-summary p { margin: 6px 0 0; }
.audit-compare { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 12px; }
.audit-compare section { padding: 14px; background: #f5f7f5; border-radius: 8px; }
.audit-compare h3 { margin: 0 0 8px; }
.audit-compare p { margin: 0; white-space: pre-wrap; overflow-wrap: anywhere; }
</style>
