<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useRoute } from 'vue-router'
import { adminApi, errorMessage, formatDate, type AnalyticsMember, type EngagementQuery, type MemberDetail, type MemberSummary, type AnalyticsEvent } from '../../services/admin'
import { useRequestScope } from '../../services/request-scope'
const route = useRoute()
const pageSize = 40
const choices = [{ value: 'all', label: '全部会员' }, { value: 'new', label: '新增会员' }, { value: 'converted', label: '浏览后报名会员' }, { value: 'browse', label: '浏览活跃' }, { value: 'participate', label: '参与活跃' }, { value: 'register', label: '报名' }, { value: 'attend', label: '到场' }, { value: 'publish', label: '发起' }, { value: 'comment', label: '评论' }, { value: 'review', label: '点评' }, { value: 'inactive', label: '长期未参与' }, { value: 'silent', label: '完全沉默' }]
const form = ref<EngagementQuery>({ days: route.query.days === '7' ? 7 : 30, behavior: choices.some(v => v.value === route.query.behavior) ? route.query.behavior as EngagementQuery['behavior'] : 'all', profile: 'all', offset: 0 })
const applied = ref({ ...form.value }), inviter = ref('')
const inviterOptions = ref<MemberSummary[]>([]), inviterSearch = ref(''), inviterOffset = ref(0), inviterMore = ref(false), inviterLoading = ref(false), inviterError = ref('')
const beginInviters = useRequestScope()
async function searchInviters(q: string, append = false) {
  if (append && inviterLoading.value) return
  if (!append) { inviterOffset.value = 0; inviterSearch.value = q.trim(); inviterOptions.value = [] }
  if (!inviterSearch.value) { beginInviters(); inviterMore.value = false; inviterLoading.value = false; inviterError.value = ''; return }
  const requestedOffset = append ? inviterOffset.value + 40 : 0
  const current = beginInviters(); inviterLoading.value = true; inviterError.value = ''
  try { const value = await adminApi.members({ q: inviterSearch.value, offset: requestedOffset }); if (current()) { inviterOffset.value = requestedOffset; inviterOptions.value = append ? [...inviterOptions.value, ...value.items] : value.items; inviterMore.value = value.hasMore } }
  catch (e) { if (current()) inviterError.value = errorMessage(e) }
  finally { if (current()) inviterLoading.value = false }
}
function moreInviters() { void searchInviters(inviterSearch.value, true) }
const items = ref<AnalyticsMember[]>([]), total = ref(0), more = ref(false), loading = ref(false), exporting = ref(false), error = ref('')
const detail = ref<MemberDetail | null>(null), detailOpen = ref(false), detailLoading = ref(false), detailError = ref('')
const selectedMember = ref<AnalyticsMember | null>(null)
const detailDays = ref<7 | 30>(30)
const events = ref<AnalyticsEvent[]>([]), eventOffset = ref(0), eventMore = ref(false), eventLoading = ref(false), eventError = ref('')
let requestedEventOffset = 0, requestedOffset = 0
const beginEvents = useRequestScope()
async function loadEvents() {
  const targetOffset = requestedEventOffset
  const current = beginEvents(); eventLoading.value = true; eventError.value = ''
  try { const value = await adminApi.engagementEvents(selectedMember.value?.id ?? '', detailDays.value, targetOffset); if (current()) { eventOffset.value = targetOffset; events.value = value.items; eventMore.value = value.hasMore } }
  catch (e) { if (current()) eventError.value = errorMessage(e) }
  finally { if (current()) eventLoading.value = false }
}
function eventPage(back: boolean) { requestedEventOffset = Math.max(0, eventOffset.value + (back ? -40 : 40)); void loadEvents() }
const begin = useRequestScope(), beginExport = useRequestScope(), beginDetail = useRequestScope()
async function load(reset = false) {
  if (reset) { applied.value = { ...form.value, inviterId: inviter.value.trim() || undefined, offset: 0 }; requestedOffset = 0; items.value = []; total.value = 0; more.value = false }
  const targetOffset = requestedOffset
  const current = begin(); loading.value = true; error.value = ''
  try { const result = await adminApi.engagement({ ...applied.value, offset: targetOffset }); if (current()) { applied.value.offset = targetOffset; items.value = result.items; total.value = result.total; more.value = result.hasMore } }
  catch (e) { if (current()) error.value = errorMessage(e) }
  finally { if (current()) loading.value = false }
}
function page(back: boolean) { requestedOffset = Math.max(0, applied.value.offset + (back ? -pageSize : pageSize)); void load() }
async function exportRows() {
  if (exporting.value || loading.value) return
  const current = beginExport(); exporting.value = true; error.value = ''
  try { const csv = await adminApi.exportEngagement({ ...applied.value, offset: 0 }); if (!current()) return; const url = globalThis.URL.createObjectURL(new globalThis.Blob([csv], { type: 'text/csv;charset=utf-8' })); const link = globalThis.document.createElement('a'); link.href = url; link.download = `会员活跃-${applied.value.days}天.csv`; link.click(); globalThis.URL.revokeObjectURL(url) }
  catch (e) { if (current()) error.value = errorMessage(e) }
  finally { if (current()) exporting.value = false }
}
async function loadMember(id: string) {
  const current = beginDetail()
  detailLoading.value = true
  detailError.value = ''
  try { const value = await adminApi.member(id); if (current()) detail.value = value }
  catch (e) { if (current()) detailError.value = errorMessage(e) }
  finally { if (current()) detailLoading.value = false }
}
function showMember(member: AnalyticsMember) {
  selectedMember.value = member
  detailDays.value = applied.value.days
  requestedEventOffset = 0
  eventOffset.value = 0
  events.value = []
  eventMore.value = false
  detail.value = null
  detailOpen.value = true
  void loadEvents()
  void loadMember(member.id)
}
function retryMember() {
  if (selectedMember.value) void loadMember(selectedMember.value.id)
}
function closeDetail() { beginEvents(); eventLoading.value = false; beginDetail(); detailLoading.value = false }
onMounted(() => load(true))
</script>
<template>
  <section>
    <h1>会员活跃</h1>
    <div class="engagement-intro">
      <p class="page-description">
        按周期查看会员行为。
      </p>
      <el-popover
        placement="bottom-start"
        trigger="click"
        :width="320"
        content="行为次数按所选周期统计，取消报名仍保留报名行为。长期未参与与完全沉默固定按近 30 天判断。最近活跃显示截至统计期末的最近一次行为。"
      >
        <template #reference>
          <el-button
            link
            type="primary"
          >
            统计口径
          </el-button>
        </template>
      </el-popover>
    </div>

    <form
      class="panel engagement-filters"
      @submit.prevent="load(true)"
    >
      <div class="engagement-filter">
        <span>统计周期</span>
        <el-radio-group
          v-model="form.days"
          aria-label="统计周期"
        >
          <el-radio-button :value="7">
            近7天
          </el-radio-button>
          <el-radio-button :value="30">
            近30天
          </el-radio-button>
        </el-radio-group>
      </div>
      <div class="engagement-filter">
        <label for="engagement-behavior">活跃行为</label>
        <el-select
          id="engagement-behavior"
          v-model="form.behavior"
        >
          <el-option
            v-for="choice in choices"
            :key="choice.value"
            :value="choice.value"
            :label="choice.label"
          />
        </el-select>
      </div>
      <div class="engagement-filter">
        <label for="engagement-profile">资料状态</label>
        <el-select
          id="engagement-profile"
          v-model="form.profile"
        >
          <el-option
            value="all"
            label="全部资料状态"
          />
          <el-option
            value="complete"
            label="已完善"
          />
          <el-option
            value="incomplete"
            label="未完善"
          />
        </el-select>
      </div>
      <div class="engagement-filter">
        <label for="engagement-inviter">直接邀请人</label>
        <el-select
          id="engagement-inviter"
          v-model="inviter"
          filterable
          remote
          clearable
          :remote-method="searchInviters"
          :loading="inviterLoading"
          placeholder="输入用户编号或名称"
        >
          <el-option
            v-for="member in inviterOptions"
            :key="member.id"
            :value="member.id"
            :label="(member.displayName || '未设置名称') + ' · ' + member.memberNumber"
          />
          <template #footer>
            <el-button
              v-if="inviterMore"
              text
              :loading="inviterLoading"
              @click="moreInviters"
            >
              加载更多匹配会员
            </el-button>
            <p v-if="inviterError">
              {{ inviterError }}
            </p>
            <el-button
              v-if="inviterError"
              text
              :disabled="inviterLoading"
              @click="searchInviters(inviterSearch)"
            >
              重试
            </el-button>
          </template>
        </el-select>
      </div>
      <el-button
        native-type="submit"
        type="primary"
        :disabled="loading || exporting"
      >
        查询
      </el-button>
    </form>

    <section class="panel engagement-results">
      <header class="engagement-results-header">
        <div class="engagement-results-title">
          <h2>会员列表</h2>
          <span class="muted">共 {{ total }} 位会员</span>
        </div>
        <el-button
          :loading="exporting"
          :disabled="loading"
          @click="exportRows"
        >
          导出当前筛选
        </el-button>
      </header>
      <el-alert
        v-if="error"
        :title="error"
        type="error"
        :closable="false"
      />
      <el-button
        v-if="error"
        :disabled="loading"
        @click="load()"
      >
        重试
      </el-button>
      <el-table
        v-loading="loading"
        :data="items"
        empty-text="暂无符合条件的会员"
      >
        <el-table-column
          prop="memberNumber"
          label="用户编号"
          min-width="112"
        />
        <el-table-column
          label="用户名称"
          min-width="120"
          show-overflow-tooltip
        >
          <template #default="{ row }">
            {{ row.displayName || '未设置名称' }}
          </template>
        </el-table-column>
        <el-table-column
          v-for="column in [{key:'browse',label:'浏览'},{key:'register',label:'报名'},{key:'attend',label:'到场'},{key:'publish',label:'发起'},{key:'comment',label:'评论'},{key:'review',label:'点评'}]"
          :key="column.key"
          :prop="column.key"
          :label="column.label"
          min-width="60"
          align="center"
        />
        <el-table-column
          label="最近活跃"
          min-width="162"
        >
          <template #default="{ row }">
            {{ row.lastActiveAt ? formatDate(row.lastActiveAt) : '暂无行为记录' }}
          </template>
        </el-table-column>
        <el-table-column
          label="操作"
          width="100"
          fixed="right"
        >
          <template #default="{ row }">
            <el-button
              link
              type="primary"
              :aria-label="`查看明细：${row.displayName || row.memberNumber}`"
              @click="showMember(row)"
            >
              查看明细
            </el-button>
          </template>
        </el-table-column>
      </el-table>
      <footer class="engagement-footer">
        <span class="muted">每页 {{ pageSize }} 条</span>
        <div class="engagement-page-controls">
          <el-button
            :disabled="loading || exporting || !applied.offset"
            @click="page(true)"
          >
            上一页
          </el-button>
          <span class="muted">第 {{ Math.floor(applied.offset / pageSize) + 1 }} / {{ Math.max(1, Math.ceil(total / pageSize)) }} 页</span>
          <el-button
            :disabled="loading || exporting || !more"
            @click="page(false)"
          >
            下一页
          </el-button>
        </div>
      </footer>
    </section>

    <el-drawer
      v-model="detailOpen"
      title="会员详情"
      size="min(640px, 100%)"
      @close="closeDetail"
    >
      <div
        v-if="selectedMember"
        class="engagement-member"
      >
        <h2>{{ selectedMember.displayName || selectedMember.memberNumber }}</h2>
        <p class="muted">
          用户编号 {{ selectedMember.memberNumber }}
        </p>
      </div>
      <section class="engagement-events">
        <header class="engagement-results-title">
          <h3>本周期行为记录</h3>
          <el-tag type="success">
            近{{ detailDays }}天
          </el-tag>
        </header>
        <el-alert
          v-if="eventError"
          :title="eventError"
          type="error"
          :closable="false"
        />
        <el-button
          v-if="eventError"
          :disabled="eventLoading"
          @click="loadEvents"
        >
          重试
        </el-button>
        <el-table
          v-loading="eventLoading"
          :data="events"
          empty-text="本周期暂无行为记录"
        >
          <el-table-column
            label="行为"
            width="78"
          >
            <template #default="{ row }">
              {{ row.behavior === 'browse' ? '浏览' : choices.find(v => v.value === row.behavior)?.label || row.behavior }}
            </template>
          </el-table-column>
          <el-table-column
            prop="activityTitle"
            label="活动"
            min-width="110"
          />
          <el-table-column
            label="时间"
            min-width="158"
          >
            <template #default="{ row }">
              {{ formatDate(row.occurredAt) }}
            </template>
          </el-table-column>
        </el-table>
        <div class="engagement-page-controls engagement-event-pagination">
          <el-button
            :disabled="!eventOffset || eventLoading"
            @click="eventPage(true)"
          >
            上一页
          </el-button>
          <el-button
            :disabled="!eventMore || eventLoading"
            @click="eventPage(false)"
          >
            下一页
          </el-button>
        </div>
      </section>

      <section class="engagement-profile">
        <h3>会员资料</h3>
        <p
          v-if="detailLoading"
          role="status"
        >
          正在加载会员资料…
        </p>
        <el-alert
          v-if="detailError"
          :title="detailError"
          type="error"
          :closable="false"
        />
        <el-button
          v-if="detailError"
          :disabled="detailLoading"
          @click="retryMember"
        >
          重试
        </el-button>
        <dl
          v-if="detail"
          class="engagement-profile-grid"
        >
          <div><dt>入会时间</dt><dd>{{ formatDate(detail.createdAt) }}</dd></div>
          <div><dt>联系方式</dt><dd>{{ detail.boundPhone || '—' }}</dd></div>
          <div><dt>资源</dt><dd>{{ detail.resources || '—' }}</dd></div>
          <div><dt>需求</dt><dd>{{ detail.needs || '—' }}</dd></div>
        </dl>
      </section>
    </el-drawer>
  </section>
</template>

<style scoped>
.engagement-intro,
.engagement-results-header,
.engagement-results-title,
.engagement-footer,
.engagement-page-controls {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 12px;
}

.engagement-intro { margin-bottom: 18px; }
.engagement-intro .page-description { margin: 0; }

.engagement-filters {
  display: grid;
  grid-template-columns: minmax(148px, auto) minmax(154px, 1fr) minmax(136px, 1fr) minmax(190px, 1.3fr) auto;
  align-items: start;
  gap: 14px;
  margin-bottom: 16px;
}

.engagement-filters > .el-button { align-self: end; }
.engagement-filter { display: grid; gap: 8px; min-width: 0; }
.engagement-filter > span,
.engagement-filter > label { font-size: 13px; font-weight: 600; }

.engagement-results { display: grid; gap: 14px; min-width: 0; }
.engagement-results-header,
.engagement-footer { justify-content: space-between; }
.engagement-results-title h2,
.engagement-results-title h3,
.engagement-member h2,
.engagement-profile h3 { margin: 0; }
.engagement-results-title h2 { font-size: 18px; }
.engagement-member h2 { font-size: 22px; }
.engagement-member p { margin: 6px 0 0; }
.engagement-results :deep(.el-table),
.engagement-events :deep(.el-table) { --el-table-header-bg-color: var(--el-fill-color-light); font-variant-numeric: tabular-nums; }

.engagement-events,
.engagement-profile { display: grid; gap: 12px; margin-top: 22px; }
.engagement-event-pagination { justify-content: flex-end; }
.engagement-profile { padding-top: 18px; border-top: 1px solid var(--el-border-color-light); }

.engagement-profile-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 1px;
  margin: 0;
  border: 1px solid var(--el-border-color-light);
  border-radius: 6px;
  background: var(--el-border-color-light);
  overflow: hidden;
}

.engagement-profile-grid > div {
  display: grid;
  grid-template-columns: 5.5em minmax(0, 1fr);
  background: var(--el-bg-color);
}

.engagement-profile-grid dt,
.engagement-profile-grid dd { margin: 0; padding: 10px; overflow-wrap: anywhere; }
.engagement-profile-grid dt { background: var(--el-fill-color-light); font-weight: 600; }
.engagement-profile-grid dd { white-space: pre-wrap; }

@media (max-width: 1050px) {
  .engagement-filters { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .engagement-filters > .el-button { justify-self: start; }
}

@media (max-width: 560px) {
  .engagement-filters,
  .engagement-profile-grid { grid-template-columns: minmax(0, 1fr); }
}
</style>
