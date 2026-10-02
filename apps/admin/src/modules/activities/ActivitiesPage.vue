<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { ElMessage } from 'element-plus'
import { adminApi, errorMessage, formatDate, type AdminActivity, type ActivityOperation } from '../../services/admin'
import { useRequestScope } from '../../services/request-scope'

const status = ref<'all' | 'normal' | 'removed'>('all')
const keyword = ref('')
const applied = ref({ status: status.value, q: '' })
const offset = ref(0)
const items = ref<AdminActivity[]>([])
const total = ref(0)
const hasMore = ref(false)
const loading = ref(false)
const error = ref('')
const selected = ref<AdminActivity | null>(null)
const reason = ref('')
const dialogError = ref('')
const submitting = ref(false)
const dialogOpen = ref(false)
const detail = ref<AdminActivity | null>(null)
const history = ref<ActivityOperation[]>([])
const historyOffset = ref(0)
const historyMore = ref(false)
const historyLoading = ref(false)
const historyError = ref('')
const begin = useRequestScope()
const beginHistory = useRequestScope()

async function load(reset = false) {
  if (submitting.value) return
  if (reset) {
    offset.value = 0
    applied.value = { status: status.value, q: keyword.value.trim() }
  }
  const current = begin()
  loading.value = true
  error.value = ''
  items.value = []
  try {
    const result = await adminApi.activities({ ...applied.value, offset: offset.value })
    if (!current()) return
    items.value = result.items
    total.value = result.total
    hasMore.value = result.hasMore
  } catch (value) { if (current()) error.value = errorMessage(value) }
  finally { if (current()) loading.value = false }
}
function openAction(item: AdminActivity) {
  if (submitting.value || loading.value) return
  selected.value = item
  reason.value = ''
  dialogError.value = ''
  dialogOpen.value = true
}
async function applyAction() {
  if (submitting.value || !selected.value) return
  if (!reason.value.trim()) { dialogError.value = '请填写操作原因。'; return }
  const current = begin()
  const item = selected.value
  submitting.value = true
  dialogError.value = ''
  try {
    if (item.moderation === 'removed') await adminApi.restoreActivity(item.id, reason.value.trim())
    else await adminApi.removeActivity(item.id, reason.value.trim())
    if (!current()) return
    dialogOpen.value = false
    selected.value = null
    reason.value = ''
    ElMessage.success('活动状态已更新，已保存操作记录并生成站内通知。')
  } catch (value) { if (current()) dialogError.value = errorMessage(value) }
  finally { if (current()) submitting.value = false }
  if (current() && !dialogOpen.value) await load(true)
}
async function loadHistory() {
  if (!detail.value) return
  const current = beginHistory()
  historyLoading.value = true
  historyError.value = ''
  history.value = []
  try {
    const result = await adminApi.activityOperations(detail.value.id, historyOffset.value)
    if (!current()) return
    history.value = result.items
    historyMore.value = result.hasMore
  } catch (value) { if (current()) historyError.value = errorMessage(value) }
  finally { if (current()) historyLoading.value = false }
}
function openDetail(item: AdminActivity) {
  detail.value = item
  historyOffset.value = 0
  void loadHistory()
}
function closeDetail() { beginHistory(); detail.value = null; history.value = []; historyLoading.value = false }
function changePage(back: boolean) { offset.value = Math.max(0, offset.value + (back ? -20 : 20)); void load() }
function changeHistory(back: boolean) { historyOffset.value = Math.max(0, historyOffset.value + (back ? -20 : 20)); void loadHistory() }
onMounted(() => load())
</script>

<template>
  <section>
    <h1>活动管理</h1>
    <p class="page-description">
      查看已发布与已取消活动，按原因下架或恢复。恢复不改变原报名时间和名额。
    </p>
    <div class="panel">
      <div class="toolbar">
        <div class="filters">
          <el-input
            v-model="keyword"
            placeholder="搜索活动标题"
            aria-label="活动标题"
            :maxlength="100"
            :disabled="submitting"
            style="width: 240px"
            @keyup.enter="load(true)"
          />
          <el-select
            v-model="status"
            aria-label="活动展示状态"
            :disabled="submitting"
            style="width: 140px"
            @change="load(true)"
          >
            <el-option
              label="全部状态"
              value="all"
            />
            <el-option
              label="正常展示"
              value="normal"
            />
            <el-option
              label="已下架"
              value="removed"
            />
          </el-select>
          <el-button
            :disabled="loading || submitting"
            @click="load(true)"
          >
            查询
          </el-button>
        </div>
        <el-button
          :disabled="loading || submitting"
          @click="load()"
        >
          刷新
        </el-button>
      </div>
      <el-alert
        v-if="error"
        class="form-error"
        :title="error"
        type="error"
        :closable="false"
      />
      <el-table
        v-loading="loading"
        :data="items"
        row-key="id"
        empty-text="暂无符合条件的活动"
      >
        <el-table-column
          label="活动 / 发起人"
          min-width="250"
        >
          <template #default="{ row }">
            <strong>{{ row.title }}</strong><p class="muted">
              {{ row.organizerName || '未设置名称' }}
            </p>
          </template>
        </el-table-column>
        <el-table-column
          label="开始 / 结束时间"
          min-width="210"
        >
          <template #default="{ row }">
            {{ formatDate(row.startsAt) }}<p class="muted">
              {{ formatDate(row.endsAt) }}
            </p>
          </template>
        </el-table-column>
        <el-table-column
          label="状态"
          min-width="130"
        >
          <template #default="{ row }">
            <el-tag :type="row.moderation === 'removed' ? 'danger' : 'success'">
              {{ row.moderation === 'removed' ? '已下架' : '正常展示' }}
            </el-tag>
            <p
              v-if="row.lifecycle === 'cancelled'"
              class="muted"
            >
              发起人已取消
            </p>
          </template>
        </el-table-column>
        <el-table-column
          label="操作"
          width="200"
          fixed="right"
        >
          <template #default="{ row }">
            <el-button
              text
              :disabled="loading || submitting"
              @click="openDetail(row)"
            >
              详情与记录
            </el-button>
            <el-button
              text
              :type="row.moderation === 'removed' ? 'primary' : 'danger'"
              :disabled="loading || submitting"
              @click="openAction(row)"
            >
              {{ row.moderation === 'removed' ? '恢复' : '下架' }}
            </el-button>
          </template>
        </el-table-column>
      </el-table>
      <div class="pagination">
        <span>共 {{ total }} 条</span>
        <el-button
          :disabled="offset === 0 || loading || submitting"
          @click="changePage(true)"
        >
          上一页
        </el-button>
        <el-button
          :disabled="!hasMore || loading || submitting"
          @click="changePage(false)"
        >
          下一页
        </el-button>
      </div>
    </div>
    <el-dialog
      v-model="dialogOpen"
      :title="selected?.moderation === 'removed' ? '恢复活动' : '下架活动'"
      width="520px"
      :close-on-click-modal="false"
      :close-on-press-escape="!submitting"
      :show-close="!submitting"
      destroy-on-close
      @closed="selected = null; reason = ''"
    >
      <strong>{{ selected?.title }}</strong>
      <p class="muted">
        {{ selected?.moderation === 'removed' ? '恢复只重新展示活动。原已截止或取消的活动不会重新开放报名。' : '下架后停止公开展示、报名和新增评论点评，保留历史记录。' }} 当前有效报名者会收到站内通知。
      </p>
      <el-alert
        v-if="dialogError"
        class="form-error"
        :title="dialogError"
        type="error"
        :closable="false"
      />
      <el-form
        label-position="top"
        @submit.prevent="applyAction"
      >
        <el-form-item label="操作原因（必填）">
          <el-input
            v-model="reason"
            type="textarea"
            :rows="4"
            :maxlength="1000"
            show-word-limit
            :disabled="submitting"
          />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button
          :disabled="submitting"
          @click="dialogOpen = false"
        >
          取消
        </el-button>
        <el-button
          :type="selected?.moderation === 'removed' ? 'primary' : 'danger'"
          :loading="submitting"
          @click="applyAction"
        >
          确认{{ selected?.moderation === 'removed' ? '恢复' : '下架' }}
        </el-button>
      </template>
    </el-dialog>
    <el-dialog
      :model-value="Boolean(detail)"
      title="活动详情与操作记录"
      width="720px"
      @close="closeDetail"
    >
      <template v-if="detail">
        <h2>{{ detail.title }}</h2>
        <p class="feedback-content">
          {{ detail.description }}
        </p>
        <p>地点：{{ detail.location }}</p>
        <p>{{ detail.feeType === 'free' ? '免费活动' : `收费活动 ¥${((detail.feeAmountCents ?? 0) / 100).toFixed(2)}` }}</p>
        <h3>下架与恢复记录</h3>
        <el-alert
          v-if="historyError"
          :title="historyError"
          type="error"
          :closable="false"
        />
        <el-button
          v-if="historyError"
          :disabled="historyLoading"
          @click="loadHistory"
        >
          重试
        </el-button>
        <p
          v-if="historyLoading"
          role="status"
        >
          正在加载记录…
        </p>
        <p
          v-else-if="!historyError && !history.length"
          class="muted"
        >
          暂无下架或恢复记录
        </p>
        <article
          v-for="item in history"
          :key="item.id"
          class="operation"
        >
          <strong>{{ item.action === 'remove' ? '下架' : '恢复' }} · {{ item.actorName || '管理员' }}</strong>
          <p class="feedback-content">
            {{ item.reason }}
          </p>
          <span class="muted">{{ formatDate(item.createdAt) }}</span>
        </article>
        <div class="pagination">
          <el-button
            :disabled="historyOffset === 0 || historyLoading"
            @click="changeHistory(true)"
          >
            上一页
          </el-button>
          <el-button
            :disabled="!historyMore || historyLoading"
            @click="changeHistory(false)"
          >
            下一页
          </el-button>
        </div>
      </template>
    </el-dialog>
  </section>
</template>

<style scoped>
.operation { padding: 16px 0; border-bottom: 1px solid var(--huiju-border); }
</style>
