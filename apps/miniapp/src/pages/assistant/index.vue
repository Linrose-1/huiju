<template>
  <view class="page-shell">
    <text class="page-shell__title">助手</text>
    <text class="page-shell__description">AI 活动助手页面框架已就绪。</text>
  </view>
</template>

<style lang="scss">
.page-shell {
  display: flex;
  min-height: 100vh;
  flex-direction: column;
  gap: 24rpx;
  padding: 48rpx;

  &__title { font-size: 44rpx; font-weight: 600; }
  &__description { color: #68716c; font-size: 28rpx; }
}
</style>
