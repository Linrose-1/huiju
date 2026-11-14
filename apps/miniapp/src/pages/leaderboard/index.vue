<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { onHide, onShow, onUnload, onPullDownRefresh } from '@dcloudio/uni-app'
import PageReturn from '@/components/base/PageReturn.vue'
import RequestState from '@/components/base/RequestState.vue'
import { api, errorMessage } from '@/services/api'
import { mediaUrl } from '@/services/api/environment'
import type { Leaderboard, LeaderboardKind, LeaderboardPeriod } from '@/services/api/types'
import { requireProfile, routes } from '@/services/navigation'
import { useSessionStore } from '@/stores/session'

const session = useSessionStore()
const period = ref<LeaderboardPeriod>('month')
const kind = ref<LeaderboardKind>('attendance')
const result = ref<Leaderboard | null>(null)
const failedAvatars = ref<Record<string, boolean>>({})
const loading = ref(true)
const error = ref('')
let visible = false
let generation = 0

const periodLabel = computed(() => {
  if (period.value === 'all') return '全部时间'
  if (!result.value?.month) return '本月'
  const [year, month] = result.value.month.split('-')
  return `${year}年${Number(month)}月`
})

async function load() {
  const requestId = ++generation
  result.value = null
  error.value = ''
  loading.value = true
  failedAvatars.value = {}
  try {
    const allowed = await requireProfile(routes.leaderboard)
    if (requestId !== generation) return
    if (!allowed) {
      error.value = '完善资料后可查看榜单'
      return
    }
    const board = await api.leaderboard(period.value, kind.value)
    if (requestId === generation) result.value = board
  } catch (cause) {
    if (requestId === generation) error.value = errorMessage(cause)
  } finally {
    if (requestId === generation) {
      loading.value = false
      uni.stopPullDownRefresh()
    }
  }
}

function leave() {
  visible = false
  generation++
  result.value = null
}

watch([period, kind, () => session.epoch, () => session.token], () => {
  if (visible) void load()
})
onShow(() => { visible = true; void load() })
onHide(leave)
onUnload(leave)
onPullDownRefresh(load)
</script>

<template>
  <view class="leaderboard">
    <PageReturn />
    <view class="period-row">
      <text class="period-label">{{ periodLabel }}</text>
      <view class="switches">
        <button
          class="period-button"
          :class="{ selected: period === 'month' }"
          @click="period = 'month'"
        >
          本月
        </button>
        <button
          class="period-button"
          :class="{ selected: period === 'all' }"
          @click="period = 'all'"
        >
          累计
        </button>
      </view>
    </view>
    <view class="kinds switches">
      <button
        class="kind-button"
        :class="{ selected: kind === 'attendance' }"
        @click="kind = 'attendance'"
      >
        参与榜
      </button>
      <button
        class="kind-button"
        :class="{ selected: kind === 'organized' }"
        @click="kind = 'organized'"
      >
        发起榜
      </button>
    </view>
    <view class="rule">{{ kind === 'attendance' ? '按实际到场次数排序' : '按已发布且未取消的活动数排序' }} · 前 20 名</view>
    <RequestState
      :loading="loading"
      :error="error"
      :empty="result?.items.length === 0"
      :empty-text="kind === 'attendance' ? '暂无到场记录' : '暂无符合条件的已发布活动'"
      @retry="load"
    />
    <view
      v-if="result?.items.length"
      class="rank-list"
    >
      <view
        v-for="(item, index) in result.items"
        :key="item.memberId"
        class="rank-row"
        :class="{ first: index === 0 }"
      >
        <text class="rank">{{ index + 1 < 10 ? '0' : '' }}{{ index + 1 }}</text>
        <image
          v-if="item.avatarUrl && !failedAvatars[item.memberId]"
          class="avatar"
          mode="aspectFill"
          :src="mediaUrl(item.avatarUrl)"
          @error="failedAvatars[item.memberId] = true"
        />
        <view
          v-else
          class="avatar placeholder"
        >
          {{ Array.from(item.displayName || '学友')[0] }}
        </view>
        <text class="name">{{ item.displayName || '学友' }}</text>
        <view class="score">
          <text class="count">{{ item.count }}</text>
          <text class="unit">{{ kind === 'attendance' ? '次' : '场' }}</text>
        </view>
      </view>
    </view>
  </view>
</template>

<style scoped>
.leaderboard { min-height: 100vh; padding: 0 28rpx calc(32rpx + env(safe-area-inset-bottom)); background: #fbfaf7; color: #21251f; }
.period-row, .switches, .rank-row, .score { display: flex; align-items: center; }
.period-row { justify-content: space-between; padding: 14rpx 12rpx 18rpx; }
.period-label { font-size: 34rpx; }
.switches { gap: 24rpx; }
.switches button { position: relative; margin: 0; padding: 0 6rpx; line-height: 84rpx; background: transparent; border-radius: 0; color: #64665f; }
.switches button::after { border: 0; }
.switches button.selected { color: #152b21; font-weight: 650; }
.switches button.selected::before { content: ''; position: absolute; left: 6rpx; right: 6rpx; bottom: 6rpx; height: 4rpx; background: #18513b; }
.period-button { min-width: 84rpx; font-size: 30rpx; }
.kinds { margin: 0 12rpx; gap: 38rpx; border-bottom: 1rpx solid #d9dbd4; }
.kinds .kind-button { font-size: 40rpx; line-height: 96rpx; padding: 0; }
.kinds .selected::before { left: 0; right: 0; bottom: 0; }
.rule { margin: 26rpx 12rpx; font-size: 26rpx; line-height: 1.5; color: #686b64; }
.rank-list { background: #fff; border-radius: 20rpx; overflow: hidden; }
.rank-row { min-height: 128rpx; margin: 0 14rpx; padding: 0 14rpx; gap: 22rpx; border-bottom: 1rpx solid #e1e4dd; }
.rank-row:last-child, .rank-row.first { border-bottom: 0; }
.rank-row.first { min-height: 146rpx; margin: 0; padding: 0 28rpx; background: #103d2d; color: #fff; border-radius: 20rpx; }
.rank { width: 62rpx; flex-shrink: 0; text-align: center; font-size: 30rpx; font-variant-numeric: tabular-nums; color: #6c7069; }
.first .rank { color: #ebd197; font-family: Georgia, serif; font-style: italic; font-size: 40rpx; }
.avatar { width: 76rpx; height: 76rpx; border-radius: 50%; flex-shrink: 0; }
.placeholder { display: flex; align-items: center; justify-content: center; background: #e4eee7; color: #365a48; font-size: 32rpx; }
.name { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 34rpx; font-weight: 600; }
.score { flex-shrink: 0; align-items: baseline; gap: 7rpx; }
.count { font-size: 40rpx; font-weight: 650; font-variant-numeric: tabular-nums; }
.unit { font-size: 26rpx; }
</style>
