<script setup lang="ts">
import { ref } from 'vue'
import { onHide, onPullDownRefresh, onShow, onUnload } from '@dcloudio/uni-app'
import PageReturn from '@/components/base/PageReturn.vue'
import { mediaUrl } from '@/services/api/environment'
import { platformBrand, refreshPlatformBrand } from '@/services/platform-brand'

const loading = ref(true), error = ref(false), failedCodes = ref<string[]>([])
let generation = 0
let previewing = false
async function load() {
  const request = ++generation
  loading.value = true; error.value = false; failedCodes.value = []
  try { await refreshPlatformBrand() }
  catch { if (request === generation) error.value = true }
  finally { if (request === generation) loading.value = false }
}
function markFailed(url: string) {
  if (!failedCodes.value.includes(url)) failedCodes.value.push(url)
}
function previewCode(url: string) {
  if (previewing || loading.value || error.value || failedCodes.value.includes(url) || !platformBrand.value.partners.some(partner => partner.codeUrl === url)) return
  const source = mediaUrl(url)
  previewing = true
  uni.previewImage({
    current: source, urls: [source],
    fail: () => uni.showToast({ title: '暂时无法放大，请稍后再试', icon: 'none' }),
    complete: () => { previewing = false },
  })
}
onShow(load)
onHide(() => { generation++ })
onUnload(() => { generation++ })
onPullDownRefresh(async () => { try { await load() } finally { uni.stopPullDownRefresh() } })
</script>

<template>
  <view class="partners-page">
    <PageReturn />
    <view v-if="loading" class="partner-status">正在加载合作小程序…</view>
    <view v-else-if="error" class="partner-status">
      <text>暂时无法加载合作小程序</text>
      <button class="retry-button" @click="load">重试</button>
    </view>
    <view v-else-if="!platformBrand.partners.length" class="partner-status">暂无可展示的合作小程序</view>
    <view v-else class="partner-list">
      <view v-for="(partner, index) in platformBrand.partners" :key="partner.codeUrl + '-' + index" class="partner-card">
        <image v-if="partner.logoUrl" class="partner-logo" :src="mediaUrl(partner.logoUrl)" mode="aspectFit" />
        <text class="partner-name">{{ partner.name }}</text>
        <text v-if="partner.description" class="partner-description">{{ partner.description }}</text>
        <view class="partner-code-box">
          <text v-if="failedCodes.includes(partner.codeUrl)">小程序码未能加载</text>
          <image
            v-else
            class="partner-code"
            :src="mediaUrl(partner.codeUrl)"
            mode="aspectFit"
            :aria-label="partner.name + '小程序码'"
            @click="previewCode(partner.codeUrl)"
            @error="markFailed(partner.codeUrl)"
          />
        </view>
        <button
          v-if="failedCodes.includes(partner.codeUrl)"
          class="preview-button"
          @click="load"
        >重新加载</button>
        <button
          v-else
          class="preview-button"
          @click="previewCode(partner.codeUrl)"
        >放大小程序码</button>
      </view>
    </view>
  </view>
</template>

<style scoped>
.partners-page { min-height: 100vh; padding: 36rpx 28rpx calc(36rpx + env(safe-area-inset-bottom)); background: #edf4ef; }
.partner-list { display: flex; flex-direction: column; gap: 24rpx; }
.partner-card { display: flex; flex-direction: column; align-items: center; padding: 50rpx 36rpx 44rpx; border: 1rpx solid #e2eae3; border-radius: 24rpx; background: #fff; }
.partner-logo { width: 96rpx; height: 96rpx; margin-bottom: 22rpx; }
.partner-name { max-width: 100%; color: #17382a; font-size: 39rpx; line-height: 1.4; font-weight: 650; text-align: center; overflow-wrap: anywhere; }
.partner-description { max-width: 100%; margin-top: 12rpx; color: #536b5e; font-size: 28rpx; line-height: 1.55; text-align: center; overflow-wrap: anywhere; white-space: pre-wrap; }
.partner-code-box { display: flex; justify-content: center; align-items: center; width: 420rpx; max-width: 100%; height: 420rpx; margin: 34rpx 0 26rpx; border-radius: 16rpx; background: #fff; color: #5a7163; font-size: 27rpx; }
.partner-code { display: block; width: 100%; height: 100%; }
.preview-button, .retry-button { min-height: 88rpx; margin: 0; padding: 0 40rpx; border: 1rpx solid #21684d; border-radius: 16rpx; background: #fff; color: #175b40; font-size: 29rpx; line-height: 88rpx; }
.preview-button::after, .retry-button::after { border: 0; }
.partner-status { display: flex; flex-direction: column; align-items: center; gap: 24rpx; padding: 90rpx 24rpx; color: #526d5e; font-size: 29rpx; text-align: center; }
</style>
