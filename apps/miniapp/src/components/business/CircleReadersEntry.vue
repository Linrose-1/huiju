<script setup lang="ts">
import type { CirclePost } from '@/services/api/types'
import { mediaUrl } from '@/services/api/environment'
import { navigate, routes } from '@/services/navigation'
const props = defineProps<{ post: CirclePost }>()
function openReaders() { navigate(routes.circleReaders + '?id=' + encodeURIComponent(props.post.id)) }
</script>
<template>
  <view
    v-if="post.state !== 'removed' && post.readSummary"
    class="read-entry"
    role="button"
    @click.stop="openReaders"
  >
    <view class="portraits">
      <view
        v-for="reader in post.readSummary.recentReaders.slice(0, 2)"
        :key="reader.memberId"
        class="portrait"
      >
        <image
          v-if="reader.avatarUrl"
          :src="mediaUrl(reader.avatarUrl)"
          mode="aspectFill"
        />
        <text v-else>
          {{ reader.displayName?.slice(0, 1) || '友' }}
        </text>
      </view>
    </view>
    <text>{{ post.readSummary.total }} 人读过</text>
    <uni-icons
      type="arrow-right"
      size="22rpx"
      color="#678577"
    />
  </view>
</template>
<style scoped>
.read-entry{display:flex;align-items:center;justify-content:flex-end;gap:8rpx;min-height:68rpx;color:#4c7061;font-size:24rpx}
.portraits{display:flex;padding-left:6rpx}.portrait{display:flex;align-items:center;justify-content:center;width:40rpx;height:40rpx;margin-left:-6rpx;border:2rpx solid white;border-radius:50%;background:#e7f0e9;overflow:hidden}.portrait image{width:100%;height:100%}
</style>
