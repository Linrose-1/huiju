<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { onLoad, onShow, onHide, onUnload } from '@dcloudio/uni-app'
import { api, ApiError, errorMessage } from '@/services/api'
import type { Activity, Registration } from '@/services/api/types'
import { mediaUrl } from '@/services/api/environment'
import { canEdit, canCancel, dateTime, fee, feeDisclaimer, registrationStatus, activityTimeRangeWeekday } from '@/services/presentation'
import { navigate, routes, loginPage } from '@/services/navigation'
import { useSessionStore } from '@/stores/session'
import RequestState from '@/components/base/RequestState.vue'
const id = ref(''), activity = ref<Activity | null>(null), registration = ref<Registration | null>(null), loading = ref(true), error = ref(''), busy = ref(false), actionError = ref('')
const editable = computed(() => !!activity.value && !!registration.value && canEdit(activity.value, registration.value))
const cancellable = computed(() => !!activity.value && !!registration.value && canCancel(activity.value, registration.value))
const session = useSessionStore()
const status = computed(() => activity.value && registration.value ? registrationStatus(activity.value, registration.value) : null)
let generation = 0, visible = false
function clear() { generation++; activity.value = null; registration.value = null; error.value = ''; actionError.value = ''; busy.value = false; loading.value = false }
async function load() {
    const current = ++generation
    activity.value = null; registration.value = null; loading.value = false; error.value = ''
    if (!id.value) { error.value = '报名链接不完整'; return }
    if (!session.token) { error.value = '请登录后查看本人的报名'; return }
    loading.value = true
    try {
        const [nextActivity, nextRegistration] = await Promise.all([api.activity(id.value), api.myRegistration(id.value)])
        if (current !== generation) return
        activity.value = nextActivity; registration.value = nextRegistration
    } catch (e) { if (current === generation) error.value = errorMessage(e) }
    finally { if (current === generation) loading.value = false }
}
function edit() { if (editable.value && !busy.value) navigate(routes.form + '?id=' + id.value + '&edit=1') }
function answer(questionId: string) { const value = registration.value?.answers.find(item => item.questionId === questionId)?.value; return Array.isArray(value) ? value.join('、') : value || '未填写' }
function organizer() {
    const memberId = activity.value?.organizer?.memberId
    if (memberId) navigate(routes.memberCard + '?id=' + encodeURIComponent(memberId))
}
async function cancel() {
    if (busy.value || !cancellable.value) return
    const current = generation, token = session.token, epoch = session.epoch, activityId = id.value
    const active = () => current === generation && token === session.token && epoch === session.epoch
    busy.value = true; actionError.value = ''
    try {
        const result = await uni.showModal({ title: '取消报名', content: '取消后将释放名额，再次报名需要重新竞争名额。' + (activity.value?.feeType === 'paid' ? feeDisclaimer + '。' : ''), confirmText: '确认取消', confirmColor: '#9a4d33' })
        if (!result.confirm || !active() || !cancellable.value) return
        await api.cancel(activityId)
        if (active()) { busy.value = false; await load() }
    } catch (e) {
        if (!active()) return
        actionError.value = errorMessage(e)
        if (e instanceof ApiError && e.status === 401) loginPage(routes.result + '?id=' + activityId)
    } finally { if (active()) busy.value = false }
}
function copyContact() { if (activity.value?.consultationContact) uni.setClipboardData({ data: activity.value.consultationContact }) }
const stop = watch(() => [session.token, session.epoch], () => { clear(); if (visible) void load() }, { flush: 'sync' })
onLoad(options => { id.value = String(options?.id || '') })
onShow(() => { visible = true; void load() })
onHide(() => { visible = false; clear() })
onUnload(() => { visible = false; clear(); stop() })
</script>
<template>
  <view class="registration-detail">
    <RequestState
      :loading="loading"
      :error="error"
      @retry="load"
    />
    <button
      v-if="!session.token"
      class="primary"
      @click="loginPage(routes.result+'?id='+id)"
    >
      微信登录
    </button>
    <template v-if="activity && registration && !loading && !error">
      <view class="detail-card summary">
        <image
          v-if="activity.coverUrl"
          :src="mediaUrl(activity.coverUrl)"
          class="cover"
          mode="aspectFill"
        />
        <view
          v-else
          class="cover no-cover"
        >
          暂无封面
        </view>
        <view class="summary-content">
          <view class="summary-title">{{ activity.title }}</view>
          <view class="tags">
            <text class="fee-tag">{{ activity.feeType==='paid' ? '收费活动 '+fee(activity) : '免费活动' }}</text><text
              class="registration-tag"
              :class="{inactive:registration.status==='cancelled'}"
            >
              {{ registration.status==='active'?'已报名':'已取消' }}
            </text>
          </view>
          <view class="meta">
            <view class="clock-icon" /><text>{{ activityTimeRangeWeekday(activity.startsAt, activity.endsAt) }}</text>
          </view>
          <view class="meta">
            <uni-icons
              type="location"
              size="32rpx"
              color="#173c3b"
            /><text>{{ activity.location }}</text>
          </view>
          <button
            v-if="activity.organizer"
            class="organizer-link"
            @click="organizer"
          >
            <uni-icons
              type="person"
              size="32rpx"
              color="#173c3b"
            /><text>发起人 {{ activity.organizer.displayName }}</text><uni-icons
              type="arrow-right"
              size="26rpx"
              color="#6b8588"
            />
          </button>
        </view>
      </view>
      <view class="detail-card">
        <view class="heading">报名状态</view>
        <view
          v-if="status"
          class="status"
          :class="status.tone"
        >
          <view class="status-icon">
            <uni-icons
              :type="status.icon"
              size="54rpx"
              :color="status.color"
            />
          </view><view class="status-copy"><view class="status-title">{{ status.title }}</view><view class="muted">{{ status.description }}</view></view>
        </view>
        <view class="registered-at">
          <view class="clock-icon" /><text>报名时间 {{ dateTime(registration.currentRegisteredAt) }}</text>
        </view>
      </view>
      <view class="detail-card">
        <view class="section-top">
          <view class="heading">我的报名信息</view><button
            v-if="editable"
            class="text-button"
            :disabled="busy"
            @click="edit"
          >
            编辑 / 修改 <uni-icons
              type="arrow-right"
              size="26rpx"
              color="#17815d"
            />
          </button>
        </view>
        <view class="answer-row">
          <uni-icons
            type="person"
            size="32rpx"
            color="#173c3b"
          /><text class="answer-label">用户名称</text><text>{{ session.member?.displayName || '会聚会员' }}</text>
        </view>
        <view class="answer-row">
          <uni-icons
            type="phone"
            size="32rpx"
            color="#173c3b"
          /><text class="answer-label">手机号</text><text>{{ registration.contactPhone }}</text>
        </view>
        <view
          v-for="question in activity.questions"
          :key="question.id"
          class="answer-row"
        >
          <uni-icons
            type="compose"
            size="32rpx"
            color="#173c3b"
          /><text class="answer-label">{{ question.prompt }}</text><text class="answer-value">{{ answer(question.id) }}</text>
        </view>
      </view>
      <view class="detail-card">
        <view class="heading">活动咨询方式</view><view class="muted consultation-hint">如有任何问题，请联系活动发起人</view>
        <view class="consultation">
          <button
            class="contact-person"
            @click="organizer"
          >
            <image
              v-if="activity.organizer?.avatarUrl"
              :src="mediaUrl(activity.organizer.avatarUrl)"
              class="avatar"
              mode="aspectFill"
            /><view
              v-else
              class="avatar avatar-placeholder"
            >
              <uni-icons
                type="person-filled"
                size="44rpx"
                color="#69887b"
              />
            </view><view><view class="organizer-name">{{ activity.organizer?.displayName || '活动发起人' }} <text class="organizer-tag">发起人</text></view><view class="contact">{{ activity.consultationContact || '暂时无法取得咨询方式，请重试' }}</view></view>
          </button>
          <button
            v-if="activity.consultationContact"
            class="copy-button"
            @click="copyContact"
          >
            <view class="copy-icon">
              <uni-icons
                type="chat"
                size="42rpx"
                color="#129361"
              />
            </view><text>复制咨询方式</text>
          </button>
        </view>
      </view>
      <view class="detail-card">
        <view class="heading">操作说明</view><view class="notice-box">
          <uni-icons
            type="info-filled"
            size="38rpx"
            color="#fa780e"
          /><view>1. 报名截止前可修改答案，活动取消或下架时不可修改。<br>2. 活动开始前可取消报名，取消后释放名额。<br>3. {{ feeDisclaimer }}。</view>
        </view>
      </view>
      <view
        v-if="actionError"
        class="error"
      >
        {{ actionError }}
      </view>
      <view class="fixed-footer">
        <button
          v-if="registration.status==='active'"
          class="secondary"
          :disabled="busy || !cancellable"
          :loading="busy"
          @click="cancel"
        >
          取消报名
        </button>
        <button
          v-if="registration.status==='active'"
          class="primary"
          :disabled="busy || !editable"
          @click="edit"
        >
          {{ editable?'修改报名信息':'答案已锁定' }}
        </button>
        <button
          v-else
          class="primary"
          @click="navigate(routes.detail+'?id='+id)"
        >
          返回活动详情
        </button>
      </view>
    </template>
  </view>
</template>
<style scoped>
.registration-detail{min-height:100vh;background:#f1f8f5;padding:24rpx 24rpx calc(156rpx + env(safe-area-inset-bottom));color:#16333c;font-size:28rpx}.detail-card{background:#fff;border-radius:20rpx;padding:22rpx;margin-bottom:16rpx}.summary{display:flex;align-items:stretch;gap:20rpx;padding:16rpx}.cover{width:208rpx;min-height:210rpx;height:240rpx;flex-shrink:0;border-radius:10rpx}.no-cover{display:flex;align-items:center;justify-content:center;background:#e7f0eb;color:#78918a;font-size:26rpx}.summary-content{flex:1;min-width:0}.summary-title{font-size:29rpx;font-weight:600;line-height:1.5;overflow-wrap:anywhere;margin-bottom:10rpx}.tags{display:flex;flex-wrap:wrap;gap:10rpx;margin-bottom:10rpx}.fee-tag,.registration-tag{padding:5rpx 12rpx;border-radius:8rpx;font-size:25rpx;background:#fff1e6;color:#f77624}.registration-tag{background:#e0f8ea;color:#06a862}.registration-tag.inactive{background:#edf0ee;color:#7c8b85}.meta,.organizer-link{display:flex;align-items:flex-start;gap:10rpx;line-height:1.6;font-size:26rpx;margin-top:8rpx}.meta text{flex:1;min-width:0;overflow-wrap:anywhere}.organizer-link{background:transparent;padding:0;text-align:left;color:#16333c;border-radius:0;min-height:44rpx}.organizer-link:after,.contact-person:after,.copy-button:after{border:0}.heading{font-size:32rpx;font-weight:600;line-height:1.5;margin-bottom:18rpx}.status{display:flex;align-items:center;gap:20rpx}.status-icon{width:70rpx;height:70rpx;flex-shrink:0;background:#cef6e1;border-radius:50%;display:flex;align-items:center;justify-content:center}.status-title{font-size:36rpx;font-weight:600;color:#128358;margin-bottom:5rpx}.muted{font-size:26rpx;color:#718b94;line-height:1.6}.status.warning .status-icon{background:#fff3dc}.status.warning .status-title{color:#b77925}.status.muted .status-icon{background:#eef1ef}.status.muted .status-title{color:#74817c}.registered-at{border-top:1rpx solid #dce7e4;margin-top:20rpx;padding-top:15rpx;display:flex;align-items:center;gap:12rpx;font-size:27rpx;line-height:1.6}.section-top{display:flex;justify-content:space-between;align-items:center;gap:12rpx;margin-bottom:16rpx}.section-top .heading{margin:0}.text-button{font-size:26rpx;padding:8rpx 0;color:#159764;flex-shrink:0}.answer-row{display:grid;grid-template-columns:32rpx 180rpx minmax(0,1fr);gap:12rpx;font-size:28rpx;line-height:1.65;margin:12rpx 0;overflow-wrap:anywhere}.answer-label{color:#6c8793}.answer-value{white-space:pre-wrap}.consultation-hint{margin-top:-10rpx;margin-bottom:20rpx}.consultation{display:flex;align-items:center;gap:12rpx}.contact-person{flex:1;min-width:0;display:flex;align-items:center;gap:14rpx;background:transparent;padding:0;text-align:left;line-height:1.6;color:inherit}.contact-person>view{min-width:0}.avatar{width:74rpx;height:74rpx;border-radius:50%;flex-shrink:0}.avatar-placeholder{display:flex;align-items:center;justify-content:center;background:#e8f2ed}.organizer-name{font-size:29rpx;font-weight:600;overflow-wrap:anywhere}.organizer-tag{font-size:23rpx;color:#149966;background:#e7f8ef;border-radius:5rpx;padding:3rpx 7rpx;white-space:nowrap;font-weight:400}.contact{font-size:25rpx;color:#6d8791;white-space:pre-wrap;overflow-wrap:anywhere;margin-top:7rpx}.copy-button{flex-shrink:0;padding:0;background:transparent;font-size:24rpx;color:#6d8791;line-height:1.6}.copy-icon{width:68rpx;height:68rpx;border-radius:50%;background:#eaf8f1;display:flex;align-items:center;justify-content:center;margin:0 auto 8rpx}.notice-box{display:flex;align-items:flex-start;gap:12rpx;background:#fff5e9;border-radius:12rpx;padding:18rpx;color:#e76d19;font-size:26rpx;line-height:1.75}.notice-box>view{flex:1;min-width:0}.fixed-footer{gap:12rpx;padding:16rpx 26rpx calc(18rpx + env(safe-area-inset-bottom))}.fixed-footer button{font-size:30rpx;min-height:84rpx;border-radius:50rpx}.fixed-footer .secondary{flex:0.8}.fixed-footer .primary{flex:1.25;background:linear-gradient(110deg,#09a86b,#00885a)}
.clock-icon{position:relative;width:28rpx;height:28rpx;box-sizing:border-box;border:3rpx solid #173c3b;border-radius:50%;flex-shrink:0;margin:5rpx 2rpx}.clock-icon::before{content:"";position:absolute;left:10rpx;top:4rpx;width:3rpx;height:9rpx;background:#173c3b;border-radius:2rpx}.clock-icon::after{content:"";position:absolute;left:10rpx;top:10rpx;width:8rpx;height:3rpx;background:#173c3b;border-radius:2rpx;transform:rotate(25deg);transform-origin:left center}
</style>
