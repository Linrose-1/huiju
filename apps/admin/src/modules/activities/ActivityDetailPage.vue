<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useRoute } from 'vue-router'
import { ElMessage } from 'element-plus'
import { adminApi, errorMessage, formatDate, type AdminActivity, type ActivityOperation, type ActivityReport } from '../../services/admin'
import { useRequestScope } from '../../services/request-scope'
import ActivityStatus from './ActivityStatus.vue'

const route = useRoute()
const id = String(route.params.id)
const detail = ref<AdminActivity | null>(null)
const detailLoading = ref(false), detailError = ref('')
const report = ref<ActivityReport | null>(null)
const reportLoading = ref(false), reportError = ref('')
const history = ref<ActivityOperation[]>([])
const historyOffset = ref(0), historyMore = ref(false), historyLoading = ref(false), historyError = ref('')
let requestedHistoryOffset = 0
const dialogOpen = ref(false), reason = ref(''), dialogError = ref(''), submitting = ref(false)
const beginDetail = useRequestScope(), beginReport = useRequestScope(), beginHistory = useRequestScope(), beginAction = useRequestScope()
const operationNames: Record<string, string> = {
  publish: '发布活动', cancel: '取消活动', remove: '下架活动',
  restore: '恢复活动', update_consultation_contact: '修改咨询联系方式',
}

async function loadDetail() {
  const current = beginDetail()
  detailLoading.value = true
  detailError.value = ''
  try {
    const activity = await adminApi.activityDetail(id)
    if (current()) detail.value = activity
    return current()
  } catch (value) {
    if (current()) detailError.value = errorMessage(value)
    return false
  } finally {
    if (current()) detailLoading.value = false
  }
}
async function loadReport() {
  const current = beginReport()
  reportLoading.value = true
  reportError.value = ''
  try {
    const result = await adminApi.activityReport(id)
    if (current()) report.value = result
  } catch (value) {
    if (current()) reportError.value = errorMessage(value)
  } finally {
    if (current()) reportLoading.value = false
  }
}
async function loadHistory() {
  const current = beginHistory()
  const target = requestedHistoryOffset
  historyLoading.value = true
  historyError.value = ''
  try {
    const result = await adminApi.activityOperations(id, target)
    if (!current()) return
    history.value = result.items
    historyOffset.value = target
    historyMore.value = result.hasMore
  } catch (value) {
    if (current()) historyError.value = errorMessage(value)
  } finally {
    if (current()) historyLoading.value = false
  }
}
function changeHistory(back: boolean) {
  requestedHistoryOffset = Math.max(0, historyOffset.value + (back ? -20 : 20))
  void loadHistory()
}
async function load() {
  if (await loadDetail()) await Promise.all([loadReport(), loadHistory()])
}
function openAction() {
  reason.value = ''
  dialogError.value = ''
  dialogOpen.value = true
}
async function applyAction() {
  if (!detail.value || submitting.value) return
  const trimmed = reason.value.trim()
  if (!trimmed) {
    dialogError.value = '请填写操作原因。'
    return
  }
  const current = beginAction()
  submitting.value = true
  dialogError.value = ''
  try {
    if (detail.value.moderation === 'removed') await adminApi.restoreActivity(id, trimmed)
    else await adminApi.removeActivity(id, trimmed)
    if (!current()) return
    dialogOpen.value = false
    ElMessage.success('活动状态已更新，已保存操作记录并生成站内通知。')
    requestedHistoryOffset = 0
    await Promise.all([loadDetail(), loadHistory()])
  } catch (value) {
    if (current()) dialogError.value = errorMessage(value)
  } finally {
    if (current()) submitting.value = false
  }
}
onMounted(load)
</script>

<template>
  <section class="activity-admin">
    <nav
      class="activity-crumb muted"
      aria-label="当前位置"
    >
      <router-link
        class="activity-link"
        :to="{ name: 'activity-list', query: route.query }"
      >
        活动管理
      </router-link>
      <span aria-hidden="true">›</span><span>活动详情</span>
    </nav>
    <div
      v-if="detailError"
      class="panel activity-state"
    >
      <el-alert
        :title="detailError"
        type="error"
        :closable="false"
      />
      <el-button
        :disabled="detailLoading"
        @click="load"
      >
        重试
      </el-button>
    </div>
    <p
      v-if="detailLoading && !detail"
      class="panel muted"
      role="status"
    >
      正在加载活动详情…
    </p>
    <template v-if="detail">
      <header class="activity-page-header">
        <div>
          <h1>{{ detail.title }}</h1>
          <ActivityStatus :activity="detail" />
        </div>
        <div class="actions detail-actions">
          <el-button
            :type="detail.moderation === 'removed' ? 'primary' : 'danger'"
            plain
            :disabled="!!detailError || detailLoading || submitting"
            @click="openAction"
          >
            {{ detail.moderation === 'removed' ? '恢复活动' : '下架活动' }}
          </el-button>
          <router-link
            class="el-button el-button--primary"
            :to="{ name: 'activity-registrations', params: { id }, query: route.query }"
          >
            查看报名名单
          </router-link>
        </div>
      </header>
      <div
        v-if="reportError"
        class="panel activity-state"
      >
        <el-alert
          :title="reportError"
          type="error"
          :closable="false"
        />
        <el-button
          :disabled="reportLoading"
          @click="loadReport"
        >
          重试统计
        </el-button>
      </div>
      <p
        v-if="reportLoading && !report"
        class="panel muted"
        role="status"
      >
        正在加载活动统计…
      </p>
      <section
        v-if="report"
        class="panel activity-report"
        aria-label="活动统计"
      >
        <div><strong>{{ report.activeRegistrations }}</strong><span>有效报名</span></div>
        <div><strong>{{ report.attendedMembers }}</strong><span>已到场</span></div>
        <div><strong>{{ report.visitors }}</strong><span>浏览人数</span></div>
        <div><strong>{{ report.views }}</strong><span>浏览次数</span></div>
      </section>

      <div class="activity-detail-grid">
        <section class="panel">
          <h2>活动概要</h2>
          <dl class="activity-fields">
            <dt>活动时间</dt><dd>{{ formatDate(detail.startsAt) }} 至 {{ formatDate(detail.endsAt) }}</dd>
            <dt>发起人</dt><dd>{{ detail.organizerName || '—' }}</dd>
            <dt>活动地点</dt><dd>{{ detail.location }}</dd>
            <dt>活动费用</dt><dd>{{ detail.feeType === 'free' ? '免费' : '¥' + ((detail.feeAmountCents ?? 0) / 100).toFixed(2) }}</dd>
            <template v-if="report">
              <dt>咨询联系方式</dt><dd>{{ report.consultationContact || '—' }}</dd>
              <dt>报名 / 浏览人数</dt><dd>{{ report.conversionRate === null ? '暂无浏览' : report.conversionRate.toFixed(1) + '%' }}</dd>
              <dt>点评评分</dt><dd>{{ report.averageScore === null ? '暂无评分' : report.averageScore.toFixed(1) }}（{{ report.reviewCount }} 条）</dd>
            </template>
          </dl>
          <div class="activity-description">
            <h2>活动介绍</h2>
            <p>{{ detail.description || '—' }}</p>
          </div>
        </section>
        <div class="activity-detail-side">
          <section class="panel">
            <h2>操作记录</h2>
            <div
              v-if="historyError"
              class="activity-state"
            >
              <el-alert
                :title="historyError"
                type="error"
                :closable="false"
              />
              <el-button
                :disabled="historyLoading"
                @click="loadHistory"
              >
                重试记录
              </el-button>
            </div>
            <p
              v-if="historyLoading"
              class="muted"
              role="status"
            >
              正在加载操作记录…
            </p>
            <p
              v-else-if="!historyError && !history.length"
              class="muted"
            >
              暂无操作记录
            </p>
            <ol
              v-if="history.length"
              class="activity-timeline"
            >
              <li
                v-for="item in history"
                :key="item.id"
              >
                <strong>{{ operationNames[item.action] || item.action }}</strong>
                <p class="muted activity-secondary">
                  {{ item.actorName || '—' }} · {{ formatDate(item.createdAt) }}
                </p>
                <p
                  v-if="item.reason"
                  class="operation-reason"
                >
                  {{ item.reason }}
                </p>
              </li>
            </ol>
            <div
              v-if="historyOffset || historyMore"
              class="pagination"
            >
              <el-button
                :disabled="historyLoading || !historyOffset"
                @click="changeHistory(true)"
              >
                上一页
              </el-button>
              <el-button
                :disabled="historyLoading || !historyMore"
                @click="changeHistory(false)"
              >
                下一页
              </el-button>
            </div>
          </section>
          <section class="panel">
            <h2>展示与报名</h2>
            <ActivityStatus :activity="detail" />
            <p
              v-if="detail.lifecycle === 'cancelled'"
              class="muted"
            >
              活动已取消，原报名记录保留，不计入到场。
            </p>
            <p
              v-else-if="detail.moderation === 'removed'"
              class="muted"
            >
              活动已停止公开展示与报名，历史记录保留。
            </p>
          </section>
        </div>
      </div>

      <el-dialog
        v-model="dialogOpen"
        :title="detail.moderation === 'removed' ? '恢复活动' : '下架活动'"
        :close-on-click-modal="false"
        :close-on-press-escape="!submitting"
        :show-close="!submitting"
        width="540px"
        destroy-on-close
      >
        <h2 class="moderation-title">
          {{ detail.title }}
        </h2>
        <p class="moderation-impact">
          {{ detail.moderation === 'removed' ? '恢复只重新展示活动，原已截止或取消的活动不会重新开放报名。' : '下架后停止公开展示、报名和新增评论点评，保留历史记录。' }}
          当前有效报名者会收到站内通知。
        </p>
        <el-alert
          v-if="dialogError"
          :title="dialogError"
          type="error"
          :closable="false"
          class="form-error"
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
              placeholder="填写原因，保存至操作记录"
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
            :type="detail.moderation === 'removed' ? 'primary' : 'danger'"
            :loading="submitting"
            @click="applyAction"
          >
            确认{{ detail.moderation === 'removed' ? '恢复' : '下架' }}
          </el-button>
        </template>
      </el-dialog>
    </template>
  </section>
</template>

<style scoped>
.detail-actions .el-button + .el-button { margin-left: 0; }
.activity-detail-grid { display: grid; grid-template-columns: minmax(0, 1.65fr) minmax(270px, 1fr); align-items: start; gap: 16px; }
.activity-detail-side { display: grid; min-width: 0; gap: 16px; }
.activity-fields { display: grid; grid-template-columns: max-content minmax(0, 1fr); gap: 12px 16px; font-size: 14px; margin: 0; }
.activity-fields dt { color: var(--huiju-muted); }
.activity-fields dd { margin: 0; overflow-wrap: anywhere; }
.activity-description { margin-top: 20px; padding-top: 16px; border-top: 1px solid var(--huiju-border); }
.activity-description p, .operation-reason { margin: 0; white-space: pre-wrap; overflow-wrap: anywhere; }
.activity-detail-side .activity-secondary { margin: 3px 0; }
.activity-timeline { list-style: none; padding-left: 9px; margin: 0; }
.activity-timeline li { position: relative; border-left: 1px solid var(--huiju-border); padding: 0 0 13px 15px; font-size: 14px; }
.activity-timeline li::before { content: ''; position: absolute; left: -4px; top: 5px; width: 7px; height: 7px; background: var(--huiju-green); border-radius: 50%; }
.moderation-title { overflow-wrap: anywhere; }
.moderation-impact { padding: 10px 12px; color: #78531d; background: #fbf4e6; border-radius: 8px; }
@media (max-width: 960px) { .activity-detail-grid { grid-template-columns: 1fr; } }
</style>
