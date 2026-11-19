<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { adminApi, errorMessage, type AnalyticsDashboard } from '../../services/admin'
import { useRequestScope } from '../../services/request-scope'
const days = ref<7 | 30>(30), loading = ref(false), error = ref(''), data = ref<AnalyticsDashboard | null>(null)
const router = useRouter(), begin = useRequestScope()
const labels: Record<string, string> = { newMembers: '新增会员', browsingMembers: '浏览活跃人数', participatingMembers: '参与活跃人数', registeredMembers: '报名人数', attendedMembers: '到场人数', publishedActivities: '发布活动数', anonymousViews: '匿名浏览次数', anonymousVisitors: '匿名浏览人数', inactiveMembers: '长期未参与人数', silentMembers: '完全沉默人数', convertedMembers: '浏览后报名人数', browseRegistrationRate: '浏览后报名转化率' }
const behaviors: Record<string, string> = { publish: '发起活动', register: '报名', attend: '到场', comment: '评论', review: '点评' }
const targets: Record<string, string> = { newMembers: 'new', convertedMembers: 'converted', browseRegistrationRate: 'converted', publishedActivities: 'publish', browsingMembers: 'browse', participatingMembers: 'participate', registeredMembers: 'register', attendedMembers: 'attend', inactiveMembers: 'inactive', silentMembers: 'silent' }
const metricGroups = [
  { title: '会员活跃', kind: 'membership', keys: ['newMembers', 'browsingMembers', 'participatingMembers', 'inactiveMembers', 'silentMembers'] },
  { title: '活动运营', kind: 'activity', keys: ['publishedActivities', 'registeredMembers', 'attendedMembers', 'convertedMembers', 'browseRegistrationRate', 'anonymousVisitors', 'anonymousViews'] },
]
const metrics = computed(() => new Map(data.value?.metrics.map(metric => [metric.key, metric])))
const series = [
  { key: 'browsingMembers' as const, label: '浏览活跃', color: '#3979a1', dash: '' },
  { key: 'participatingMembers' as const, label: '参与活跃', color: '#9b641f', dash: '6 3' },
  { key: 'newMembers' as const, label: '新增会员', color: '#247552', dash: '2 3' },
]
const max = computed(() => Math.max(1, ...(data.value?.trend.flatMap(v => [v.newMembers, v.browsingMembers, v.participatingMembers]) ?? [])))
const chartStep = computed(() => Math.ceil(max.value / 4))
const chartTicks = computed(() => [0, 1, 2, 3, 4].map(index => ({ y: 174 - index * 38, value: index * chartStep.value })))
const chartDates = computed(() => {
  const trend = data.value?.trend ?? []
  const last = trend.length - 1
  return trend.flatMap((row, index) => {
    const x = chartX(index, trend.length)
    if (index === 0 || index === last || index === Math.round(last / 3) || index === Math.round(last * 2 / 3)) {
      return [{ date: row.date, x, anchor: index === 0 ? 'start' : index === last ? 'end' : 'middle' }]
    }
    return []
  })
})
function chartX(index: number, count: number) { return 42 + index / Math.max(1, count - 1) * 574 }
function points(key: typeof series[number]['key']) {
  return data.value?.trend.map((row, index, list) => `${chartX(index, list.length)},${174 - row[key] / (chartStep.value * 4) * 152}`).join(' ') ?? ''
}
function value(key: string, current: number) { return key === 'browseRegistrationRate' ? (data.value?.metrics.find(v => v.key === 'browsingMembers')?.current ? `${current.toFixed(1)}%` : '暂无浏览') : current.toLocaleString() }
function change(metric: AnalyticsDashboard['metrics'][number]) { return metric.changePercent === null ? (metric.current > 0 ? '新增' : '无变化') : `${metric.changePercent > 0 ? '+' : ''}${metric.changePercent.toFixed(1)}%` }
function comparison(metric: AnalyticsDashboard['metrics'][number]) {
  const rate = metric.key === 'browseRegistrationRate'
  const previous = rate ? `${metric.previous.toFixed(1)}%` : metric.previous.toLocaleString()
  const delta = `${metric.delta > 0 ? '+' : ''}${Number(metric.delta.toFixed(1))}${rate ? '个百分点' : ''}`
  return `上期 ${previous} · 增减 ${delta} · ${change(metric)}`
}
function members(behavior: string) { void router.push({ path: '/engagement', query: { days: days.value, behavior } }) }
async function load() { const current = begin(); loading.value = true; error.value = ''; data.value = null
  try { const result = await adminApi.analytics(days.value); if (current()) data.value = result }
  catch (e) { if (current()) error.value = errorMessage(e) }
  finally { if (current()) loading.value = false }
}
onMounted(load)
</script>
<template>
  <section class="analytics">
    <header class="dashboard-heading">
      <div>
        <h1>运营看板</h1>
        <p
          v-if="data"
          class="dashboard-period muted"
        >
          <span>{{ data.startDate }} 至 {{ data.endDate }} · 北京时间</span>
          <span>对比前一个 {{ days }} 天周期</span>
        </p>
        <p
          v-else
          class="dashboard-period muted"
        >
          按北京时间统计截至昨天的完整日期
        </p>
      </div>
      <div class="dashboard-controls">
        <el-radio-group
          v-model="days"
          aria-label="统计周期"
          :disabled="loading"
          @change="load"
        >
          <el-radio-button :value="7">
            近7天
          </el-radio-button>
          <el-radio-button :value="30">
            近30天
          </el-radio-button>
        </el-radio-group>
        <el-button
          :loading="loading"
          @click="load"
        >
          刷新
        </el-button>
      </div>
    </header>

    <div
      v-if="error"
      class="panel dashboard-state"
    >
      <el-alert
        :title="error"
        type="error"
        :closable="false"
      />
      <el-button @click="load">
        重试
      </el-button>
    </div>
    <p
      v-if="loading"
      class="panel muted dashboard-state"
      role="status"
    >
      正在汇总运营数据…
    </p>
    <template v-if="data">
      <section
        v-for="group in metricGroups"
        :key="group.kind"
        class="panel metric-band"
        :aria-labelledby="`metrics-${group.kind}`"
      >
        <h2 :id="`metrics-${group.kind}`">
          {{ group.title }}
        </h2>
        <div
          class="metrics"
          :class="group.kind"
        >
          <article
            v-for="metric in group.keys.flatMap(key => metrics.get(key) ?? [])"
            :key="metric.key"
            class="metric"
          >
            <span class="metric-label">{{ labels[metric.key] }}</span>
            <strong>{{ value(metric.key, metric.current) }}</strong>
            <p class="metric-comparison muted">
              {{ comparison(metric) }}
            </p>
            <el-button
              v-if="targets[metric.key]"
              class="detail-link"
              link
              type="primary"
              :aria-label="`${labels[metric.key]}：查看会员`"
              @click="members(targets[metric.key])"
            >
              查看会员 <span aria-hidden="true">›</span>
            </el-button>
          </article>
        </div>
      </section>

      <div class="dashboard-analysis">
        <section class="panel trend-panel">
          <h2>每日趋势</h2>
          <div
            v-if="data.trend.length"
            class="legend"
          >
            <span
              v-for="s in series"
              :key="s.key"
            >
              <i
                class="legend-swatch"
                :style="{ color: s.color, borderTopStyle: s.dash ? (s.key === 'newMembers' ? 'dotted' : 'dashed') : 'solid' }"
                aria-hidden="true"
              />
              {{ s.label }}
            </span>
          </div>
          <svg
            v-if="data.trend.length"
            class="trend"
            viewBox="0 0 630 208"
            role="img"
            aria-label="每日新增会员、浏览活跃、参与活跃人数趋势"
          >
            <text
              x="34"
              y="12"
              text-anchor="end"
            >人</text>
            <g
              v-for="tick in chartTicks"
              :key="tick.value"
            >
              <line
                x1="42"
                x2="616"
                :y1="tick.y"
                :y2="tick.y"
                stroke="#dfe8e1"
                stroke-dasharray="3 3"
              />
              <text
                x="34"
                :y="tick.y + 4"
                text-anchor="end"
              >{{ tick.value }}</text>
            </g>
            <polyline
              v-for="s in series"
              :key="s.key"
              :points="points(s.key)"
              fill="none"
              :stroke="s.color"
              :stroke-dasharray="s.dash"
              stroke-width="2.2"
            />
            <text
              v-for="tick in chartDates"
              :key="tick.date"
              :x="tick.x"
              y="196"
              :text-anchor="tick.anchor"
            >{{ tick.date.slice(5) }}</text>
          </svg>
          <p
            v-else
            class="muted"
          >
            暂无趋势数据
          </p>
          <el-collapse>
            <el-collapse-item title="查看每日数据表">
              <el-table
                :data="data.trend"
                empty-text="暂无趋势数据"
              >
                <el-table-column
                  prop="date"
                  label="日期"
                  min-width="112"
                />
                <el-table-column
                  prop="newMembers"
                  label="新增会员"
                  min-width="84"
                />
                <el-table-column
                  prop="browsingMembers"
                  label="浏览活跃人数"
                  min-width="110"
                />
                <el-table-column
                  prop="participatingMembers"
                  label="参与活跃人数"
                  min-width="110"
                />
              </el-table>
            </el-collapse-item>
          </el-collapse>
        </section>

        <section class="panel behavior-panel">
          <h2>参与行为分布</h2>
          <el-table
            :data="data.behaviors"
            empty-text="本期暂无参与行为"
          >
            <el-table-column
              label="行为"
              min-width="96"
            >
              <template #default="{ row }">
                <el-button
                  class="detail-link"
                  link
                  type="primary"
                  @click="members(row.behavior)"
                >
                  {{ behaviors[row.behavior] || row.behavior }}
                </el-button>
              </template>
            </el-table-column>
            <el-table-column
              prop="members"
              label="去重人数"
              align="right"
              min-width="76"
            />
            <el-table-column
              prop="count"
              label="次数"
              align="right"
              min-width="64"
            />
          </el-table>
        </section>
      </div>
      <details class="statistics-notes">
        <summary>统计口径与数据说明</summary>
        <ul class="muted">
          <li>浏览活跃与参与活跃人数可重叠，不能相加。</li>
          <li>报名按周期内成功报名行为统计，取消后保留历史行为。</li>
          <li>长期未参与指入会满 30 天且近 30 天无参与，完全沉默还需近 30 天无浏览。</li>
          <li
            v-for="note in data.coverageNotes"
            :key="note"
          >
            {{ note }}
          </li>
        </ul>
      </details>
    </template>
  </section>
</template>

<style scoped>
.analytics { --huiju-muted: #54685d; max-width: 1660px; margin: 0 auto; }
.dashboard-heading { display: flex; align-items: flex-start; justify-content: space-between; flex-wrap: wrap; gap: 12px 24px; margin-bottom: 20px; }
.dashboard-heading h1 { font-size: 28px; font-weight: 700; letter-spacing: -.02em; margin-bottom: 5px; }
.dashboard-period { margin: 0; font-size: 13px; display: flex; flex-wrap: wrap; gap: 4px 14px; }
.dashboard-period span + span { padding-left: 14px; border-left: 1px solid var(--huiju-border); }
.dashboard-controls { display: flex; flex-wrap: wrap; align-items: center; gap: 12px; }
.dashboard-state { margin: 0 0 14px; display: grid; justify-items: start; gap: 10px; }
.metric-band { padding: 14px 16px; margin-bottom: 14px; border-radius: 8px; }
.metric-band h2 { margin: 0 0 10px; padding: 0 10px; }
.metrics { display: grid; }
.membership { grid-template-columns: repeat(5, minmax(0, 1fr)); }
.activity { grid-template-columns: repeat(7, minmax(0, 1fr)); }
.metric { display: flex; flex-direction: column; align-items: flex-start; min-width: 0; padding: 4px 10px 0; }
.metric + .metric { border-left: 1px solid var(--huiju-border); }
.metric-label { font-size: 13px; font-weight: 600; }
.metric strong { display: block; margin: 3px 0 5px; font-size: clamp(21px, 2.15vw, 30px); line-height: 1.2; font-variant-numeric: tabular-nums; }
.metric-comparison { flex: 1; margin: 0; font-size: 12px; overflow-wrap: anywhere; }
.detail-link.el-button { min-height: 32px; padding: 0; }
.detail-link span { margin-left: 3px; }
.dashboard-analysis { display: grid; grid-template-columns: minmax(0, 1.75fr) minmax(275px, 1fr); gap: 14px; align-items: stretch; }
.dashboard-analysis .panel { min-width: 0; border-radius: 8px; padding: 16px; }
.legend { display: flex; gap: 6px 16px; flex-wrap: wrap; margin-bottom: 4px; color: var(--huiju-muted); font-size: 12px; }
.legend span { display: inline-flex; align-items: center; gap: 5px; }
.legend-swatch { display: inline-block; width: 16px; border-top: 2px solid; }
.trend { display: block; width: 100%; max-height: 280px; }
.trend text { fill: var(--huiju-muted); font-size: 12px; }
.statistics-notes { margin-top: 14px; padding: 0 2px; font-size: 13px; }
.statistics-notes summary { width: fit-content; max-width: 100%; padding: 9px 4px; color: var(--huiju-green); font-weight: 600; cursor: pointer; }
.statistics-notes summary:focus-visible { outline: 2px solid var(--huiju-green); outline-offset: 2px; border-radius: 4px; }
.statistics-notes ul { margin: 0 0 6px; padding: 0 8px 0 24px; line-height: 1.65; }
.statistics-notes li + li { margin-top: 4px; }
@media (max-width: 1200px) {
  .activity { grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 12px 0; }
  .activity .metric:nth-child(4n + 1) { border-left: 0; }
}
@media (max-width: 940px) {
  .membership, .activity { grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 12px 0; }
  .metrics .metric:nth-child(n) { border-left: 1px solid var(--huiju-border); }
  .metrics .metric:nth-child(3n + 1) { border-left: 0; }
  .dashboard-analysis { grid-template-columns: 1fr; }
}
@media (max-width: 530px) {
  .membership, .activity { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .metrics .metric:nth-child(n) { border-left: 1px solid var(--huiju-border); }
  .metrics .metric:nth-child(odd) { border-left: 0; }
  .dashboard-period span + span { padding-left: 0; border: 0; }
}
</style>
