<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { adminApi, errorMessage, isSuperAdmin } from '../../services/admin'
import { useRequestScope } from '../../services/request-scope'

const props = defineProps<{ memberId: string; memberLabel: string }>()
type Community = Awaited<ReturnType<typeof adminApi.communityPermissions>>['items'][number]
const labels = { none: '无权限', view: '仅查看成员名单', recognize: '查看名单并认定、撤销在册身份' }
type Level = keyof typeof labels
const items = ref<Community[]>([]), total = ref(0), offset = ref(0), hasMore = ref(false)
const loading = ref(false), saving = ref(''), error = ref(''), saveError = ref('')
let requestedOffset = 0
const beginLoad = useRequestScope(), beginWrite = useRequestScope()

function level(row: Community): Level {
  if (row.canRecognizeMembers) return 'recognize'
  return row.canViewRoster ? 'view' : 'none'
}
async function load(target = requestedOffset) {
  if (!isSuperAdmin.value || saving.value || loading.value) return
  const current = beginLoad()
  requestedOffset = target
  loading.value = true
  error.value = ''; saveError.value = ''
  try {
    const page = await adminApi.communityPermissions(props.memberId, target)
    if (!current()) return
    offset.value = target; items.value = page.items; total.value = page.total; hasMore.value = page.hasMore
  } catch (e) { if (current()) error.value = errorMessage(e) }
  finally { if (current()) loading.value = false }
}
async function change(row: Community, next: Level) {
  if (!isSuperAdmin.value || saving.value || loading.value || level(row) === next) return
  const current = beginWrite()
  saving.value = row.communityId; saveError.value = ''
  try {
    await ElMessageBox.confirm(
      '将「' + props.memberLabel + '」在「' + row.communityName + '」的小程序权限设为「' + labels[next] + '」？',
      '修改成员管理权限', { confirmButtonText: '确认修改', cancelButtonText: '取消' },
    )
    if (!current() || !isSuperAdmin.value) return
    const result = await adminApi.setCommunityPermissions(props.memberId, row.communityId, next !== 'none', next === 'recognize')
    if (!current()) return
    items.value = items.value.map(item => item.communityId === result.communityId ? result : item)
    ElMessage.success('成员管理权限已更新')
  } catch (e) { if (current() && e !== 'cancel' && e !== 'close') saveError.value = errorMessage(e) }
  finally { if (current()) saving.value = '' }
}
onMounted(() => load())
</script>

<template>
  <section class="community-permissions">
    <h3>小程序成员管理权限</h3>
    <p v-if="loading" role="status">正在读取权限…</p>
    <el-alert v-if="error || saveError" :title="error || saveError" type="error" :closable="false" />
    <el-button v-if="error || saveError" :disabled="loading || !!saving" @click="load()">
      {{ error ? '重试' : '重新读取权限' }}
    </el-button>
    <p v-if="!loading && !error && !items.length" class="muted">该会员尚未加入社群。</p>
    <div v-for="row in items" :key="row.communityId" class="permission-row">
      <span>{{ row.communityName }}</span>
      <el-select
        :model-value="level(row)"
        :aria-label="row.communityName + '成员管理权限'"
        :disabled="loading || !!saving"
        :loading="saving === row.communityId"
        @change="change(row, $event)"
      >
        <el-option v-for="(label, value) in labels" :key="value" :label="label" :value="value" />
      </el-select>
    </div>
    <div v-if="hasMore || offset" class="permission-pages">
      <el-button :disabled="loading || !!saving || offset === 0" @click="load(offset - 20)">上一页</el-button>
      <span class="muted">第 {{ Math.floor(offset / 20) + 1 }} / {{ Math.ceil(total / 20) }} 页</span>
      <el-button :disabled="loading || !!saving || !hasMore" @click="load(offset + 20)">下一页</el-button>
    </div>
  </section>
</template>

<style scoped>
.community-permissions { margin: 20px 0; }
.permission-row, .permission-pages { display: flex; align-items: center; gap: 12px; margin-top: 10px; }
.permission-row { justify-content: space-between; flex-wrap: wrap; }
.permission-row .el-select { width: 250px; max-width: 100%; }
.permission-pages { justify-content: flex-end; }
</style>
