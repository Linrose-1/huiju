<script setup lang="ts">
import { ref, watch } from 'vue'
import { onShow, onUnload } from '@dcloudio/uni-app'
import { refreshMember, errorMessage } from '@/services/api'
import { mediaUrl } from '@/services/api/environment'
import { routes, loginPage } from '@/services/navigation'
import { useSessionStore } from '@/stores/session'
import RequestState from '@/components/base/RequestState.vue'
const session = useSessionStore()
const loading = ref(false), error = ref(''), busy = ref(false)
let generation = 0
async function load() {
  const current = ++generation
  error.value = ''
  if (!session.token) { loading.value = false; return }
  loading.value = true
  try { await refreshMember() }
  catch (e) { if (current === generation) error.value = errorMessage(e) }
  finally { if (current === generation) loading.value = false }
}
async function copy() {
  const code = session.member?.inviteCode
  if (busy.value || loading.value || error.value || !session.token || !code) return
  const current = generation
  busy.value = true
  try { await uni.setClipboardData({ data: code }) }
  catch { if (current === generation) error.value = '复制失败，请重试' }
  finally { busy.value = false }
}
function activities() { uni.switchTab({ url: routes.activity }) }
const stop = watch(() => [session.token, session.epoch], load)
onShow(load)
onUnload(() => { generation++; stop() })
</script>
<template>
  <view class="page-pad invitation-page">
    <view
      v-if="!session.token"
      class="empty"
    >
      登录后查看自己的邀请码<button
        class="text-button"
        @click="loginPage(routes.invitation)"
      >
        去登录
      </button>
    </view>
    <template v-else>
      <RequestState
        :loading="loading"
        :error="error"
        @retry="load"
      />
      <template v-if="!loading && !error && session.member">
        <view class="card invitation-card">
          <view class="row member-row">
            <view class="avatar">
              <image
                v-if="session.member.avatarUrl"
                :src="mediaUrl(session.member.avatarUrl)"
                mode="aspectFill"
              /><uni-icons
                v-else
                type="person"
                size="54rpx"
                color="#56816d"
              />
            </view>
            <view class="grow"><view class="member-name">{{ session.member.displayName || '会员'+session.member.memberNumber }}</view><view class="muted subtitle">邀请同行，一起参与活动。</view></view>
          </view>
          <view class="code-label">我的邀请码</view>
          <text
            class="invite-code"
            user-select
          >
            {{ session.member.inviteCode }}
          </text>
          <button
            class="primary copy-button"
            :disabled="busy"
            :loading="busy"
            @click="copy"
          >
            复制邀请码
          </button>
        </view>
        <view class="invite-hint">
          <uni-icons
            type="paperplane"
            size="36rpx"
            color="#26775d"
          /><text>分享活动时，会自动附带你的邀请码。</text>
        </view>
        <view class="card steps">
          <view class="section-title">如何邀请</view>
          <view class="step"><text class="number">1</text><text>选择你想分享的活动</text></view>
          <view class="step"><text class="number">2</text><text>通过活动页分享给同行</text></view>
        </view>
      </template>
    </template>
    <button
      class="secondary browse"
      @click="activities"
    >
      去看看活动 →
    </button>
  </view>
</template>
<style scoped>
.invitation-page{min-height:100vh;background:#f4f8f7;padding:22rpx 28rpx calc(40rpx + env(safe-area-inset-bottom))}
.invitation-card{padding:30rpx;border-radius:22rpx}
.member-row{padding-bottom:28rpx;border-bottom:1rpx solid #e8eeeb;gap:22rpx}
.avatar{width:100rpx;height:100rpx}
.member-name{font-size:34rpx;font-weight:600;line-height:1.5;overflow-wrap:anywhere}
.subtitle{font-size:26rpx;line-height:1.6;margin-top:8rpx}
.code-label{text-align:center;font-size:28rpx;color:#748078;margin-top:30rpx}
.invite-code{display:block;text-align:center;overflow-wrap:anywhere;font-size:50rpx;font-weight:700;color:#175e49;line-height:1.4;letter-spacing:2rpx;margin:18rpx 0 28rpx;font-family:monospace}
.copy-button{font-size:30rpx;min-height:84rpx}
.invite-hint{display:flex;align-items:center;gap:16rpx;border-radius:18rpx;background:#e6f4ec;color:#225d49;padding:22rpx;margin:22rpx 0;font-size:27rpx;line-height:1.6}
.steps{padding:28rpx;border-radius:22rpx}
.section-title{font-size:32rpx;margin-bottom:24rpx}
.step{display:flex;align-items:center;gap:20rpx;margin-top:22rpx;font-size:28rpx;line-height:1.6}
.number{display:flex;align-items:center;justify-content:center;width:50rpx;height:50rpx;border-radius:50%;background:#e4f3eb;color:#21684f;font-weight:600;flex-shrink:0}
.browse{margin-top:36rpx;width:100%;min-height:84rpx;font-size:30rpx;background:#dcefe4}
</style>
