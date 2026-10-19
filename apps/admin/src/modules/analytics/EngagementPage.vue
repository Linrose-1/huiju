<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useRoute } from 'vue-router'
import { adminApi, errorMessage, formatDate, type AnalyticsMember, type EngagementQuery, type MemberDetail, type MemberSummary, type AnalyticsEvent } from '../../services/admin'
import { useRequestScope } from '../../services/request-scope'
const route = useRoute()
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
const detail = ref<MemberDetail | null>(null), detailOpen = ref(false), detailLoading = ref(false), detailError = ref(''), selectedId = ref('')
const events = ref<AnalyticsEvent[]>([]), eventOffset = ref(0), eventMore = ref(false), eventLoading = ref(false), eventError = ref('')
const beginEvents = useRequestScope()
async function loadEvents() {
  const current = beginEvents(); eventLoading.value = true; eventError.value = ''; events.value = []
  try { const value = await adminApi.engagementEvents(selectedId.value, applied.value.days, eventOffset.value); if (current()) { events.value = value.items; eventMore.value = value.hasMore } }
  catch (e) { if (current()) eventError.value = errorMessage(e) }
  finally { if (current()) eventLoading.value = false }
}
function eventPage(back: boolean) { eventOffset.value = Math.max(0, eventOffset.value + (back ? -40 : 40)); void loadEvents() }
const begin = useRequestScope(), beginExport = useRequestScope(), beginDetail = useRequestScope()
async function load(reset = false) {
  if (reset) { applied.value = { ...form.value, inviterId: inviter.value.trim() || undefined, offset: 0 } }
  const current = begin(); loading.value = true; error.value = ''; items.value = []
  try { const result = await adminApi.engagement(applied.value); if (current()) { items.value = result.items; total.value = result.total; more.value = result.hasMore } }
  catch (e) { if (current()) error.value = errorMessage(e) }
  finally { if (current()) loading.value = false }
}
function page(back: boolean) { applied.value.offset = Math.max(0, applied.value.offset + (back ? -40 : 40)); void load() }
async function exportRows() {
  if (exporting.value || loading.value) return
  const current = beginExport(); exporting.value = true; error.value = ''
  try { const csv = await adminApi.exportEngagement({ ...applied.value, offset: 0 }); if (!current()) return; const url = globalThis.URL.createObjectURL(new globalThis.Blob([csv], { type: 'text/csv;charset=utf-8' })); const link = globalThis.document.createElement('a'); link.href = url; link.download = `会员活跃-${applied.value.days}天.csv`; link.click(); globalThis.URL.revokeObjectURL(url) }
  catch (e) { if (current()) error.value = errorMessage(e) }
  finally { if (current()) exporting.value = false }
}
async function showMember(id: string) { const current = beginDetail(); selectedId.value = id; eventOffset.value = 0; void loadEvents(); detailOpen.value = true; detail.value = null; detailLoading.value = true; detailError.value = ''
  try { const value = await adminApi.member(id); if (current()) detail.value = value }
  catch (e) { if (current()) detailError.value = errorMessage(e) }
  finally { if (current()) detailLoading.value = false }
}
function closeDetail() { beginEvents(); events.value = []; eventLoading.value = false; beginDetail(); detail.value = null; detailLoading.value = false }
onMounted(() => load(true))
</script>
<template>
  <section>
    <h1>会员活跃明细</h1><p class="page-description">
      按周期内行为统计，报名取消后仍保留行为；长期未参与与完全沉默固定按近30天判断。
    </p>
    <div class="panel">
      <form
        class="filters"
        @submit.prevent="load(true)"
      >
        <el-select
          v-model="form.days"
          aria-label="统计周期"
          style="width: 120px"
        >
          <el-option
            :value="7"
            label="近7天"
          /><el-option
            :value="30"
            label="近30天"
          />
        </el-select><el-select
          v-model="form.behavior"
          aria-label="活跃行为"
          style="width: 160px"
        >
          <el-option
            v-for="v in choices"
            :key="v.value"
            :value="v.value"
            :label="v.label"
          />
        </el-select><el-select
          v-model="form.profile"
          aria-label="资料状态"
          style="width: 160px"
        >
          <el-option
            value="all"
            label="全部资料状态"
          /><el-option
            value="complete"
            label="已完善"
          /><el-option
            value="incomplete"
            label="未完善"
          />
        </el-select><el-select
          v-model="inviter"
          filterable
          remote
          clearable
          :remote-method="searchInviters"
          :loading="inviterLoading"
          placeholder="搜索直接邀请人的编号或名称"
          aria-label="直接邀请人"
          style="width: 280px"
        >
          <el-option
            v-for="member in inviterOptions"
            :key="member.id"
            :value="member.id"
            :label="(member.displayName || '未设置名称') + ' · ' + member.memberNumber"
          /><template #footer>
            <el-button
              v-if="inviterMore"
              text
              :loading="inviterLoading"
              @click="moreInviters"
            >
              加载更多匹配会员
            </el-button><p v-if="inviterError">
              {{ inviterError }}
            </p><el-button
              v-if="inviterError"
              text
              :disabled="inviterLoading"
              @click="searchInviters(inviterSearch)"
            >
              重试
            </el-button>
          </template>
        </el-select><el-button
          native-type="submit"
          type="primary"
          :disabled="loading || exporting"
        >
          查询
        </el-button><el-button
          :loading="exporting"
          :disabled="loading"
          @click="exportRows"
        >
          导出当前筛选
        </el-button>
      </form>
      <el-alert
        v-if="error"
        :title="error"
        type="error"
        :closable="false"
      /><el-button
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
        style="margin-top: 16px"
      >
        <el-table-column
          prop="memberNumber"
          label="会员编号"
          min-width="170"
        /><el-table-column
          label="用户名称"
          min-width="120"
        >
          <template #default="{ row }">
            <el-button
              text
              type="primary"
              @click="showMember(row.id)"
            >
              {{ row.displayName || '未设置名称' }}
            </el-button>
          </template>
        </el-table-column><el-table-column
          v-for="v in [{key:'browse',label:'浏览'},{key:'register',label:'报名'},{key:'attend',label:'到场'},{key:'publish',label:'发起'},{key:'comment',label:'评论'},{key:'review',label:'点评'}]"
          :key="v.key"
          :prop="v.key"
          :label="v.label + '次数'"
          min-width="95"
        /><el-table-column
          label="最近活跃"
          min-width="180"
        >
          <template #default="{ row }">
            {{ row.lastActiveAt ? formatDate(row.lastActiveAt) : '暂无行为记录' }}
          </template>
        </el-table-column>
      </el-table>
      <div class="pagination">
        <span>共 {{ total }} 位会员</span><el-button
          :disabled="loading || exporting || !applied.offset"
          @click="page(true)"
        >
          上一页
        </el-button><el-button
          :disabled="loading || exporting || !more"
          @click="page(false)"
        >
          下一页
        </el-button>
      </div>
    </div>
    <el-drawer
      v-model="detailOpen"
      title="会员详情"
      size="min(640px, 100%)"
      @close="closeDetail"
    >
      <p
        v-if="detailLoading"
        role="status"
      >
        正在加载…
      </p><el-alert
        v-if="detailError"
        :title="detailError"
        type="error"
        :closable="false"
      /><el-button
        v-if="detailError"
        @click="showMember(selectedId)"
      >
        重试
      </el-button><template v-if="detail">
        <h2>{{ detail.displayName || detail.memberNumber }}</h2><el-descriptions
          :column="1"
          border
        >
          <el-descriptions-item label="会员编号">
            {{ detail.memberNumber }}
          </el-descriptions-item><el-descriptions-item label="联系方式">
            {{ detail.boundPhone || '—' }}
          </el-descriptions-item><el-descriptions-item label="入会时间">
            {{ formatDate(detail.createdAt) }}
          </el-descriptions-item><el-descriptions-item label="资源">
            {{ detail.resources || '—' }}
          </el-descriptions-item><el-descriptions-item label="需求">
            {{ detail.needs || '—' }}
          </el-descriptions-item>
        </el-descriptions>
      </template><h3>本周期行为记录</h3><el-alert
        v-if="eventError"
        :title="eventError"
        type="error"
        :closable="false"
      /><el-button
        v-if="eventError"
        @click="loadEvents"
      >
        重试
      </el-button><el-table
        v-loading="eventLoading"
        :data="events"
        empty-text="本周期暂无行为记录"
      >
        <el-table-column
          label="行为"
          width="100"
        >
          <template #default="{ row }">
            {{ choices.find(v => v.value === row.behavior)?.label || row.behavior }}
          </template>
        </el-table-column><el-table-column
          prop="activityTitle"
          label="活动"
        /><el-table-column
          label="时间"
          min-width="170"
        >
          <template #default="{ row }">
            {{ formatDate(row.occurredAt) }}
          </template>
        </el-table-column>
      </el-table><div class="pagination">
        <el-button
          :disabled="!eventOffset || eventLoading"
          @click="eventPage(true)"
        >
          上一页
        </el-button><el-button
          :disabled="!eventMore || eventLoading"
          @click="eventPage(false)"
        >
          下一页
        </el-button>
      </div>
    </el-drawer>
  </section>
</template>
