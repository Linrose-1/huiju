<script setup lang="ts">
import { ref, watch } from 'vue'
import { onLoad, onShow, onUnload, onShareAppMessage } from '@dcloudio/uni-app'
import { api, ApiError, errorMessage } from '@/services/api'
import type { Activity, PublicMember, Registration, ReadingList } from '@/services/api/types'
import { mediaUrl } from '@/services/api/environment'
import { dateTime, fee, stateText, feeNotice, feeDisclaimer, activityTimeRangeWeekday } from '@/services/presentation'
import { navigate, routes, requireProfile } from '@/services/navigation'
import { useSessionStore } from '@/stores/session'
import { createReadingVisit } from '@/services/reading'
import RequestState from '@/components/base/RequestState.vue'
const id = ref(''), activity = ref<Activity | null>(null), roster = ref<PublicMember[]>([]), registration = ref<Registration | null>(null), loading = ref(true), busy = ref(false), error = ref(''), rosterError = ref(''), expanded = ref(false)
const rosterExpanded = ref(false)
const session = useSessionStore()
let generation = 0
let alive = true
const openingMember = ref(false)
async function openMember(memberId: string) {
    if (openingMember.value || !memberId) return
    openingMember.value = true
    const target = routes.memberCard + '?id=' + encodeURIComponent(memberId)
    try {
        if (await requireProfile(target) && alive) navigate(target)
    } catch (e) {
        if (alive) uni.showToast({ title: errorMessage(e), icon: 'none' })
    } finally { openingMember.value = false }
}
let visit: ReturnType<typeof createReadingVisit> | null = null
const readers = ref<ReadingList>({ items: [], total: 0, hasMore: false })
const readersExpanded = ref(false), readersLoading = ref(false), readersError = ref('')
async function loadReaders(more = false) {
    const current = generation, token = session.token, epoch = session.epoch
    const isCurrent = () => current === generation && token === session.token && epoch === session.epoch
    if (!activity.value || (more && readersLoading.value)) return
    readersLoading.value = true; readersError.value = ''
    try {
        if (!more && activity.value.registrationState !== 'removed') {
            visit ??= createReadingVisit()
            await visit.record(id.value, isCurrent)
        }
        if (!isCurrent()) return
        const result = await api.activityReaders(id.value, more ? readers.value.items.length : 0)
        if (isCurrent()) readers.value = { ...result, items: more ? [...readers.value.items, ...result.items] : result.items }
    } catch (e) { if (isCurrent()) readersError.value = errorMessage(e) }
    finally { if (isCurrent()) readersLoading.value = false }
}
async function loadRegistration(isCurrent: () => boolean) {
    if (!session.token)
        return
    try {
        const result = await api.myRegistration(id.value)
        if (isCurrent())
            registration.value = result
    }
    catch (e) {
        if (isCurrent() && !(e instanceof ApiError && e.status === 404))
            error.value = errorMessage(e)
    }
}
async function load() { if (!id.value)
    return
    const current = ++generation, token = session.token, epoch = session.epoch
    const isCurrent = () => current === generation && token === session.token && epoch === session.epoch
    loading.value = true; error.value = ''; registration.value = null
    readers.value = { items: [], total: 0, hasMore: false }; readersError.value = ''; readersLoading.value = false
    void loadRegistration(isCurrent)
    try {
    const result = await api.activity(id.value)
    if (!isCurrent())
        return
    activity.value = result
    void loadReaders()
    try {
        const people = await api.roster(id.value)
        if (isCurrent()) {
            roster.value = people.items
            rosterError.value = ''
        }
    }
    catch (e) {
        if (isCurrent())
            rosterError.value = errorMessage(e)
    }
}
catch (e) {
    if (isCurrent())
        error.value = errorMessage(e)
}
finally {
    if (isCurrent())
        loading.value = false
} }
const stopWatchingSession = watch(() => [session.token, session.epoch], () => { void load() })
onUnload(() => { alive = false; generation += 1; stopWatchingSession() })
async function register() { if (busy.value)
    return; busy.value = true; try {
    if (registration.value?.status === 'active') {
        navigate(routes.result + '?id=' + id.value)
        return
    }
    const target = routes.form + '?id=' + id.value
    if (await requireProfile(target))
        navigate(target)
}
catch (e) {
    error.value = errorMessage(e)
}
finally {
    busy.value = false
} }
onLoad(options => { id.value = String(options?.id || ''); if (options?.inviteCode)
    session.pendingInvite = String(options.inviteCode).slice(0, 32); if (!id.value) {
    loading.value = false
    error.value = '活动链接不完整，请从活动列表重新进入'
} })
onShow(() => { visit = null; readersExpanded.value = false; void load() })
onShareAppMessage(() => ({ title: activity.value?.title || '会聚活动', path: routes.detail + '?id=' + id.value + (session.member?.inviteCode ? '&inviteCode=' + encodeURIComponent(session.member.inviteCode) : '') }))
</script>
<template>
  <view class="page-pad with-footer activity-detail">
    <RequestState
      :loading="loading"
      :error="error"
      @retry="load"
    /><template v-if="activity && !loading && !error">
      <image
        v-if="activity.coverUrl"
        :src="mediaUrl(activity.coverUrl)"
        class="detail-cover"
        mode="aspectFill"
      />
      <view class="card summary-card">
        <view class="section-title mark activity-title">{{ activity.title }}</view><view class="row badges">
          <text
            class="tag paid"
          >
            {{ activity.feeType==='paid'?'收费活动':'免费活动' }}
          </text><text
            v-if="activity.feeType==='paid'"
            class="tag paid"
          >
            {{ fee(activity) }}
          </text><text
            class="tag"
            :class="{inactive:activity.registrationState!=='open'}"
          >
            {{ stateText(activity.registrationState) }}
          </text>
        </view><view class="meta">
          <view
            class="clock-icon"
          /><text>{{ activityTimeRangeWeekday(activity.startsAt, activity.endsAt) }}</text>
        </view><view class="meta">
          <uni-icons
            type="location"
            size="36rpx"
          /><text>{{ activity.location }}</text>
        </view><view class="meta">
          <uni-icons
            type="staff"
            size="36rpx"
          /><text>{{ activity.capacity?'限额 '+activity.capacity+' 人':'不限人数' }}｜已报名 {{ activity.activeRegistrationCount }} 人</text>
        </view><view
          v-if="activity.organizer"
          class="meta organizer-row"
          @click="openMember(activity.organizer.memberId)"
        >
          <view class="avatar organizer-avatar">
            <image
              v-if="activity.organizer.avatarUrl"
              :src="mediaUrl(activity.organizer.avatarUrl)"
              mode="aspectFill"
            /><uni-icons
              v-else
              type="person"
              size="32rpx"
            />
          </view><text>发起人</text><text class="organizer-name">{{ activity.organizer.displayName || '会聚会员' }}</text><uni-icons
            type="arrow-right"
            size="28rpx"
            color="#818791"
          />
        </view><view
          v-if="activity.registrationState==='cancelled'"
          class="notice"
        >
          活动已取消，取消前已有 {{ activity.cancellationRegistrationCount ?? activity.activeRegistrationCount }} 人报名。{{ activity.cancellationReason }}
        </view>
      </view>
      <view class="card">
        <view class="section-title mark">活动介绍</view><view
          class="intro"
          :class="{collapsed:!expanded}"
        >
          {{ activity.description }}
        </view><button
          class="text-button expand"
          @click="expanded=!expanded"
        >
          {{ expanded?'收起':'展开' }} <uni-icons
            :type="expanded?'up':'down'"
            size="28rpx"
            color="#296b51"
          />
        </button><view
          v-if="activity.feeType==='paid'"
          class="notice fee-notice"
        >
          <uni-icons
            type="info-filled"
            size="40rpx"
            color="#e57a28"
          /><view>{{ feeNotice }}。<br>{{ feeDisclaimer }}。</view>
        </view>
      </view>
      <view class="card">
        <view class="section-title mark">报名信息</view><view class="meta">
          <uni-icons
            type="calendar"
            size="36rpx"
          /><text class="meta-label">报名截止</text><text class="meta-value">{{ dateTime(activity.registrationDeadline) }}</text>
        </view><view class="meta">
          <uni-icons
            type="headphones"
            size="36rpx"
          /><text class="meta-label">活动咨询</text><text class="meta-value">{{ activity.consultationContact || '报名成功后可查看活动咨询方式' }}</text>
        </view>
      </view>
      <view class="card">
        <view class="section-heading">
          <view class="section-title mark">已报名（{{ activity.activeRegistrationCount }}）</view>
          <button
            v-if="roster.length > 8"
            class="view-all"
            @click="rosterExpanded=!rosterExpanded"
          >
            {{ rosterExpanded ? '收起' : '查看全部' }}<uni-icons
              :type="rosterExpanded ? 'up' : 'right'"
              size="28rpx"
              color="#1d654e"
            />
          </button>
        </view><text
          v-if="rosterError"
          class="muted small"
        >
          {{ rosterError }}
        </text><view
          v-else-if="!roster.length"
          class="muted small"
        >
          还没有人报名
        </view><view
          v-else
          class="roster"
        >
          <view
            v-for="person in (rosterExpanded ? roster : roster.slice(0,8))"
            :key="person.memberId"
            class="person"
            @click="openMember(person.memberId)"
          >
            <view class="avatar">
              <image
                v-if="person.avatarUrl"
                :src="mediaUrl(person.avatarUrl)"
                mode="aspectFill"
              /><uni-icons
                v-else
                type="person"
                size="36rpx"
                color="#82968a"
              />
            </view><text>{{ person.displayName || '会聚会员' }}</text>
          </view>
        </view>
      </view>
      <view class="card">
        <view class="section-heading">
          <view class="section-title mark">阅读留痕{{ readers.total ? '（'+readers.total+'）' : '' }}</view>
          <button
            v-if="readers.total > 8"
            class="view-all"
            @click="readersExpanded=!readersExpanded"
          >
            {{ readersExpanded ? '收起' : '查看全部' }}
          </button>
        </view>
        <view
          v-if="readers.items.length"
          class="roster"
        >
          <view
            v-for="person in (readersExpanded ? readers.items : readers.items.slice(0,8))"
            :key="person.memberId"
            class="person"
            @click="openMember(person.memberId)"
          >
            <view class="avatar">
              <image
                v-if="person.avatarUrl"
                :src="mediaUrl(person.avatarUrl)"
                mode="aspectFill"
              /><uni-icons
                v-else
                type="person"
                size="36rpx"
                color="#82968a"
              />
            </view>
            <text>{{ person.displayName }}</text>
          </view>
        </view>
        <text
          v-if="readersLoading"
          class="muted small"
        >
          正在加载阅读记录…
        </text>
        <view
          v-else-if="readersError"
          class="muted small"
        >
          {{ readersError }}<button
            class="text-button"
            @click="loadReaders()"
          >
            重试
          </button>
        </view>
        <text
          v-else-if="!readers.items.length"
          class="muted small"
        >
          暂无会员阅读记录
        </text>
        <button
          v-if="readersExpanded && readers.hasMore && !readersError"
          class="text-button"
          :disabled="readersLoading"
          @click="loadReaders(true)"
        >
          加载更多
        </button>
      </view><view class="card"><view class="section-title mark">评论与点评</view><text class="muted small">评论与点评暂未开放</text></view>
      <view class="fixed-footer">
        <button
          class="secondary share"
          open-type="share"
        >
          <uni-icons
            type="upload"
            size="38rpx"
          /> 分享
        </button><button
          class="primary"
          :disabled="busy || (registration?.status!=='active' && activity.registrationState!=='open')"
          :loading="busy"
          @click="register"
        >
          {{ registration?.status==='active'?'查看我的报名':activity.registrationState==='open'?'立即报名':stateText(activity.registrationState) }}
        </button>
      </view>
    </template>
  </view>
</template>
<style scoped>
.activity-detail { padding: 0 26rpx calc(140rpx + env(safe-area-inset-bottom)); color: #111c2c; background: #f4f8f7; min-height: 100vh; }
.detail-cover { display: block; width: 100%; height: 216rpx; border-radius: 12rpx; margin-bottom: 12rpx; }
.card { padding: 16rpx 18rpx; margin-bottom: 12rpx; border-radius: 14rpx; }
.section-title { font-size: 32rpx; line-height: 44rpx; margin-bottom: 10rpx; color: #101a2b; font-weight: 600; overflow-wrap: anywhere; }
.section-title.mark { position: relative; padding-left: 14rpx; }
.section-title.mark::before { position: absolute; left: 0; top: 10rpx; width: 5rpx; height: 23rpx; margin: 0; border-radius: 5rpx; background: #267457; }
.activity-title { font-size: 34rpx; line-height: 46rpx; }
.badges { flex-wrap: wrap; gap: 12rpx; margin: 2rpx 0 12rpx; }
.tag { padding: 3rpx 12rpx; border-radius: 8rpx; font-size: 28rpx; line-height: 36rpx; background: #e6f7ed; color: #159254; }
.tag.paid { background: #fff2e8; color: #ed7429; }
.tag.inactive { background: #edf0f2; color: #64717c; }
.meta { gap: 14rpx; margin-top: 8rpx; font-size: 28rpx; line-height: 42rpx; color: #4b566d; align-items: flex-start; }
.meta > text { min-width: 0; overflow-wrap: anywhere; }
.meta-label { flex-shrink: 0; }
.meta-value { flex: 1; }
.clock-icon { position: relative; width: 29rpx; height: 29rpx; border: 3rpx solid #182234; border-radius: 50%; flex-shrink: 0; margin: 6rpx 4rpx 0 3rpx; }
.clock-icon::before { content: ''; position: absolute; left: 10rpx; top: 4rpx; width: 2rpx; height: 9rpx; background: #182234; }
.clock-icon::after { content: ''; position: absolute; left: 10rpx; top: 11rpx; width: 8rpx; height: 2rpx; transform: rotate(25deg); transform-origin: left; background: #182234; }
.organizer-row { align-items: center; min-height: 52rpx; gap: 14rpx; }
.organizer-avatar { width: 40rpx; height: 40rpx; }
.organizer-name { max-width: 360rpx; }
.intro { font-size: 28rpx; line-height: 1.6; color: #4b566d; white-space: pre-wrap; overflow-wrap: anywhere; }
.intro.collapsed { display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 2; overflow: hidden; }
.expand { text-align: right; font-size: 26rpx; line-height: 40rpx; min-height: 48rpx; padding: 0; }
.notice { margin-top: 12rpx; font-size: 26rpx; line-height: 1.5; padding: 14rpx; }
.fee-notice { display: flex; align-items: flex-start; gap: 12rpx; color: #ee7827; background: #fff5eb; }
.section-heading { display: flex; align-items: center; justify-content: space-between; gap: 8rpx; margin-bottom: 8rpx; }
.section-heading .section-title { margin-bottom: 0; }
.view-all { display: flex; align-items: center; flex-shrink: 0; background: transparent; color: #1d654e; font-size: 26rpx; min-height: 48rpx; line-height: 48rpx; padding: 0; }
.roster { display: grid; grid-template-columns: repeat(8,minmax(0,1fr)); gap: 14rpx 6rpx; }
.person { display: flex; flex-direction: column; align-items: center; min-width: 0; font-size: 24rpx; line-height: 34rpx; gap: 6rpx; }
.person text { display: block; max-width: 100%; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.person .avatar { width: 48rpx; height: 48rpx; }
.muted.small { display: block; font-size: 26rpx; line-height: 40rpx; padding: 6rpx 0; }
.fixed-footer { gap: 12rpx; padding: 10rpx 30rpx calc(10rpx + env(safe-area-inset-bottom)); box-shadow: none; }
.fixed-footer button { height: 84rpx; line-height: 84rpx; padding: 0 16rpx; font-size: 30rpx; }
.fixed-footer .share { flex: 0 0 210rpx; display: flex; align-items: center; justify-content: center; gap: 10rpx; background: #eff5f2; color: #16262b; }
.fixed-footer .primary { background: linear-gradient(110deg,#33996f,#145b45); }
.fixed-footer .primary[disabled] { background: #e3ebe5; color: #81938a; }
</style>
