<script setup lang="ts">
import { ref } from 'vue'
import { onShow, onUnload } from '@dcloudio/uni-app'
import { api, ApiError, errorMessage } from '@/services/api'
import { stageActivityDraft } from '@/services/ai-draft'
import { loginPage, navigate, requireProfile, routes } from '@/services/navigation'
import { useSessionStore } from '@/stores/session'

const idea = ref('')
const busy = ref(false)
const checking = ref(true)
const error = ref('')
const session = useSessionStore()
let disposed = false
let generation = 0

async function checkProfile() {
  const request = ++generation
  checking.value = true
  error.value = ''
  try {
    const ready = await requireProfile(routes.activityDraft)
    if (request !== generation || disposed) return
    if (!ready) error.value = '请登录并完善资料后继续'
  } catch (e) {
    if (request === generation && !disposed) error.value = errorMessage(e)
  } finally {
    if (request === generation && !disposed) checking.value = false
  }
}

async function generate() {
  if (busy.value || checking.value || disposed) return
  const text = idea.value.trim()
  if (!text) { error.value = '请先写下活动想法'; return }
  if (text.length > 5000) { error.value = '内容过长，请精简后再试'; return }
  const request = ++generation
  const token = session.token, epoch = session.epoch, owner = session.member?.id || ''
  if (!token || !owner) { loginPage(routes.activityDraft); return }
  busy.value = true
  error.value = ''
  try {
    const result = await api.generateActivityDraft(text)
    if (disposed || request !== generation || token !== session.token || epoch !== session.epoch || owner !== session.member?.id) return
    stageActivityDraft(owner, epoch, result.draft)
    navigate(routes.editor + '?aiDraft=1')
  } catch (e) {
    if (disposed || request !== generation) return
    error.value = errorMessage(e)
    if (e instanceof ApiError && (e.status === 401 || e.code === 'PROFILE_INCOMPLETE')) loginPage(routes.activityDraft)
  } finally {
    if (!disposed && request === generation) busy.value = false
  }
}

function manual() { if (!busy.value) navigate(routes.editor) }

onShow(checkProfile)
onUnload(() => { disposed = true; generation++ })
</script>

<template>
  <view class="draft-page">
    <view class="content">
      <view class="intro-title">把活动想法写下来</view>
      <view class="intro-text">时间、地点、人数、费用和报名问题，都可以一起说</view>
      <view class="input-card">
        <view class="field-title">活动想法</view>
        <view class="text-box">
          <textarea
            v-model="idea"
            class="idea-input"
            placeholder="例如：下周六下午在园区办一场 AI 分享会，预计 30 人参加，免费报名……"
            :maxlength="5000"
            :disabled="busy"
            :cursor-spacing="220"
          />
          <view class="count">{{ idea.length }} 字</view>
        </view>
      </view>
      <view class="tip"><text class="tip-icon">✦</text><text>AI 只整理你明确说出的信息，缺少的内容可在下一步补充</text></view>
      <view class="privacy">请勿输入无关的敏感个人信息</view>
      <view
        v-if="error"
        class="error"
        role="alert"
      >
        {{ error }}
      </view>
    </view>
    <view class="footer">
      <button
        class="generate"
        :disabled="busy || checking"
        :loading="busy"
        @click="generate"
      >
        {{ busy ? '生成中…' : '✦ 生成草稿' }}
      </button>
      <view class="quota">每天最多生成 5 次 · 生成后可继续修改</view>
      <button
        class="manual"
        :disabled="busy"
        @click="manual"
      >
        直接手动填写
      </button>
    </view>
  </view>
</template>

<style scoped>
.draft-page{min-height:100vh;background:#f4f9f7;display:flex;flex-direction:column;color:#172c29}
.content{flex:1;padding:42rpx 30rpx 320rpx}
.intro-title{font-size:38rpx;font-weight:700;color:#0d5138;line-height:1.35}
.intro-text{font-size:26rpx;color:#788491;line-height:1.55;margin:12rpx 0 34rpx}
.input-card{background:#fff;border-radius:22rpx;padding:28rpx 26rpx 36rpx;box-shadow:0 8rpx 28rpx #1b6a4610}
.field-title{font-size:30rpx;font-weight:650;margin-bottom:22rpx}
.text-box{border:2rpx solid #e2e8e6;border-radius:17rpx;padding:20rpx 20rpx 12rpx}
.idea-input{width:100%;height:300rpx;font-size:29rpx;line-height:1.65;color:#182d29}
.count{text-align:right;color:#8995a2;font-size:23rpx;line-height:34rpx}
.tip{display:flex;align-items:center;gap:20rpx;border:2rpx solid #deece5;background:#f8fcfa;border-radius:18rpx;margin-top:28rpx;padding:22rpx 24rpx;font-size:25rpx;line-height:1.5;color:#314b43}
.tip-icon{color:#16865d;font-size:44rpx;line-height:1}
.privacy{margin:25rpx 4rpx;color:#87939b;font-size:24rpx}
.error{margin-top:20rpx;color:#b24134;background:#fff3f0;border-radius:12rpx;padding:18rpx 20rpx;font-size:25rpx;line-height:1.5}
.footer{position:fixed;left:0;right:0;bottom:0;background:#fff;padding:20rpx 28rpx calc(22rpx + env(safe-area-inset-bottom));box-shadow:0 -8rpx 30rpx #244d3c0d;z-index:2;text-align:center}
.generate{height:84rpx;line-height:84rpx;border-radius:48rpx;background:linear-gradient(100deg,#0a6245,#2aae63);color:#fff;font-size:30rpx;font-weight:600}
.generate[disabled]{background:#a9c8ba;color:#eef5f1}
.quota{font-size:23rpx;color:#85909a;margin-top:13rpx}
.manual{background:transparent;color:#0c6848;text-decoration:underline;font-size:26rpx;line-height:48rpx;height:48rpx;margin-top:16rpx;padding:0}
.manual::after{border:0}
</style>
