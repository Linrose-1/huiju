<script setup lang="ts">
import { computed } from 'vue'
import type { Activity, ManagedActivity } from '@/services/api/types'
import { mediaUrl } from '@/services/api/environment'
import { activityTimeRangeWeekday, fee } from '@/services/presentation'
import { myActivityState, myActivityLabel } from '@/services/my-activities'
const props = defineProps<{ activity: Activity | ManagedActivity; registrationStatus?: string; organized?: boolean; now: number }>()
defineEmits<{ (e: 'open'): void }>()
const state = computed(() => myActivityState(props.activity, props.registrationStatus, props.now))
const label = computed(() => myActivityLabel(props.activity, props.registrationStatus, props.now))
const action = computed(() => !props.organized || ['ended', 'cancelled', 'removed'].includes(state.value) ? '查看' : state.value === 'draft' ? '编辑草稿' : '管理')
const count = computed(() => props.activity.registrationState === 'cancelled' ? props.activity.cancellationRegistrationCount ?? props.activity.activeRegistrationCount : props.activity.activeRegistrationCount)
</script>
<template>
  <view
    class="activity-card"
    @click="$emit('open')"
  >
    <view class="cover-wrap">
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
        <uni-icons
          type="image"
          size="48rpx"
          color="#91a79c"
        /><text>暂无封面</text>
      </view>
      <text
        class="status"
        :class="state"
      >
        {{ label }}
      </text>
    </view>
    <view class="content">
      <view class="activity-title">
        {{ activity.title || '未命名草稿' }}
      </view>
      <view class="meta">
        <view class="clock-icon" /><text class="meta-copy">
          {{ activityTimeRangeWeekday(activity.startsAt, activity.endsAt) }}
        </text>
      </view>
      <view class="meta">
        <uni-icons
          type="location"
          size="28rpx"
          color="#243c32"
        /><text class="meta-copy">
          {{ activity.location || '地点待填写' }}
        </text>
      </view>
      <view
        class="fee"
        :class="{paid:activity.feeType==='paid'}"
      >
        {{ activity.feeType==='paid' ? '收费活动 ' + fee(activity) : '免费活动' }}<text
          v-if="registrationStatus==='active' && !['removed','cancelled'].includes(state)"
          class="joined"
        >
          已报名
        </text>
      </view>
      <view class="card-bottom">
        <view class="stat">
          <text class="number">
            {{ count }}
          </text><text>{{ activity.registrationState==='cancelled'?'取消前报名':'已报名' }}</text>
        </view>
        <view class="stat capacity">
          <text class="number">
            {{ activity.capacity ?? '不限' }}
          </text><text>名额限制</text>
        </view>
        <button
          class="action"
          @click.stop="$emit('open')"
        >
          {{ action }}
        </button>
      </view>
    </view>
  </view>
</template>
<style scoped>
.activity-card{display:flex;gap:20rpx;padding:18rpx;background:#fff;border-radius:18rpx;margin-bottom:14rpx}.cover-wrap{width:164rpx;min-height:190rpx;flex-shrink:0;position:relative}.cover{width:100%;height:100%;position:absolute;left:0;top:0;border-radius:10rpx}.no-cover{display:flex;flex-direction:column;gap:12rpx;align-items:center;justify-content:center;background:#edf3ef;color:#80948a;font-size:22rpx}.status{position:absolute;left:8rpx;top:10rpx;padding:6rpx 10rpx;border-radius:8rpx;background:#dff7e8;color:#128a51;font-size:26rpx;line-height:1.35}.status.ended,.status.draft,.status.removed{background:#f0f2f4;color:#63717e}.status.cancelled{background:#ffe9ec;color:#c25162}.content{flex:1;min-width:0}.activity-title{font-size:29rpx;line-height:1.45;font-weight:600;color:#14201c;display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:2;overflow:hidden;margin-bottom:10rpx;overflow-wrap:anywhere}.meta{display:flex;align-items:flex-start;gap:10rpx;font-size:26rpx;line-height:1.5;color:#718077;margin-top:5rpx}.meta-copy{min-width:0;overflow-wrap:anywhere}.fee{font-size:24rpx;color:#218256;margin-top:9rpx}.fee.paid{color:#bb763c}.joined{margin-left:14rpx;color:#218256}.card-bottom{display:flex;align-items:center;margin-top:15rpx;gap:12rpx}.stat{display:flex;flex-direction:column;align-items:center;font-size:24rpx;color:#8a958f;line-height:1.45;min-width:78rpx}.number{font-size:26rpx;color:#16251f}.capacity{border-left:1rpx solid #edf1ef;padding-left:12rpx}.action{margin:0 0 0 auto;padding:0 20rpx;height:68rpx;line-height:68rpx;min-width:112rpx;background:#edf8f2;color:#168453;font-size:28rpx;border-radius:26rpx;font-weight:500}.action::after{border:0}
.clock-icon{position:relative;box-sizing:border-box;width:26rpx;height:26rpx;border:2rpx solid #243c32;border-radius:50%;flex-shrink:0;margin:4rpx 1rpx 0}.clock-icon::before{content:'';position:absolute;left:10rpx;top:4rpx;width:2rpx;height:8rpx;background:#243c32}.clock-icon::after{content:'';position:absolute;left:10rpx;top:10rpx;width:7rpx;height:2rpx;transform:rotate(25deg);transform-origin:left;background:#243c32}
</style>
