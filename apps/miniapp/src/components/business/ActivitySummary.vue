<script setup lang="ts">
import type { Activity } from '@/services/api/types'
import { mediaUrl } from '@/services/api/environment'
import { activityTimeRange, fee } from '@/services/presentation'
defineProps<{
    activity: Activity
    showOrganizer?: boolean
    registrationLabel?: string
}>()
</script>
<template>
  <view
    class="card summary row"
    :class="{detailed:showOrganizer}"
  >
    <image
      v-if="activity.coverUrl"
      :src="mediaUrl(activity.coverUrl)"
      class="summary-cover"
      mode="aspectFill"
    /><view
      v-else
      class="summary-cover no-cover"
    >
      暂无封面
    </view><view class="grow">
      <view class="summary-title">
        {{ activity.title }}
      </view><view
        v-if="showOrganizer || registrationLabel || activity.feeType==='paid'"
        class="summary-tags"
      >
        <view
          class="tag"
          :class="{paid:activity.feeType==='paid'}"
        >
          {{ activity.feeType==='paid'?'收费活动':'免费活动' }}
        </view><view
          v-if="activity.feeType==='paid'"
          class="tag paid"
        >
          {{ fee(activity) }}
        </view><view
          v-if="registrationLabel"
          class="tag"
          :class="{inactive:registrationLabel==='已取消'}"
        >
          {{ registrationLabel }}
        </view>
      </view><view class="meta">
        <view
          class="icon-placeholder"
          style="width:18px;height:18px"
        /><text>{{ activityTimeRange(activity.startsAt, activity.endsAt) }}</text>
      </view><view class="meta">
        <uni-icons
          type="location"
          size="18"
          color="#386b59"
        /><text>{{ activity.location }}</text>
      </view><view
        v-if="showOrganizer && activity.organizer"
        class="meta"
      >
        <uni-icons
          type="person"
          size="18"
          color="#386b59"
        /><text>发起人 {{ activity.organizer.displayName || '会聚会员' }}</text>
      </view>
    </view>
  </view>
</template>
<style scoped>.summary{align-items:flex-start;gap:20rpx}.summary-cover{width:220rpx;height:160rpx;border-radius:10rpx;flex-shrink:0}.summary.detailed .summary-cover{height:190rpx}.summary-tags{display:flex;flex-wrap:wrap;gap:8rpx;margin-bottom:8rpx}.summary-tags .tag.inactive{background:#eef1ef;color:#74817c}.summary-tags .tag{font-size:21rpx;padding:5rpx 10rpx}.no-cover{display:flex;align-items:center;justify-content:center;background:#edf2ef;color:#86968c;font-size:24rpx}.summary-title{font-size:28rpx;font-weight:600;line-height:1.5;margin-bottom:12rpx;overflow-wrap:anywhere}.summary .meta{font-size:23rpx;align-items:flex-start}.summary .meta text{min-width:0;overflow-wrap:anywhere}</style>
