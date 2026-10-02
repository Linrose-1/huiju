<script setup lang="ts">
defineProps<{ loading: boolean; error: string; hasMore: boolean; hasItems: boolean }>()
defineEmits<{ (event: 'retry'): void }>()
</script>
<template>
  <view class="list-more">
    <text v-if="loading">
      正在加载更多…
    </text>
    <view v-else-if="error">
      {{ error }}<button
        class="text-button"
        @click="$emit('retry')"
      >
        重试
      </button>
    </view>
    <text v-else-if="hasItems">
      {{ hasMore ? '继续上滑加载更多' : '没有更多了' }}
    </text>
  </view>
</template>
<style scoped>
.list-more{text-align:center;color:#819086;font-size:25rpx;line-height:1.6;padding:20rpx 12rpx}.list-more .text-button{font-size:26rpx;min-height:64rpx}
</style>
