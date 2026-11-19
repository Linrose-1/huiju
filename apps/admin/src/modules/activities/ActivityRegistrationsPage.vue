<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRoute } from 'vue-router'
import { adminApi, errorMessage, formatDate, type AdminActivity, type ActivityRegistration, type ActivityReport } from '../../services/admin'
import { useRequestScope } from '../../services/request-scope'
import ActivityStatus from './ActivityStatus.vue'

const route = useRoute()
const id = String(route.params.id)
const detail = ref<AdminActivity | null>(null)
const detailLoading = ref(false), detailError = ref('')
const report = ref<ActivityReport | null>(null)
const reportLoading = ref(false), reportError = ref('')
const registrations = ref<ActivityRegistration[]>([])
const registrationOffset = ref(0), registrationTotal = ref(0), registrationMore = ref(false)
const registrationLoading = ref(false), registrationError = ref('')
const registrationStatus = ref<'all' | 'active' | 'cancelled'>('all')
const registrationCounts = ref<Partial<Record<typeof registrationStatus.value, number>>>({})
const activeCount = computed(() => registrationCounts.value.active ?? report.value?.activeRegistrations)
const cancelledCount = computed(() => {
  const { all, cancelled } = registrationCounts.value
  if (cancelled !== undefined) return cancelled
  if (all !== undefined && activeCount.value !== undefined && all >= activeCount.value) return all - activeCount.value
  return undefined
})
let requestedRegistrationOffset = 0
const selected = ref<ActivityRegistration | null>(null)
const answersOpen = ref(false)
const beginDetail = useRequestScope(), beginReport = useRequestScope(), beginRegistrations = useRequestScope()

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

async function loadRegistrations(reset = false) {
  if (reset) {
    requestedRegistrationOffset = 0
    registrationOffset.value = 0
    registrations.value = []
    registrationTotal.value = 0
    registrationMore.value = false
  }
  const target = requestedRegistrationOffset
  const status = registrationStatus.value
  const current = beginRegistrations()
  registrationLoading.value = true
  registrationError.value = ''
  try {
    const result = await adminApi.activityRegistrations(id, target, status)
    if (!current()) return
    registrationOffset.value = target
    registrations.value = result.items
    registrationTotal.value = result.total
    registrationCounts.value[status] = result.total
    registrationMore.value = result.hasMore
  } catch (value) {
    if (current()) registrationError.value = errorMessage(value)
  } finally {
    if (current()) registrationLoading.value = false
  }
}
function registrationPage(back: boolean) {
  requestedRegistrationOffset = Math.max(0, registrationOffset.value + (back ? -40 : 40))
  void loadRegistrations()
}
async function load() {
  const current = beginDetail()
  detailLoading.value = true
  detailError.value = ''
  try {
    const activity = await adminApi.activityDetail(id)
    if (!current()) return
    detail.value = activity
    void loadReport()
    void loadRegistrations()
  } catch (value) {
    if (current()) detailError.value = errorMessage(value)
  } finally {
    if (current()) detailLoading.value = false
  }
}
function openAnswers(row: ActivityRegistration) {
  selected.value = row
  answersOpen.value = true
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
      <span aria-hidden="true">›</span>
      <router-link
        class="activity-link"
        :to="{ name: 'activity-detail', params: { id }, query: route.query }"
      >
        活动详情
      </router-link>
      <span aria-hidden="true">›</span><span>报名名单</span>
    </nav>
    <header class="activity-page-header">
      <div>
        <h1>报名名单</h1>
        <template v-if="detail">
          <div class="actions">
            <strong>{{ detail.title }}</strong>
            <ActivityStatus :activity="detail" />
          </div>
          <p class="muted registration-context">
            {{ formatDate(detail.startsAt) }} 至 {{ formatDate(detail.endsAt) }} · {{ detail.location }}
          </p>
        </template>
      </div>
      <router-link
        class="el-button"
        :to="{ name: 'activity-detail', params: { id }, query: route.query }"
      >
        返回活动详情
      </router-link>
    </header>
    <div
      v-if="detailError"
      class="panel activity-state"
    >
      <el-alert
        :title="detailError"
        type="error"
        :closable="false"
      />
      <el-button @click="load">
        重试
      </el-button>
    </div>
    <p
      v-if="detailLoading"
      class="panel muted"
      role="status"
    >
      正在加载活动…
    </p>
    <template v-if="detail">
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
        class="panel activity-report registrations-report"
        aria-label="报名与到场统计"
      >
        <div><strong>{{ report.activeRegistrations }}</strong><span>有效报名</span></div>
        <div><strong>{{ report.attendedMembers }}</strong><span>已到场</span></div>
      </section>
      <section
        class="panel activity-table-panel"
        aria-label="报名记录"
      >
        <el-tabs
          v-model="registrationStatus"
          class="registration-tabs"
          @tab-change="loadRegistrations(true)"
        >
          <el-tab-pane
            :label="registrationCounts.all === undefined ? '全部' : '全部 ' + registrationCounts.all"
            name="all"
          />
          <el-tab-pane
            :label="activeCount === undefined ? '有效报名' : '有效报名 ' + activeCount"
            name="active"
          />
          <el-tab-pane
            :label="cancelledCount === undefined ? '已取消' : '已取消 ' + cancelledCount"
            name="cancelled"
          />
        </el-tabs>
        <div
          v-if="registrationError"
          class="activity-list-error"
        >
          <el-alert
            :title="registrationError"
            type="error"
            :closable="false"
          />
          <el-button
            :disabled="registrationLoading"
            @click="loadRegistrations()"
          >
            重试
          </el-button>
        </div>
        <el-table
          v-loading="registrationLoading"
          :data="registrations"
          row-key="id"
          :empty-text="registrationError ? '报名名单暂未加载' : '暂无报名记录'"
        >
          <el-table-column
            label="用户 / 编号"
            min-width="162"
          >
            <template #default="{ row }">
              <strong>{{ row.displayName || '—' }}</strong>
              <p class="muted activity-secondary">
                {{ row.memberNumber }}
              </p>
            </template>
          </el-table-column>
          <el-table-column
            prop="contactPhone"
            label="本次联系手机号"
            min-width="150"
          />
          <el-table-column
            label="报名状态"
            min-width="104"
          >
            <template #default="{ row }">
              <el-tag :type="row.status === 'active' ? 'success' : 'warning'">
                {{ row.status === 'active' ? '有效报名' : '已取消' }}
              </el-tag>
            </template>
          </el-table-column>
          <el-table-column
            label="到场状态"
            min-width="104"
          >
            <template #default="{ row }">
              <el-tag :type="row.attended ? 'success' : 'info'">
                {{ row.attended ? '已到场' : '未到场' }}
              </el-tag>
            </template>
          </el-table-column>
          <el-table-column
            label="报名时间"
            min-width="172"
          >
            <template #default="{ row }">
              {{ formatDate(row.registeredAt) }}
            </template>
          </el-table-column>
          <el-table-column
            label="操作"
            width="108"
            fixed="right"
          >
            <template #default="{ row }">
              <el-button
                link
                type="primary"
                @click="openAnswers(row)"
              >
                查看答案
              </el-button>
            </template>
          </el-table-column>
        </el-table>
        <div class="pagination activity-pagination">
          <span>共 {{ registrationTotal }} 条 · 第 {{ registrationOffset / 40 + 1 }} 页</span>
          <div class="actions">
            <el-button
              :disabled="registrationLoading || !registrationOffset"
              @click="registrationPage(true)"
            >
              上一页
            </el-button>
            <el-button
              :disabled="registrationLoading || !registrationMore"
              @click="registrationPage(false)"
            >
              下一页
            </el-button>
          </div>
        </div>
        <p class="muted registration-note">
          {{ detail.lifecycle === 'cancelled' ? '活动已取消，原报名记录保留，不计入到场。' : '到场由活动发起人标记。' }}
        </p>
      </section>
    </template>

    <el-dialog
      v-model="answersOpen"
      title="自定义报名答案"
      width="540px"
      destroy-on-close
      @closed="selected = null"
    >
      <template v-if="selected">
        <p class="muted registration-context">
          {{ detail?.title }}
        </p>
        <div class="actions answer-identity">
          <strong>{{ selected.displayName || '—' }}</strong>
          <span class="muted">{{ selected.memberNumber }}</span>
          <el-tag :type="selected.status === 'active' ? 'success' : 'warning'">
            {{ selected.status === 'active' ? '有效报名' : '已取消' }}
          </el-tag>
          <el-tag :type="selected.attended ? 'success' : 'info'">
            {{ selected.attended ? '已到场' : '未到场' }}
          </el-tag>
        </div>
        <dl
          v-if="selected.answers.length"
          class="answer-list"
        >
          <div
            v-for="answer in selected.answers"
            :key="answer.questionId"
          >
            <dt>{{ answer.prompt }}</dt>
            <dd>{{ (Array.isArray(answer.answer) ? answer.answer.join('、') : answer.answer) || '—' }}</dd>
          </div>
        </dl>
        <p
          v-else
          class="muted"
        >
          暂无自定义报名答案。
        </p>
        <dl class="answer-times muted">
          <dt>报名</dt><dd>{{ formatDate(selected.registeredAt) }}</dd>
          <template v-if="selected.cancelledAt">
            <dt>取消</dt><dd>{{ formatDate(selected.cancelledAt) }}</dd>
          </template>
          <template v-if="selected.attendedAt">
            <dt>到场</dt><dd>{{ formatDate(selected.attendedAt) }}</dd>
          </template>
        </dl>
      </template>
      <template #footer>
        <el-button
          type="primary"
          @click="answersOpen = false"
        >
          完成
        </el-button>
      </template>
    </el-dialog>
  </section>
</template>

<style scoped>
.registration-context { margin: 5px 0 0; font-size: 13px; }
.registrations-report { grid-template-columns: repeat(2, minmax(0, 1fr)); }
.registration-tabs { padding: 0 16px; }
.registration-tabs :deep(.el-tabs__header) { margin-bottom: 0; }
.registration-tabs :deep(.el-tabs__nav-wrap::after) { background: var(--huiju-border); height: 1px; }
.registration-note { margin: 0; padding: 10px 16px; border-top: 1px solid var(--huiju-border); font-size: 13px; }
.answer-identity { padding: 12px 0; font-size: 14px; }
.answer-list, .answer-times { margin: 0; }
.answer-list > div, .answer-times { padding: 12px 0; border-top: 1px solid var(--huiju-border); }
.answer-list dt { font-weight: 600; overflow-wrap: anywhere; }
.answer-list dd { margin: 5px 0 0; white-space: pre-wrap; overflow-wrap: anywhere; }
.answer-times { display: grid; grid-template-columns: max-content minmax(0, 1fr); gap: 4px 12px; }
.answer-times dd { margin: 0; }
</style>
