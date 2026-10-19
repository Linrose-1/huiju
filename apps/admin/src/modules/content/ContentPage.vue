<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { ElMessage } from 'element-plus'
import { adminApi, errorMessage, formatDate, isSuperAdmin, type ContentHistory, type ContentEditor, type MemberSummary } from '../../services/admin'
import { useRequestScope } from '../../services/request-scope'
const form = ref({ activityText: '', assistantText: '' })
const loaded = ref(false)
const loading = ref(false), saving = ref(false), error = ref('')
const history = ref<ContentHistory[]>([]), editors = ref<ContentEditor[]>([]), candidates = ref<MemberSummary[]>([])
const historyOffset = ref(0), editorOffset = ref(0), searchOffset = ref(0)
const historyMore = ref(false), editorMore = ref(false), searchMore = ref(false)
const historyLoading = ref(false), editorLoading = ref(false), searchLoading = ref(false)
const historyError = ref(''), editorError = ref(''), searchError = ref('')
const query = ref(''), appliedQuery = ref(''), changing = ref('')
const begin = useRequestScope(), beginHistory = useRequestScope(), beginEditors = useRequestScope(), beginSearch = useRequestScope()
async function load() {
  const current = begin(); loading.value = true; error.value = ''
  try { const value = await adminApi.content(); if (current()) { form.value = value; loaded.value = true } }
  catch (e) { if (current()) error.value = errorMessage(e) }
  finally { if (current()) loading.value = false }
}
async function save() {
  if (saving.value || loading.value) return
  if (!form.value.activityText.trim() || !form.value.assistantText.trim()) { error.value = '两项文案均不能为空。'; return }
  const current = begin(); saving.value = true; error.value = ''
  try { await adminApi.saveContent({ activityText: form.value.activityText.trim(), assistantText: form.value.assistantText.trim() }); if (current()) { ElMessage.success('文案已保存'); historyOffset.value = 0; void loadHistory() } }
  catch (e) { if (current()) error.value = errorMessage(e) }
  finally { if (current()) saving.value = false }
}
async function loadHistory() {
  const current = beginHistory(); historyLoading.value = true; historyError.value = ''; history.value = []
  try { const value = await adminApi.contentHistory(historyOffset.value); if (current()) { history.value = value.items; historyMore.value = value.hasMore } }
  catch (e) { if (current()) historyError.value = errorMessage(e) }
  finally { if (current()) historyLoading.value = false }
}
async function loadEditors() {
  if (!isSuperAdmin.value) return
  const current = beginEditors(); editorLoading.value = true; editorError.value = ''; editors.value = []
  try { const value = await adminApi.contentEditors(editorOffset.value); if (current()) { editors.value = value.items; editorMore.value = value.hasMore } }
  catch (e) { if (current()) editorError.value = errorMessage(e) }
  finally { if (current()) editorLoading.value = false }
}
async function search(reset = true) {
  if (reset) { searchOffset.value = 0; appliedQuery.value = query.value.trim() }
  if (!appliedQuery.value) { searchError.value = '请填写会员编号或名称。'; return }
  const current = beginSearch(); searchLoading.value = true; searchError.value = ''; candidates.value = []
  try { const value = await adminApi.members({ q: appliedQuery.value, offset: searchOffset.value }); if (current()) { candidates.value = value.items; searchMore.value = value.hasMore } }
  catch (e) { if (current()) searchError.value = errorMessage(e) }
  finally { if (current()) searchLoading.value = false }
}
async function grant(memberId: string, enabled: boolean) {
  if (changing.value || !isSuperAdmin.value) return
  changing.value = memberId; editorError.value = ''
  const current = beginEditors()
  try { await adminApi.setContentEditor(memberId, enabled); if (current()) { ElMessage.success(enabled ? '已授予编辑权限' : '已撤销编辑权限'); editorOffset.value = 0 } }
  catch (e) { if (current()) editorError.value = errorMessage(e) }
  finally { if (current()) changing.value = '' }
  if (current() && !editorError.value) void loadEditors()
}
function page(kind: 'history' | 'editors' | 'search', back: boolean) {
  const offset = kind === 'history' ? historyOffset : kind === 'editors' ? editorOffset : searchOffset
  offset.value = Math.max(0, offset.value + (back ? -(kind === 'search' ? 40 : 20) : (kind === 'search' ? 40 : 20)))
  if (kind === 'history') void loadHistory(); else if (kind === 'editors') void loadEditors(); else void search(false)
}
onMounted(() => { void load(); void loadHistory(); void loadEditors() })
</script>
<template>
  <section>
    <h1>运营文案</h1><p class="page-description">
      保存后生效，小程序下次进入页面时读取最新文案。
    </p>
    <div
      v-loading="loading"
      class="panel"
    >
      <el-alert
        v-if="error"
        :title="error"
        type="error"
        :closable="false"
      /><el-button
        v-if="error"
        :disabled="loading || saving"
        @click="load"
      >
        重新加载
      </el-button>
      <el-form
        label-position="top"
        @submit.prevent="save"
      >
        <el-form-item label="活动页文案">
          <el-input
            v-model="form.activityText"
            :maxlength="200"
            show-word-limit
            :disabled="loading || saving"
          />
        </el-form-item>
        <el-form-item label="助手页文案">
          <el-input
            v-model="form.assistantText"
            :maxlength="200"
            show-word-limit
            :disabled="loading || saving"
          />
        </el-form-item>
        <h2>效果预览</h2><div class="preview">
          <p>活动页</p><strong>{{ form.activityText || '尚未填写' }}</strong><p>助手页</p><strong>{{ form.assistantText || '尚未填写' }}</strong>
        </div>
        <el-button
          type="primary"
          native-type="submit"
          :loading="saving"
          :disabled="loading || !loaded"
        >
          保存文案
        </el-button>
      </el-form>
    </div>
    <div class="panel section-gap">
      <h2>修改记录</h2><el-alert
        v-if="historyError"
        :title="historyError"
        type="error"
        :closable="false"
      /><el-button
        v-if="historyError"
        @click="loadHistory"
      >
        重试
      </el-button>
      <el-table
        v-loading="historyLoading"
        :data="history"
        empty-text="暂无修改记录"
      >
        <el-table-column
          label="修改人"
          min-width="160"
        >
          <template #default="{ row }">
            {{ row.actorName || row.actorId }} · {{ row.actorType === 'member' ? '会员' : '后台' }}
          </template>
        </el-table-column>
        <el-table-column
          label="文案变更"
          min-width="320"
        >
          <template #default="{ row }">
            <template v-if="row.action === 'content'">
              <p>活动：{{ row.before.activityText }} → {{ row.after.activityText }}</p><p>助手：{{ row.before.assistantText }} → {{ row.after.assistantText }}</p>
            </template><p v-else>
              会员 {{ row.targetMemberNumber || row.targetMemberId }}：{{ row.after.enabled ? '授予编辑权限' : '撤销编辑权限' }}
            </p>
          </template>
        </el-table-column>
        <el-table-column
          label="时间"
          width="180"
        >
          <template #default="{ row }">
            {{ formatDate(row.createdAt) }}
          </template>
        </el-table-column>
      </el-table>
      <div class="pagination">
        <el-button
          :disabled="!historyOffset || historyLoading"
          @click="page('history', true)"
        >
          上一页
        </el-button><el-button
          :disabled="!historyMore || historyLoading"
          @click="page('history', false)"
        >
          下一页
        </el-button>
      </div>
    </div>
    <div
      v-if="isSuperAdmin"
      class="panel section-gap"
    >
      <h2>小程序文案编辑人员</h2><p class="muted">
        授权直接关联会员；撤销后不能继续修改文案。
      </p>
      <form
        class="filters"
        @submit.prevent="search()"
      >
        <el-input
          v-model="query"
          placeholder="会员编号或名称"
          aria-label="搜索授权会员"
          style="width: 260px"
          :maxlength="100"
        /><el-button
          type="primary"
          native-type="submit"
          :loading="searchLoading"
          :disabled="Boolean(changing)"
        >
          搜索会员
        </el-button>
      </form>
      <el-alert
        v-if="searchError"
        :title="searchError"
        type="error"
        :closable="false"
      /><el-button
        v-if="searchError && appliedQuery"
        @click="search(false)"
      >
        重试
      </el-button>
      <el-table
        v-if="appliedQuery"
        v-loading="searchLoading"
        :data="candidates"
        empty-text="没有找到会员"
      >
        <el-table-column
          prop="memberNumber"
          label="会员编号"
        /><el-table-column
          prop="displayName"
          label="用户名称"
        /><el-table-column label="授权">
          <template #default="{ row }">
            <el-button
              :disabled="Boolean(changing)"
              :loading="changing === row.id"
              @click="grant(row.id, true)"
            >
              授予编辑权限
            </el-button>
          </template>
        </el-table-column>
      </el-table>
      <div
        v-if="appliedQuery"
        class="pagination"
      >
        <el-button
          :disabled="!searchOffset || searchLoading"
          @click="page('search', true)"
        >
          上一页
        </el-button><el-button
          :disabled="!searchMore || searchLoading"
          @click="page('search', false)"
        >
          下一页
        </el-button>
      </div>
      <h3>当前授权人员</h3><el-alert
        v-if="editorError"
        :title="editorError"
        type="error"
        :closable="false"
      /><el-button
        v-if="editorError"
        @click="loadEditors"
      >
        重试
      </el-button>
      <el-table
        v-loading="editorLoading"
        :data="editors"
        empty-text="暂无授权人员"
      >
        <el-table-column
          prop="memberNumber"
          label="会员编号"
        /><el-table-column
          prop="displayName"
          label="用户名称"
        /><el-table-column label="状态">
          <template #default="{ row }">
            {{ row.enabled ? '已授权' : '已撤销' }}
          </template>
        </el-table-column><el-table-column label="操作">
          <template #default="{ row }">
            <el-button
              :disabled="Boolean(changing)"
              :loading="changing === row.memberId"
              @click="grant(row.memberId, !row.enabled)"
            >
              {{ row.enabled ? '撤销权限' : '重新授权' }}
            </el-button>
          </template>
        </el-table-column>
      </el-table>
      <div class="pagination">
        <el-button
          :disabled="!editorOffset || editorLoading || Boolean(changing)"
          @click="page('editors', true)"
        >
          上一页
        </el-button><el-button
          :disabled="!editorMore || editorLoading || Boolean(changing)"
          @click="page('editors', false)"
        >
          下一页
        </el-button>
      </div>
    </div>
  </section>
</template>
<style scoped>.section-gap { margin-top: 20px; }.preview { padding: 16px; margin-bottom: 20px; border-radius: 8px; background: #f2f7f3; overflow-wrap: anywhere; }.preview p { color: var(--huiju-muted); margin: 8px 0; }</style>
