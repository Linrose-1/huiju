<script setup lang="ts">
defineProps<{ displayName: string; visible: boolean }>()
</script>
<template>
  <view
    v-if="visible"
    class="brand-mark"
  >
    <text>{{ displayName }}</text>
  </view>
</template>
<style scoped>
.brand-mark { padding: 16rpx 30rpx; color: #185f48; font-size: 30rpx; font-weight: 600; line-height: 1.4; overflow-wrap: anywhere; background: #f4f8f6; }
</style>
