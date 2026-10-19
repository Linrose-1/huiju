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
const membership = computed(() => data.value?.metrics.filter(v => ['newMembers', 'browsingMembers', 'participatingMembers', 'inactiveMembers', 'silentMembers'].includes(v.key)) ?? [])
const activity = computed(() => data.value?.metrics.filter(v => !['newMembers', 'browsingMembers', 'participatingMembers', 'inactiveMembers', 'silentMembers'].includes(v.key)) ?? [])
const series = [{ key: 'newMembers' as const, label: '新增会员', color: '#247552' }, { key: 'browsingMembers' as const, label: '浏览活跃', color: '#4386b5' }, { key: 'participatingMembers' as const, label: '参与活跃', color: '#b17c32' }]
const max = computed(() => Math.max(1, ...(data.value?.trend.flatMap(v => [v.newMembers, v.browsingMembers, v.participatingMembers]) ?? [])))
function points(key: 'newMembers' | 'browsingMembers' | 'participatingMembers') { return data.value?.trend.map((v, i, list) => `${30 + i / Math.max(1, list.length - 1) * 860},${210 - v[key] / max.value * 180}`).join(' ') ?? '' }
function value(key: string, current: number) { return key === 'browseRegistrationRate' ? (data.value?.metrics.find(v => v.key === 'browsingMembers')?.current ? `${current.toFixed(1)}%` : '暂无浏览') : current.toLocaleString() }
function change(metric: AnalyticsDashboard['metrics'][number]) { return metric.changePercent === null ? (metric.current > 0 ? '新增' : '无变化') : `${metric.changePercent > 0 ? '+' : ''}${metric.changePercent.toFixed(1)}%` }
function members(behavior: string) { void router.push({ path: '/engagement', query: { days: days.value, behavior } }) }
async function load() { const current = begin(); loading.value = true; error.value = ''; data.value = null
  try { const result = await adminApi.analytics(days.value); if (current()) data.value = result }
  catch (e) { if (current()) error.value = errorMessage(e) }
  finally { if (current()) loading.value = false }
}
onMounted(load)
</script>
<template>
  <section>
    <h1>运营看板</h1><p class="page-description">
      观察会员活跃与活动运营效果。按北京时间统计截至昨天的完整日期。
    </p>
    <div class="toolbar">
      <el-radio-group
        v-model="days"
        :disabled="loading"
        @change="load"
      >
        <el-radio-button :value="7">
          近7天
        </el-radio-button><el-radio-button :value="30">
          近30天
        </el-radio-button>
      </el-radio-group><el-button
        :loading="loading"
        @click="load"
      >
        刷新
      </el-button>
    </div>
    <el-alert
      v-if="error"
      :title="error"
      type="error"
      :closable="false"
    /><el-button
      v-if="error"
      @click="load"
    >
      重试
    </el-button><p
      v-if="loading"
      role="status"
    >
      正在汇总运营数据…
    </p>
    <template v-if="data">
      <p class="muted">
        {{ data.startDate }} 至 {{ data.endDate }} · 对比前一个{{ days }}天周期
      </p>
      <h2>会员活跃</h2><div class="metrics">
        <article
          v-for="metric in membership"
          :key="metric.key"
          class="panel metric"
        >
          <span>{{ labels[metric.key] }}</span><strong>{{ value(metric.key, metric.current) }}</strong><p class="muted">
            上期 {{ metric.previous }} · 增减 {{ metric.delta > 0 ? '+' : '' }}{{ metric.delta }} · {{ change(metric) }}
          </p><el-button
            v-if="targets[metric.key]"
            text
            type="primary"
            @click="members(targets[metric.key])"
          >
            查看会员
          </el-button>
        </article>
      </div>
      <h2 class="section-title">
        活动运营
      </h2><div class="metrics">
        <article
          v-for="metric in activity"
          :key="metric.key"
          class="panel metric"
        >
          <span>{{ labels[metric.key] || metric.key }}</span><strong>{{ value(metric.key, metric.current) }}</strong><p class="muted">
            上期 {{ metric.key === 'browseRegistrationRate' ? metric.previous.toFixed(1) + '%' : metric.previous }} · 增减 {{ metric.delta > 0 ? '+' : '' }}{{ Number(metric.delta.toFixed(1)) }}{{ metric.key === 'browseRegistrationRate' ? '个百分点' : '' }} · {{ change(metric) }}
          </p><el-button
            v-if="targets[metric.key]"
            text
            type="primary"
            @click="members(targets[metric.key])"
          >
            查看会员
          </el-button>
        </article>
      </div>
      <div class="panel section-title">
        <h2>每日趋势</h2><div class="legend">
          <span
            v-for="s in series"
            :key="s.key"
            :style="{ color: s.color }"
          >● {{ s.label }}</span>
        </div><svg
          class="trend"
          viewBox="0 0 920 250"
          role="img"
          aria-label="每日新增会员、浏览活跃、参与活跃人数趋势"
        ><line
          x1="30"
          y1="210"
          x2="890"
          y2="210"
          stroke="#d7e2da"
        /><text
          x="30"
          y="22"
          fill="#6d7f74"
        >{{ max }} 人</text><polyline
          v-for="s in series"
          :key="s.key"
          :points="points(s.key)"
          fill="none"
          :stroke="s.color"
          stroke-width="2.5"
        /><text
          x="30"
          y="240"
          fill="#6d7f74"
        >{{ data.startDate }}</text><text
          x="890"
          y="240"
          text-anchor="end"
          fill="#6d7f74"
        >{{ data.endDate }}</text></svg>
        <el-collapse>
          <el-collapse-item title="查看每日数据表">
            <el-table
              :data="data.trend"
              empty-text="暂无趋势数据"
            >
              <el-table-column
                prop="date"
                label="日期"
              /><el-table-column
                prop="newMembers"
                label="新增会员"
              /><el-table-column
                prop="browsingMembers"
                label="浏览活跃人数"
              /><el-table-column
                prop="participatingMembers"
                label="参与活跃人数"
              />
            </el-table>
          </el-collapse-item>
        </el-collapse>
      </div>
      <div class="panel section-title">
        <h2>参与行为分布</h2><el-table
          :data="data.behaviors"
          empty-text="本期暂无参与行为"
        >
          <el-table-column label="行为">
            <template #default="{ row }">
              <el-button
                text
                type="primary"
                @click="members(row.behavior)"
              >
                {{ behaviors[row.behavior] || row.behavior }}
              </el-button>
            </template>
          </el-table-column><el-table-column
            prop="members"
            label="去重人数"
          /><el-table-column
            prop="count"
            label="次数"
          />
        </el-table>
      </div>
      <p class="muted">
        浏览与参与人数可重叠，不能相加；报名按周期内成功报名行为统计，取消后保留历史行为。长期未参与指入会满30天且近30天无参与；完全沉默还需近30天无浏览。
      </p><el-alert
        v-for="note in data.coverageNotes"
        :key="note"
        :title="note"
        type="info"
        :closable="false"
        class="coverage"
      />
    </template>
  </section>
</template>
<style scoped>.metrics { display: grid; grid-template-columns: repeat(auto-fit, minmax(210px, 1fr)); gap: 14px; }.metric strong { display: block; margin-top: 14px; font-size: 28px; font-variant-numeric: tabular-nums; }.metric p { font-size: 12px; }.section-title { margin-top: 24px; }.legend { display: flex; gap: 24px; flex-wrap: wrap; }.trend { width: 100%; max-height: 320px; }.coverage { margin-top: 8px; }</style>
