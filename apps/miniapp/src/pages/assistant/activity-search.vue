<script setup lang="ts">
import { ref, watch, nextTick, getCurrentInstance } from 'vue'
import { onShow, onHide, onUnload } from '@dcloudio/uni-app'
import { api, errorMessage, ApiError } from '@/services/api'
import type { ActivitySearchResult, ActivityRecommendation } from '@/services/api/types'
import { routes, navigate, requireLogin, searchLogin } from '@/services/navigation'
import { useSessionStore } from '@/stores/session'
import { API_BASE_URL, mediaUrl } from '@/services/api/environment'
import { activityTimeRangeWeekday } from '@/services/presentation'
import { newRequestId } from '@/services/circle'
const session = useSessionStore(), instance = getCurrentInstance()
const input = ref(''), messages = ref<string[]>([]), result = ref<ActivitySearchResult | null>(null), items = ref<ActivityRecommendation[]>([])
const busy = ref(false), moreBusy = ref(false), preparing = ref(false), error = ref(''), moreError = ref(''), opening = ref('')
const ready = ref(false), remaining = ref<number | null>(null)
const identityError = ref('')
const profileMissing = ref(false), profileHintClosed = ref(false)
let visible = false, disposed = false, generation = 0
const environment = API_BASE_URL
let pending: { requestId: string; messages: string[] } | null = null
let observers: ReturnType<typeof uni.createIntersectionObserver>[] = []
function disconnect() { observers.forEach(observer => observer.disconnect()); observers = [] }
const impressed = new Set<string>(), impressing = new Map<string, Promise<void>>()
function current() {
  const version = generation, token = session.token, epoch = session.epoch
  return () => !disposed && visible && version === generation && token === session.token && epoch === session.epoch && environment === API_BASE_URL
}
function clear() {
  generation++; input.value = ''; messages.value = []; result.value = null; items.value = []; pending = null
  busy.value = false; moreBusy.value = false; opening.value = ''; error.value = ''; moreError.value = ''; remaining.value = null; ready.value = false
  impressed.clear(); impressing.clear(); disconnect()
  profileMissing.value = false; profileHintClosed.value = false
}
async function prepare() {
  preparing.value = true
  identityError.value = ''
  try {
    const ok = await requireLogin()
    if (visible && !disposed) { ready.value = ok; if (ok) void checkProfile() }
  } catch (e) { if (visible && !disposed) { ready.value = false; identityError.value = errorMessage(e) } }
  finally { if (visible && !disposed) preparing.value = false }
}
async function checkProfile() {
  const valid = current()
  try {
    const details = await api.profileDetails()
    if (valid()) profileMissing.value = !session.member?.profileComplete || !details.resources?.trim() || !details.needs?.trim()
  } catch { /* Optional guidance must not block searching. */ }
}
async function impression(id: string) {
  const searchId = result.value?.searchId
  if (!searchId || impressed.has(id)) return
  if (impressing.has(id)) return impressing.get(id)
  const valid = current()
  const task = api.searchImpressions(searchId, [id]).then(() => { if (valid()) impressed.add(id) }).finally(() => { if (impressing.get(id) === task) impressing.delete(id) })
  impressing.set(id, task); return task
}
async function observe() {
  disconnect()
  const valid = current()
  await nextTick()
  if (!valid() || !items.value.length) return
  items.value.forEach((item, index) => {
    const observer = uni.createIntersectionObserver(instance?.proxy, { thresholds: [0] })
    observers.push(observer)
    observer.relativeToViewport().observe('#recommendation-' + index, entry => {
      if (valid() && entry.intersectionRatio > 0) void impression(item.id).catch(() => undefined)
    })
  })
}
async function search() {
  if (busy.value || !ready.value || !input.value.trim()) return
  if (!session.member?.profileComplete) { ready.value = false; searchLogin(); return }
  if (messages.value.length >= 12) { error.value = '本次对话已达到 12 条输入，请返回助手后重新进入，开始新的查找。'; return }
  const nextMessages = [...messages.value, input.value.trim()]
  if (nextMessages.reduce((total, message) => total + message.length, 0) > 8000) {
    error.value = '本次对话输入合计不能超过 8000 字。请缩短本次输入，或返回助手后重新进入，开始新的查找。'
    return
  }
  if (!pending || JSON.stringify(pending.messages) !== JSON.stringify(nextMessages)) pending = { requestId: newRequestId(), messages: nextMessages }
  generation++; moreBusy.value = false; moreError.value = ''; busy.value = true; error.value = ''
  const valid = current(), attempt = pending
  try {
    const value = await api.searchActivities(attempt)
    if (!valid()) return
    messages.value = attempt.messages; result.value = value; items.value = value.items; remaining.value = value.remainingToday
    input.value = ''; pending = null; impressed.clear(); impressing.clear(); void observe()
  } catch (e) {
    if (valid()) {
      error.value = errorMessage(e)
      if (e instanceof ApiError && e.status === 401) ready.value = false
      if (e instanceof ApiError && ['SEARCH_EXPIRED', 'SEARCH_GENERATION_FAILED', 'SEARCH_TIMEOUT', 'SEARCH_REQUEST_FAILED', 'SEARCH_GENERATION_EXPIRED', 'RECOMMENDATION_AI_FAILED', 'RECOMMENDATION_AI_TIMEOUT', 'RECOMMENDATION_NOT_CONFIGURED', 'RECOMMENDATION_TOO_BROAD'].includes(e.code)) pending = null
      void observe()
    }
  } finally { if (valid()) busy.value = false }
}
async function more() {
  if (busy.value || moreBusy.value || !ready.value || !result.value?.searchId || !result.value.cursor || !result.value.hasMore) return
  const valid = current(), query = result.value
  moreBusy.value = true; moreError.value = ''
  try {
    const value = await api.moreActivitySearch(query.searchId!, query.cursor!)
    if (!valid()) return
    const seen = new Set(items.value.map(item => item.id))
    items.value.push(...value.items.filter(item => !seen.has(item.id) && !!seen.add(item.id)))
    result.value = { ...value, items: items.value }; remaining.value = value.remainingToday; void observe()
  } catch (e) { if (valid()) moreError.value = errorMessage(e) }
  finally { if (valid()) moreBusy.value = false }
}
async function open(item: ActivityRecommendation) {
  if (opening.value || busy.value || !result.value?.searchId) return
  const valid = current(), searchId = result.value.searchId
  opening.value = item.id
  try { await impression(item.id) } catch { /* Statistics must not block browsing. */ }
  if (valid()) { opening.value = ''; navigate(routes.detail + '?id=' + encodeURIComponent(item.id) + '&searchId=' + encodeURIComponent(searchId)) }
}
function browse() { uni.switchTab({ url: routes.activity }) }
function profile() { navigate(routes.profile) }
watch(() => [session.token, session.epoch], () => { clear(); if (visible) ready.value = !!session.member?.profileComplete }, { flush: 'sync' })
onShow(() => { visible = true; void prepare(); void observe() })
onHide(() => {
  if (busy.value) error.value = '本次请求结果尚未确认，返回后可点击重试查找，不会重复扣次。'
  visible = false; generation++; busy.value = false; moreBusy.value = false; opening.value = ''; disconnect()
})
onUnload(() => { disposed = true; visible = false; clear() })
</script>
<template>
  <view class="search-page">
    <view class="intro">说说你想参加什么活动</view>
    <view class="muted">例如：下周在深圳，最好免费，想交流园区运营经验。</view>
    <view
      v-if="preparing"
      class="card"
    >
      正在确认登录状态…
    </view>
    <view
      v-else-if="!ready"
      class="card"
    >
      <view
        v-if="identityError"
        class="error"
      >
        {{ identityError }}
      </view>
      <view v-else>游客可先浏览活动，完善头像、用户名称和手机号后即可使用 AI 找活动。</view><button
        class="primary"
        @click="identityError ? prepare() : searchLogin()"
      >
        {{ identityError ? '重试身份识别' : '去完善资料' }}
      </button>
    </view>
    <template v-else>
      <view
        v-if="profileMissing && !profileHintClosed"
        class="profile-hint"
      >
        <view class="profile-hint-copy">完善资源与需求，让推荐更贴合你。</view>
        <button
          class="profile-hint-action"
          @click="profile"
        >
          去完善 →
        </button>
        <button
          class="profile-hint-close"
          aria-label="关闭资料完善提示"
          @click="profileHintClosed=true"
        >
          ×
        </button>
      </view>
      <view class="card composer">
        <textarea
          v-model="input"
          :maxlength="2000"
          :disabled="busy"
          placeholder="输入需求或补充条件，请勿填写无关敏感信息"
        />
        <view
          v-if="remaining!==null"
          class="muted"
        >
          今日还可成功检索 {{ remaining }} 次，每日最多 10 次
        </view>
        <view
          v-if="messages.length>=12"
          class="muted"
        >
          本次对话已达到 12 条输入，请返回助手后重新进入，开始新的查找。
        </view>
        <view
          v-if="error"
          class="error"
        >
          {{ error }}
        </view>
        <button
          class="primary"
          :disabled="busy || !input.trim() || messages.length>=12"
          :loading="busy"
          @click="search"
        >
          {{ error?'重试查找':messages.length?'按新条件查找':'帮我找活动' }}
        </button>
      </view>
      <view
        v-for="(message,index) in messages"
        :key="index"
        class="message"
      >
        {{ message }}
      </view>
      <view
        v-if="result"
        class="card"
      >
        <view v-if="result.conditions.length">理解到的条件：{{ result.conditions.join('；') }}</view>
        <view v-if="result.status==='clarify'">{{ result.question }}</view>
        <view v-else-if="!items.length">没有找到符合这些条件的活动。你可以修改条件，或浏览全部活动。</view>
      </view>
      <view
        v-for="(item,index) in items"
        :id="'recommendation-'+index"
        :key="item.id"
        class="card recommendation-card"
      >
        <image
          v-if="item.coverUrl"
          class="cover"
          :src="mediaUrl(item.coverUrl)"
          mode="aspectFill"
        />
        <view class="section-title">{{ item.title }}</view>
        <view class="muted">{{ activityTimeRangeWeekday(item.startsAt,item.endsAt) }}</view><view>{{ item.location }}</view><view>{{ item.feeType==='free'?'免费':'¥'+((item.feeAmountCents || 0)/100).toFixed(2) }}</view>
        <view class="reason">{{ item.reason }}</view><view
          v-for="difference in item.differences"
          :key="difference"
          class="muted"
        >
          {{ difference }}
        </view>
        <button
          class="secondary"
          :disabled="!!opening || busy"
          @click="open(item)"
        >
          查看详情
        </button>
      </view>
      <view
        v-if="moreError"
        class="error"
      >
        {{ moreError }}
      </view>
      <button
        v-if="result?.hasMore"
        class="secondary"
        :disabled="busy || moreBusy"
        :loading="moreBusy"
        @click="more"
      >
        {{ moreError?'重试加载':'查看更多' }}
      </button>
      <view
        v-else-if="items.length"
        class="muted"
      >
        没有更多了，可补充条件重新查找。
      </view>
    </template>
    <button
      class="text-button"
      @click="browse"
    >
      浏览全部活动
    </button>
  </view>
</template>
<style scoped>
.search-page{padding:30rpx 26rpx calc(40rpx + env(safe-area-inset-bottom));background:#f4f9f7;min-height:100vh}.intro{font-size:38rpx;color:#174d38;font-weight:600;margin-bottom:16rpx}.search-page .muted{font-size:25rpx;line-height:1.7}.card{margin-top:24rpx;padding:26rpx}.message{margin:24rpx 0 16rpx;padding:22rpx;background:#e3f0e8;border-radius:18rpx;white-space:pre-wrap}.cover{width:100%;height:260rpx;border-radius:14rpx;margin-bottom:20rpx}.reason{margin:18rpx 0;line-height:1.7;color:#20593e}.recommendation-card button{margin-top:22rpx}.composer textarea{width:100%;height:180rpx;font-size:29rpx;line-height:1.6}.composer button{margin-top:20rpx}.profile-hint{display:flex;align-items:center;gap:8rpx;margin-top:24rpx;padding:12rpx 10rpx 12rpx 20rpx;background:#e3f0e8;border-radius:16rpx;color:#365f4e}.profile-hint-copy{flex:1;min-width:0;font-size:25rpx;line-height:1.6}.profile-hint-action,.profile-hint-close{flex-shrink:0;background:transparent;color:#176449;border-radius:12rpx}.profile-hint-action{padding:18rpx 10rpx;font-size:25rpx;white-space:nowrap}.profile-hint-close{display:flex;align-items:center;justify-content:center;width:80rpx;height:80rpx;padding:0;font-size:38rpx}.error{margin:16rpx 0;line-height:1.6}
</style>
