<script setup lang="ts">
import { computed } from 'vue'
import type { Activity, ManagedActivity, MyRegistration } from '@/services/api/types'
import { mediaUrl } from '@/services/api/environment'
import { activityTimeRangeWeekday, chinaParts, dateTime, fee } from '@/services/presentation'
import { myActivityState, myActivityLabel } from '@/services/my-activities'

const props = defineProps<{ activity: Activity | ManagedActivity; registration?: MyRegistration; previousStart?: string; now: number }>()
defineEmits<{ (e: 'open'): void; (e: 'edit'): void; (e: 'roster'): void }>()
const state = computed(() => myActivityState(props.activity, undefined, props.now))
const label = computed(() => myActivityLabel(props.activity, undefined, props.now))
const time = computed(() => activityTimeRangeWeekday(props.activity.startsAt, props.activity.endsAt))
const count = computed(() => props.activity.registrationState === 'cancelled' ? props.activity.cancellationRegistrationCount ?? props.activity.activeRegistrationCount : props.activity.activeRegistrationCount)
const editable = computed(() => ['draft', 'upcoming', 'ongoing'].includes(state.value))
const start = computed(() => chinaParts(props.activity.startsAt))
const end = computed(() => chinaParts(props.activity.endsAt))
const newMonth = computed(() => !props.previousStart || chinaParts(props.previousStart)?.monthLabel !== start.value?.monthLabel)
const schedule = computed(() => {
  if (!start.value || !end.value) return '时间待更新'
  const endDate = end.value.date !== start.value.date ? end.value.date + ' ' : ''
  return start.value.time + '–' + endDate + end.value.time
})
</script>
<template>
  <view v-if="registration" class="itinerary">
    <view v-if="newMonth" class="month">{{ start?.monthLabel || '时间待更新' }}</view>
    <view class="entry" @click="$emit('open')">
      <view class="date-col">
        <view class="day">{{ start?.date.slice(-2) || '—' }}</view>
        <view>{{ start?.week }}</view>
      </view>
      <view class="entry-main">
        <view class="time">{{ schedule }}</view>
        <view class="title">{{ activity.title }}</view>
        <view class="detail"><uni-icons type="location" size="26rpx" color="#657167" /> {{ activity.location }}</view>
        <view class="receipt">
          <view>
            <view>{{ registration.status === 'cancelled' ? '已取消报名' : '已报名' }} · {{ registration.feeQualification === 'invited_free' ? '特邀免费' : fee(activity) }}</view>
            <view v-if="state === 'removed' || state === 'cancelled'">{{ label }}</view>
            <view class="stamp">报名时间 {{ dateTime(registration.currentRegisteredAt) }}</view>
          </view>
          <button class="link" @click.stop="$emit('open')">查看报名信息 ›</button>
        </view>
      </view>
    </view>
  </view>
  <view v-else class="organizer" @click="$emit('open')">
    <view class="overview">
      <image v-if="activity.coverUrl" class="cover" :src="mediaUrl(activity.coverUrl)" mode="aspectFill" />
      <view class="summary">
        <view class="title">{{ activity.title || '未命名草稿' }}</view>
        <text class="badge" :class="{ live: activity.registrationState === 'open' && state === 'upcoming' }">{{ activity.registrationState === 'open' && state === 'upcoming' ? '报名中' : label }}</text>
        <view class="detail"><uni-icons type="calendar" size="26rpx" color="#657167" /> {{ time }}</view>
      </view>
    </view>
    <view class="actions">
      <view v-if="state !== 'draft'" class="numbers">
        <view><text class="count">{{ count }}</text> {{ state === 'cancelled' ? '人曾报名' : '人已报名' }}</view>
        <view class="stamp">{{ activity.capacity == null ? '人数不限' : '限额 ' + activity.capacity + ' 人' }}</view>
      </view>
      <button v-if="state !== 'draft'" class="primary-action" @click.stop="$emit('roster')">报名名单</button>
      <button v-if="editable" :class="state === 'draft' ? 'primary-action' : 'action'" @click.stop="$emit('edit')">{{ state === 'draft' ? '编辑草稿' : '编辑' }}</button>
      <button class="action" @click.stop="$emit('open')">管理</button>
    </view>
  </view>
</template>
<style scoped>
.itinerary,.organizer{color:#152119}
.month{margin-top:20rpx;background:#edf3ee;padding:12rpx 28rpx;font-size:30rpx;font-weight:600}
.entry,.overview,.actions,.receipt{display:flex}
.entry{margin:28rpx 26rpx 36rpx;gap:22rpx}
.date-col{width:82rpx;flex-shrink:0;border-right:1rpx solid #d4ded7;font-size:25rpx;color:#58615b}
.day,.count{font-variant-numeric:tabular-nums;font-size:48rpx;font-weight:700;color:#19271e}
.entry-main,.summary{min-width:0;flex:1}
.time,.count{color:#205f36}
.time{font-size:32rpx;font-weight:650}
.title{font-size:33rpx;font-weight:650;line-height:1.4;overflow-wrap:anywhere}
.entry .title{margin:8rpx 0}
.detail,.stamp{font-size:24rpx;color:#626c64;line-height:1.5;overflow-wrap:anywhere}
.receipt,.actions{border-top:1rpx solid #e0e6e0;align-items:center;gap:10rpx;flex-wrap:wrap}
.receipt{justify-content:space-between;margin-top:22rpx;padding-top:14rpx;font-size:25rpx;color:#465249}
.stamp{margin-top:3rpx;font-size:22rpx}
.link,.action,.primary-action{margin:0;line-height:1.4;white-space:nowrap;font-size:26rpx}
.link{background:transparent;color:#205f36;padding:12rpx 0}
.link::after,.action::after,.primary-action::after{border:0}
.organizer{margin:20rpx 20rpx 0;padding:22rpx;background:white;border-radius:18rpx;border:1rpx solid #e2e9e3}
.overview{align-items:center;gap:20rpx}
.cover{flex:none;width:148rpx;height:148rpx;border-radius:12rpx}
.badge{display:inline-block;font-size:22rpx;color:#5f685f;background:#f0f2ef;padding:3rpx 10rpx;border-radius:6rpx;margin:7rpx 0}
.badge.live{background:#e4f1e3;color:#235d37}
.actions{justify-content:flex-end;padding-top:17rpx;margin-top:18rpx}
.numbers{margin-right:auto;font-size:23rpx}
.count{font-size:42rpx}
.action,.primary-action{padding:12rpx 17rpx;border-radius:8rpx;border:1rpx solid #bbc7bd;background:white;color:#293c2d}
.primary-action{background:#205f36;color:white;border-color:#205f36}
</style>