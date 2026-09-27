<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { onLoad, onShow, onHide, onUnload, onShareAppMessage } from '@dcloudio/uni-app'
import { api, ApiError, errorMessage } from '@/services/api'
import type { ManagedActivity, OrganizerRegistration, ReadingStats } from '@/services/api/types'
import { dateTime, fee, feeDisclaimer } from '@/services/presentation'
import { mediaUrl } from '@/services/api/environment'
import { navigate, routes, loginPage } from '@/services/navigation'
import { useSessionStore } from '@/stores/session'
import RequestState from '@/components/base/RequestState.vue'
const session = useSessionStore()
const id = ref(''), activity = ref<ManagedActivity | null>(null), roster = ref<OrganizerRegistration[]>([])
const loading = ref(false), error = ref(''), actionError = ref(''), busy = ref(false), cancelling = ref(false), reason = ref(''), filter = ref('active'), expanded = ref('')
let generation = 0
let shown = false
const readingStats = ref<ReadingStats | null>(null), statsError = ref('')
function currentRequest() {
  const current = generation, token = session.token, epoch = session.epoch
  return () => current === generation && !!token && token === session.token && epoch === session.epoch
}
function clear() {
  generation++
  activity.value = null; roster.value = []; readingStats.value = null
  error.value = ''; actionError.value = ''; statsError.value = ''; reason.value = ''
  loading.value = false; busy.value = false; cancelling.value = false; expanded.value = ''
}
async function loadStats() {
  if (!activity.value || !session.token) return
  const active = currentRequest(), activityId = id.value
  readingStats.value = null; statsError.value = ''
  try { const result = await api.activityViewStats(activityId); if (active()) readingStats.value = result }
  catch (e) { if (active()) statsError.value = errorMessage(e) }
}
const visible = computed(() => roster.value.filter(item => filter.value === 'all' || item.status === filter.value))
const editable = computed(() => activity.value && activity.value.moderation === 'normal' && (activity.value.lifecycle === 'draft' || (activity.value.lifecycle === 'published' && Date.parse(activity.value.endsAt) > Date.now())))
const cancellable = computed(() => activity.value?.lifecycle === 'published' && Date.parse(activity.value.startsAt) > Date.now())
const state = computed(() => {
  if (!activity.value) return ''
  if (activity.value.moderation === 'removed') return '已下架'
  if (activity.value.lifecycle === 'draft') return '草稿 · 尚未公开'
  if (activity.value.lifecycle === 'cancelled') return '已取消'
  return Date.parse(activity.value.endsAt) <= Date.now() ? '已结束' : '已发布'
})
async function load() {
  clear()
  const active = currentRequest(), activityId = id.value
  if (!id.value) { error.value = '活动链接不完整'; return }
  if (!session.token) { loading.value = false; return }
  loading.value = true
  try {
    const [detail, registrations] = await Promise.all([api.managedActivity(activityId), api.organizerRoster(activityId)])
    if (active()) { activity.value = detail; roster.value = registrations.items; void loadStats() }
  } catch (e) { if (active()) error.value = errorMessage(e) }
  finally { if (active()) loading.value = false }
}
async function publish() {
  if (busy.value || !session.token || activity.value?.lifecycle !== 'draft') return
  const active = currentRequest(), activityId = id.value
  busy.value = true; actionError.value = ''
  try {
    const result = await uni.showModal({ title: '确认发布', content: '发布后会员即可浏览和报名，请确认活动信息准确。', confirmText: '发布' })
    if (!active() || !result.confirm) return
    await api.publishActivity(activityId)
    if (active()) await load()
  } catch (e) { if (active()) { actionError.value = errorMessage(e); if (e instanceof ApiError && e.code === 'PROFILE_INCOMPLETE') loginPage(routes.manage+'?id='+activityId) } }
  finally { if (active()) busy.value = false }
}
async function cancel() {
  if (busy.value || !session.token || !cancellable.value) return
  if (!reason.value.trim()) { actionError.value = '请填写取消原因'; return }
  const active = currentRequest(), activityId = id.value, cancellationReason = reason.value.trim()
  busy.value = true; actionError.value = ''
  try {
    const result = await uni.showModal({ title: '取消整场活动', content: '取消后不能恢复，报名记录会保留，并向当前已报名会员发送站内通知。'+(activity.value?.feeType === 'paid' ? feeDisclaimer : ''), confirmText: '确认取消', confirmColor: '#a74b33' })
    if (!active() || !result.confirm) return
    await api.cancelActivity(activityId, cancellationReason)
    if (active()) await load()
  } catch (e) { if (active()) actionError.value = errorMessage(e) }
  finally { if (active()) busy.value = false }
}
function answer(item: OrganizerRegistration, questionId: string) {
  const value = item.answers.find(a => a.questionId === questionId)?.value
  return Array.isArray(value) ? value.join('、') : value || '未填写'
}
const stop = watch(() => [session.token, session.epoch], () => { clear(); if (shown) void load() }, { flush: 'sync' })
onLoad(options => { id.value = String(options?.id || '') })
onShow(() => { shown = true; void load() })
onHide(() => { shown = false; clear() })
onUnload(() => { shown = false; clear(); stop() })
onShareAppMessage(() => ({ title: activity.value?.title || '会聚活动', path: routes.detail+'?id='+encodeURIComponent(id.value)+(session.member?.inviteCode?'&inviteCode='+encodeURIComponent(session.member.inviteCode):'') }))
</script>
<template>
  <view class="page-pad manage-page">
    <view
      v-if="!session.token"
      class="empty"
    >
      登录后管理自己的活动<button
        class="text-button"
        @click="loginPage(routes.manage+'?id='+id)"
      >
        去登录
      </button>
    </view>
    <template v-else>
      <RequestState
        :loading="loading"
        :error="error"
        @retry="load"
      />
      <view
        v-if="actionError"
        class="error"
      >
        {{ actionError }}
      </view>
      <template v-if="activity && !loading && !error">
        <view class="card">
          <view class="row between"><text class="tag">{{ state }}</text><text class="tag fee-tag">{{ fee(activity) }}</text></view>
          <view class="title">{{ activity.title }}</view>
          <view class="meta">{{ dateTime(activity.startsAt) }} — {{ dateTime(activity.endsAt) }}</view>
          <view class="meta">{{ activity.location }}</view>
          <view
            v-if="activity.lifecycle==='cancelled'"
            class="notice"
          >
            取消原因：{{ activity.cancellationReason }}<br>取消前已有 {{ activity.cancellationRegistrationCount }} 人报名。
          </view>
          <view
            v-if="activity.hasRegistrationEver"
            class="muted small lock-note"
          >
            已有报名记录，题目和收费金额已锁定。
          </view>
          <view class="actions">
            <button
              v-if="editable"
              class="secondary"
              :disabled="busy"
              @click="navigate(routes.editor+'?id='+id)"
            >
              编辑活动
            </button>
            <button
              v-if="activity.lifecycle==='draft' && activity.moderation==='normal'"
              class="primary"
              :disabled="busy"
              :loading="busy"
              @click="publish"
            >
              发布活动
            </button>
            <button
              v-if="activity.lifecycle!=='draft'"
              class="secondary"
              @click="navigate(routes.detail+'?id='+id)"
            >
              查看活动
            </button>
            <button
              v-if="activity.lifecycle==='published' && activity.moderation==='normal'"
              class="primary share-action"
              open-type="share"
            >
              分享活动
            </button>
          </view>
        </view>
        <view class="card">
          <view class="section-title">浏览统计</view>
          <view
            v-if="readingStats"
            class="reading-stats"
          >
            <view><text>{{ readingStats.views }}</text><view class="muted small">浏览次数</view></view>
            <view><text>{{ readingStats.visitors }}</text><view class="muted small">浏览人数</view></view>
            <view><text>{{ readingStats.conversionRate === null ? '—' : readingStats.conversionRate.toFixed(1)+'%' }}</text><view class="muted small">{{ readingStats.conversionRate === null ? '暂无浏览' : '报名转化率' }}</view></view>
          </view>
          <view
            v-else-if="statsError"
            class="muted small"
          >
            {{ statsError }}<button
              class="text-button"
              @click="loadStats"
            >
              重试
            </button>
          </view>
          <view
            v-else
            class="muted small"
          >
            正在加载浏览统计…
          </view>
        </view>
        <view class="card">
          <view class="row between"><view class="section-title">报名名单</view><text class="muted small">{{ activity.lifecycle==='cancelled'?'取消前报名':'当前有效' }} {{ activity.cancellationRegistrationCount ?? activity.activeRegistrationCount }} 人</text></view>
          <view class="notice">联系手机号和回答仅用于本次活动组织，请妥善保管。</view>
          <view class="filters">
            <button
              v-for="option in [{value:'active',label:'有效报名'},{value:'cancelled',label:'已取消报名'},{value:'all',label:'全部'}]"
              :key="option.value"
              :class="filter===option.value?'primary':'secondary'"
              @click="filter=option.value"
            >
              {{ option.label }}
            </button>
          </view>
          <view
            v-if="!visible.length"
            class="empty"
          >
            暂无对应报名记录
          </view>
          <view
            v-for="item in visible"
            :key="item.id"
            class="registrant"
          >
            <view class="row">
              <view class="avatar">
                <image
                  v-if="item.member.avatarUrl"
                  :src="mediaUrl(item.member.avatarUrl)"
                  mode="aspectFill"
                /><uni-icons
                  v-else
                  type="person"
                  size="38rpx"
                />
              </view>
              <view class="grow"><view>{{ item.member.displayName || '会员' }}</view><view class="muted small">{{ item.status==='active'?'已报名':'已取消报名' }} · {{ dateTime(item.currentRegisteredAt) }}</view></view>
            </view>
            <view class="phone">联系手机号：<text user-select>{{ item.contactPhone }}</text></view>
            <button
              class="text-button"
              @click="expanded=expanded===item.id?'':item.id"
            >
              {{ expanded===item.id?'收起回答':'查看报名回答' }}
            </button>
            <view v-if="expanded===item.id">
              <view
                v-for="question in activity.questions"
                :key="question.id"
                class="answer"
              >
                <view class="muted small">{{ question.prompt }}</view><view>{{ answer(item,question.id) }}</view>
              </view>
              <view
                v-if="!activity.questions.length"
                class="muted small"
              >
                本活动没有自定义问题。
              </view>
            </view>
          </view>
        </view>
        <view
          v-if="cancellable"
          class="card"
        >
          <button
            class="text-button danger"
            :disabled="busy"
            @click="cancelling=!cancelling"
          >
            {{ cancelling?'暂不取消':'取消整场活动' }}
          </button>
          <view v-if="cancelling">
            <textarea
              v-model="reason"
              class="input"
              placeholder="请说明取消原因，已报名会员会收到站内通知"
              :maxlength="1000"
              :disabled="busy"
              :cursor-spacing="100"
            />
            <button
              class="secondary cancel-submit"
              :disabled="busy"
              :loading="busy"
              @click="cancel"
            >
              确认取消活动
            </button>
          </view>
        </view>
      </template>
    </template>
  </view>
</template>
<style scoped>
.manage-page{background:#f4f8f7;min-height:100vh;padding:20rpx 26rpx calc(32rpx + env(safe-area-inset-bottom));color:#14212f}
.card{padding:24rpx;margin-bottom:16rpx;border-radius:18rpx}
.title{font-size:36rpx;font-weight:600;line-height:1.5;margin-top:16rpx;overflow-wrap:anywhere}
.tag{font-size:26rpx;padding:7rpx 14rpx;border-radius:9rpx}
.fee-tag{background:#f0f7f4;color:#1b674f}
.meta{font-size:28rpx;line-height:1.6;margin-top:8rpx}
.muted.small{font-size:25rpx;line-height:1.6}
.section-title{font-size:32rpx;margin-bottom:16rpx}
.actions{display:flex;flex-wrap:wrap;gap:12rpx;margin-top:20rpx}
.actions button{flex:1;min-width:40%;font-size:28rpx;border-radius:12rpx;min-height:72rpx;padding:16rpx 12rpx}
.actions .share-action{flex-basis:100%;background:linear-gradient(105deg,#17664e,#32856a)}
.reading-stats{display:flex;justify-content:space-between;gap:12rpx;text-align:center;padding:12rpx 0 4rpx}
.reading-stats>view{flex:1;min-width:0;border-right:1rpx solid #e8eeeb}
.reading-stats>view:last-child{border:0}
.reading-stats text{font-size:40rpx;font-weight:600;color:#1d654e;line-height:1.5}
.filters{display:flex;gap:0;margin:20rpx 0 8rpx;background:#f1f5f4;border-radius:44rpx}
.filters button{flex:1;padding:16rpx 4rpx;font-size:27rpx;background:transparent;color:#75808a;min-height:68rpx}
.filters button.primary{background:linear-gradient(105deg,#17664e,#32856a);color:white}
.registrant{border-bottom:1rpx solid #e8eeea;padding:22rpx 0}
.registrant:last-child{border:0;padding-bottom:0}
.avatar{width:76rpx;height:76rpx}
.grow>view:first-child{font-size:29rpx;font-weight:600;line-height:1.5;overflow-wrap:anywhere}
.phone{font-size:26rpx;margin-top:12rpx;line-height:1.6}
.registrant .text-button{font-size:26rpx;text-align:right;min-height:64rpx}
.answer{white-space:pre-wrap;overflow-wrap:anywhere;line-height:1.7;margin-top:18rpx}
.danger{color:#a74b33;font-size:28rpx;min-height:64rpx;width:100%}
.cancel-submit{margin-top:20rpx}
.lock-note{margin-top:14rpx}
.notice{margin-top:14rpx;font-size:25rpx;padding:14rpx 16rpx}
</style>
