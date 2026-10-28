<script setup lang="ts">
import { ref } from 'vue'
import { onLoad, onShow, onHide, onUnload, onPullDownRefresh } from '@dcloudio/uni-app'
import { api, ApiError, errorMessage } from '@/services/api'
import type { AdvertisingIntroduction } from '@/services/api/types'
import { mediaUrl } from '@/services/api/environment'
import { routes } from '@/services/navigation'
import { useSessionStore } from '@/stores/session'
import RequestState from '@/components/base/RequestState.vue'
const id = ref(''), content = ref<AdvertisingIntroduction | null>(null), loading = ref(false), error = ref(''), unavailable = ref(false), acting = ref(false)
let generation = 0, visible = false
async function load() {
  const current = ++generation
  loading.value = true; content.value = null; error.value = ''; unavailable.value = false
  try {
    if (!id.value) { unavailable.value = true; return }
    const value = await api.advertisingIntroduction(id.value)
    if (current === generation && visible) content.value = value
  } catch (e) {
    if (current !== generation || !visible) return
    if (e instanceof ApiError && e.status === 404) unavailable.value = true
    else error.value = errorMessage(e)
  } finally { if (current === generation) { loading.value = false; uni.stopPullDownRefresh() } }
}
async function copy(wechatOnly = false) {
  if (acting.value || !content.value || !visible) return
  const value = content.value, current = generation
  const data = wechatOnly ? value.wechatId : [value.name, value.companyName, '联系人：' + value.contactName, value.phone ? '电话：' + value.phone : '', value.wechatId ? '微信：' + value.wechatId : ''].filter(Boolean).join('\n')
  if (!data) return
  acting.value = true
  try { await uni.setClipboardData({ data }) }
  catch { if (current === generation && visible) uni.showToast({ title: '复制失败，请重试', icon: 'none' }) }
  finally { if (current === generation) acting.value = false }
}
async function call() {
  if (acting.value || !content.value?.phone || !visible) return
  const phone = content.value.phone, current = generation
  acting.value = true
  try {
    const result = await uni.showModal({ title: '拨打联系电话', content: phone, confirmText: '拨打' })
    if (result.confirm && current === generation && visible) await uni.makePhoneCall({ phoneNumber: phone })
  } catch { if (current === generation && visible) uni.showToast({ title: '未能拨打，请复制号码后重试', icon: 'none' }) }
  finally { if (current === generation) acting.value = false }
}
function back() { uni.navigateBack({ fail: () => uni.switchTab({ url: routes.activity }) }) }
function hide() { visible = false; generation++; acting.value = false; content.value = null }
onLoad(options => { id.value = typeof options?.id === 'string' ? options.id : ''; useSessionStore().captureInvite(options?.inviteCode) })
onShow(() => { visible = true; void load() }); onHide(hide); onUnload(hide); onPullDownRefresh(load)
</script>
<template>
  <view class="introduction-page">
    <RequestState
      :loading="loading"
      :error="error"
      @retry="load"
    />
    <view
      v-if="unavailable && !loading"
      class="unavailable"
    >
      <view class="unavailable-title">该介绍暂不可查看</view>
      <text>内容可能已下架，请返回继续浏览。</text>
      <button
        class="text-button"
        @click="back"
      >
        返回浏览
      </button>
    </view>
    <template v-if="content && !loading">
      <image
        v-if="content.coverImageUrl"
        class="cover"
        :src="mediaUrl(content.coverImageUrl)"
        mode="aspectFill"
      />
      <view class="intro-body">
        <view class="project-name serif">{{ content.name }}</view>
        <text
          class="company"
          user-select
        >
          {{ content.companyName }}
        </text>
        <text
          v-if="content.summary"
          class="summary"
          user-select
        >
          {{ content.summary }}
        </text>
        <view class="section-title">项目介绍</view>
        <view
          v-for="(block, index) in content.blocks"
          :key="index"
          class="intro-block"
        >
          <text
            v-if="block.type === 'text'"
            class="body-copy"
            user-select
          >
            {{ block.text }}
          </text>
          <image
            v-else-if="block.imageUrl"
            class="body-image"
            :src="mediaUrl(block.imageUrl)"
            mode="widthFix"
          />
        </view>
      </view>
      <view class="contacts">
        <view class="section-title">联系项目方</view>
        <view class="contact-row">
          <text class="contact-label">联系人</text><text
            class="contact-value"
            user-select
          >
            {{ content.contactName }}
          </text>
        </view>
        <view
          v-if="content.phone"
          class="contact-row"
        >
          <text class="contact-label">联系电话</text><text
            class="contact-value"
            user-select
          >
            {{ content.phone }}
          </text>
        </view>
        <view
          v-if="content.wechatId"
          class="contact-row"
        >
          <text class="contact-label">微信号</text><text
            class="contact-value"
            user-select
          >
            {{ content.wechatId }}
          </text><button
            class="copy-button"
            :disabled="acting"
            @click="copy(true)"
          >
            复制
          </button>
        </view>
      </view>
      <view class="contact-footer">
        <button
          class="secondary"
          :disabled="acting"
          @click="copy()"
        >
          复制联系方式
        </button>
        <button
          v-if="content.phone"
          class="primary"
          :disabled="acting"
          @click="call"
        >
          拨打电话
        </button>
      </view>
    </template>
  </view>
</template>
<style scoped>
.introduction-page{min-height:100vh;background:#f3f8f5;padding-bottom:calc(160rpx + env(safe-area-inset-bottom))}.cover{display:block;width:100%;height:375rpx}.intro-body{padding:38rpx 36rpx;background:#fff}.project-name{font-size:46rpx;font-weight:600;line-height:1.5;overflow-wrap:anywhere}.company{display:block;font-size:26rpx;color:#718276;line-height:1.7;margin-top:12rpx;overflow-wrap:anywhere}.summary{display:block;color:#536d5c;font-size:29rpx;line-height:1.85;white-space:pre-wrap;margin-top:24rpx;overflow-wrap:anywhere}.section-title{font-size:33rpx;font-weight:600;margin:24rpx 0 20rpx;color:#244c38}.intro-block{margin:20rpx 0}.body-copy{display:block;white-space:pre-wrap;overflow-wrap:anywhere;font-size:29rpx;line-height:1.85;color:#415c4b}.body-image{display:block;width:100%;border-radius:14rpx}.contacts{margin:24rpx;background:#fff;padding:8rpx 26rpx 26rpx;border:1rpx solid #e0e9e2;border-radius:20rpx}.contact-row{display:flex;align-items:flex-start;gap:18rpx;margin-top:18rpx;font-size:28rpx;line-height:1.6}.contact-label{width:140rpx;flex-shrink:0;color:#75857a}.contact-value{flex:1;min-width:0;text-align:right;overflow-wrap:anywhere}.copy-button{flex-shrink:0;margin:0;padding:0 12rpx;line-height:1.8;min-height:44rpx;color:#176348;background:transparent;font-size:26rpx}.contact-footer{position:fixed;bottom:0;left:0;right:0;display:flex;gap:20rpx;background:#fff;border-top:1rpx solid #e0e9e2;padding:20rpx 28rpx calc(20rpx + env(safe-area-inset-bottom));z-index:4}.contact-footer .primary,.contact-footer .secondary{flex:1;margin:0;min-height:84rpx;font-size:30rpx;line-height:1.5;display:flex;align-items:center;justify-content:center}.unavailable{text-align:center;padding:100rpx 40rpx;color:#7b8c80;font-size:28rpx;line-height:1.8}.unavailable-title{font-size:34rpx;color:#2e5540;margin-bottom:20rpx}.unavailable .text-button{margin-top:24rpx}
</style>
