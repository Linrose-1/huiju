<script setup lang="ts">
import { routes } from '@/services/navigation'

defineEmits<{ (event: 'back'): void }>()
function browseGatherings() {
  uni.switchTab({ url: routes.activity })
}
</script>

<template>
  <view class="membership-note">
    <view class="note-title">谁可以发起聚会？</view>
    <view class="note-copy">学加社群的在册会员可以发起聚会。你目前以受邀朋友身份参与，可以报名参加向你开放的聚会。</view>
    <view class="note-copy">如果你已经是社群成员，可以请社群管理员确认身份。</view>
    <button class="primary note-action" @click="browseGatherings">去看看聚会</button>
    <button class="note-back" @click="$emit('back')">返回 i 助手</button>
  </view>
</template>

<style scoped>
.membership-note { padding: 36rpx; border: 1rpx solid #dce7e0; border-radius: 24rpx; background: #fff; }
.note-title { color: #183d30; font-size: 36rpx; font-weight: 600; }
.note-copy { margin-top: 20rpx; color: #435c51; font-size: 28rpx; line-height: 1.65; }
.note-action { margin: 32rpx 0 0; font-size: 28rpx; }
.note-back { margin-top: 10rpx; padding: 18rpx; background: transparent; color: #315e4e; font-size: 27rpx; line-height: 1.5; }
.note-back::after { border: 0; }
</style>
