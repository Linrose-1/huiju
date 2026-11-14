<script setup lang="ts">
defineProps<{ title: string; subtitle: string }>()

const windowInfo = uni.getWindowInfo?.() ?? uni.getSystemInfoSync()
const statusHeight = windowInfo.statusBarHeight ?? 0
const capsule = uni.getMenuButtonBoundingClientRect()
const hasCapsule = capsule?.width > 0 && capsule.top >= statusHeight
const barHeight = hasCapsule ? Math.max(40, capsule.height + 2 * (capsule.top - statusHeight)) : 44
const sideInset = hasCapsule ? windowInfo.windowWidth - capsule.left + 4 : 92
</script>

<template>
  <view :style="{ height: (statusHeight + barHeight) + 'px' }">
    <view class="tab-header" :style="{ paddingTop: statusHeight + 'px' }">
      <view class="tab-header-content" :style="{ height: barHeight + 'px', margin: '0 ' + sideInset + 'px' }">
        <text class="tab-header-title">{{ title }}</text>
        <text class="tab-header-subtitle">{{ subtitle }}</text>
      </view>
    </view>
  </view>
</template>

<style scoped>
.tab-header {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  z-index: 10;
  background: #fff;
}
.tab-header-content {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  white-space: nowrap;
}
.tab-header-title { color: #17231e; font-size: 34rpx; font-weight: 500; line-height: 1.2; }
.tab-header-subtitle { color: #59655f; font-size: 22rpx; line-height: 1.2; }
</style>
