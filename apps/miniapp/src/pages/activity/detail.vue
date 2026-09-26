<script setup lang="ts">
import { ref } from 'vue'
import { onLoad, onShow, onShareAppMessage } from '@dcloudio/uni-app'
import { api, ApiError, errorMessage } from '@/services/api'
import type { Activity, PublicMember, Registration } from '@/services/api/types'
import { mediaUrl } from '@/services/api/environment'
import { dateTime, fee, stateText, feeNotice, feeDisclaimer } from '@/services/presentation'
import { navigate, routes, requireProfile, unavailable } from '@/services/navigation'
import { useSessionStore } from '@/stores/session'
import RequestState from '@/components/base/RequestState.vue'
const id = ref(''), activity = ref<Activity | null>(null), roster = ref<PublicMember[]>([]), registration = ref<Registration | null>(null), loading = ref(true), busy = ref(false), error = ref(''), rosterError = ref(''), expanded = ref(false)
const session = useSessionStore()
async function load() { if (!id.value)
    return; loading.value = true; error.value = ''; registration.value = null; try {
    activity.value = await api.activity(id.value)
    try {
        roster.value = (await api.roster(id.value)).items
        rosterError.value = ''
    }
    catch (e) {
        rosterError.value = errorMessage(e)
    }
    if (session.token) {
        try {
            registration.value = await api.myRegistration(id.value)
        }
        catch (e) {
            if (!(e instanceof ApiError && e.status === 404))
                throw e
        }
    }
}
catch (e) {
    error.value = errorMessage(e)
}
finally {
    loading.value = false
} }
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
onShow(load)
onShareAppMessage(() => ({ title: activity.value?.title || '会聚活动', path: routes.detail + '?id=' + id.value + (session.member?.inviteCode ? '&inviteCode=' + encodeURIComponent(session.member.inviteCode) : '') }))
</script>
<template>
  <view class="page-pad with-footer">
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
      <view class="card">
        <view class="section-title mark">{{ activity.title }}</view><view class="row">
          <text
            class="tag"
            :class="{paid:activity.feeType==='paid'}"
          >
            {{ activity.feeType==='paid'?'收费活动 '+fee(activity):'免费活动' }}
          </text><text class="tag">{{ stateText(activity.registrationState) }}</text>
        </view><view class="meta">
          <view
            class="icon-placeholder"
            style="width:21px;height:21px"
          /><text>{{ dateTime(activity.startsAt) }} — {{ dateTime(activity.endsAt) }}</text>
        </view><view class="meta">
          <uni-icons
            type="location"
            size="21"
          /><text>{{ activity.location }}</text>
        </view><view class="meta">
          <uni-icons
            type="staff"
            size="21"
          /><text>{{ activity.capacity?'限额 '+activity.capacity+' 人':'不限人数' }}｜已报名 {{ activity.activeRegistrationCount }} 人</text>
        </view><view
          v-if="activity.organizer"
          class="meta"
        >
          <view class="avatar organizer-avatar">
            <image
              v-if="activity.organizer.avatarUrl"
              :src="mediaUrl(activity.organizer.avatarUrl)"
              mode="aspectFill"
            /><uni-icons
              v-else
              type="person"
              size="20"
            />
          </view><text>发起人 {{ activity.organizer.displayName || '会聚会员' }}</text>
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
            size="16"
            color="#296b51"
          />
        </button><view
          v-if="activity.feeType==='paid'"
          class="notice"
        >
          {{ feeNotice }}。<br>{{ feeDisclaimer }}。
        </view>
      </view>
      <view class="card">
        <view class="section-title mark">报名信息</view><view class="meta">
          <uni-icons
            type="calendar"
            size="21"
          /><text>报名截止 {{ dateTime(activity.registrationDeadline) }}</text>
        </view><view class="meta">
          <uni-icons
            type="headphones"
            size="21"
          /><text>活动咨询 {{ activity.consultationContact || '报名成功后可查看活动咨询方式' }}</text>
        </view>
      </view>
      <view class="card">
        <view class="section-title mark">已报名（{{ activity.activeRegistrationCount }}）</view><text
          v-if="rosterError"
          class="muted small"
        >
          {{ rosterError }}
        </text><view
          v-else-if="!roster.length"
          class="muted small"
        >
          还没有人报名
        </view><scroll-view
          v-else
          scroll-x
          class="roster"
        >
          <view
            v-for="(person,index) in roster"
            :key="index"
            class="person"
            @click="unavailable('会员名片暂未开放')"
          >
            <view class="avatar">
              <image
                v-if="person.avatarUrl"
                :src="mediaUrl(person.avatarUrl)"
                mode="aspectFill"
              /><uni-icons
                v-else
                type="person"
                size="24"
                color="#82968a"
              />
            </view><text>{{ person.displayName || '会聚会员' }}</text>
          </view>
        </scroll-view>
      </view>
      <view class="card"><view class="section-title mark">阅读留痕</view><text class="muted small">阅读留痕暂未开放</text></view><view class="card"><view class="section-title mark">评论与点评</view><text class="muted small">评论与点评暂未开放</text></view>
      <view class="fixed-footer">
        <button
          class="secondary share"
          open-type="share"
        >
          <uni-icons
            type="redo"
            size="22"
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
<style scoped>.organizer-avatar{width:40rpx;height:40rpx}.detail-cover{width:100%;height:235rpx;border-radius:12rpx;margin-bottom:16rpx}.section-title{font-size:28rpx;line-height:1.5;margin-bottom:14rpx}.intro{font-size:27rpx;color:#526070;line-height:1.75;white-space:pre-wrap}.intro.collapsed{display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:3;overflow:hidden}.expand{text-align:right}.roster{width:100%;white-space:nowrap}.person{display:inline-flex;flex-direction:column;align-items:center;width:84rpx;margin-right:10rpx;font-size:21rpx;gap:10rpx;vertical-align:top}.person text{max-width:84rpx;overflow:hidden;text-overflow:ellipsis}.person .avatar{width:60rpx;height:60rpx}.fixed-footer .share{flex:0 0 210rpx}.notice{margin-top:18rpx}</style>
