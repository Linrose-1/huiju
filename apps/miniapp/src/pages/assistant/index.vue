<script setup lang="ts">
import { usePageShare } from '@/services/wechat/page-share'
import { ref } from 'vue'
import { onShareAppMessage, onShareTimeline, onShow, onHide, onUnload } from '@dcloudio/uni-app'
import { navigate, routes } from '@/services/navigation'
import { api, errorMessage } from '@/services/api'
const assistantText = ref('“学加”活动智能助手'), contentError = ref('')
let contentGeneration = 0
async function loadContent() {
  const current = ++contentGeneration
  contentError.value = ''
  try { const result = await api.platformContent(); if (current === contentGeneration) assistantText.value = result.assistantText }
  catch (e) { if (current === contentGeneration) contentError.value = errorMessage(e) }
}
onShow(loadContent); onHide(() => { contentGeneration++ }); onUnload(() => { contentGeneration++ })
function browse() { navigate(routes.activitySearch) }
function draftActivity() { navigate(routes.activityDraft) }
const { shareError, shareBusy, retryShare, shareMessage, shareTimeline } = usePageShare(() => ({path: routes.assistant, title: '有聚点助手'}), true)
onShareAppMessage(shareMessage)
onShareTimeline(shareTimeline)
</script>
<template>
  <view>
    <view
      v-if="shareError"
      class="error"
      role="alert"
    >
      <text>{{ shareError }}</text>
      <button
        class="text-button"
        :disabled="shareBusy"
        @click="retryShare"
      >
        {{ shareBusy ? '正在识别…' : '重试分享' }}
      </button>
    </view>
    <view class="hero">
      <image
        class="hero-image"
        src="/static/huiju/campus.jpg"
        mode="aspectFill"
      />
      <view class="hero-fade" />
      <view class="hero-text">
        <view class="hero-copy serif">{{ assistantText }}</view>
        <view class="hero-sub">说出想法，帮你发起活动，也帮你找到想参加的活动</view>
      </view>
    </view>
    <view class="sheet">
      <view
        v-if="contentError"
        class="error"
      >
        {{ contentError }}<button
          class="text-button"
          @click="loadContent"
        >
          重试文案加载
        </button>
      </view>
      <view class="task-card">
        <image
          class="task-image"
          src="/static/huiju/assistant-plan.jpg"
          mode="aspectFill"
        />
        <view class="task-fade" />
        <view class="task-content">
          <view class="task-title serif">帮我发活动</view>
          <view class="task-desc">把想法告诉 AI，生成可编辑的活动草稿，修改确认后由你发布</view>
          <view class="task-example">例如：下周六下午在园区办一场 AI 分享会，30 人，免费报名</view>
          <button
            class="primary task-button"
            @click="draftActivity"
          >
            开始描述想法
            <uni-icons
              type="arrow-right"
              size="20"
              color="white"
            />
          </button>
        </view>
      </view>
      <view class="task-card">
        <image
          class="task-image"
          src="/static/huiju/assistant-find.jpg"
          mode="aspectFill"
        />
        <view class="task-fade" />
        <view class="task-content">
          <view class="task-title serif">帮我找活动</view>
          <view class="task-desc">说说你的时间和兴趣，AI 推荐合适的园区活动，看到合适的再报名</view>
          <view class="task-example">例如：想找本周末下午、新手友好的羽毛球活动</view>
          <button
            class="primary task-button"
            @click="browse"
          >
            开始描述需求
            <uni-icons
              type="arrow-right"
              size="20"
              color="white"
            />
          </button>
        </view>
      </view>
    </view>
  </view>
</template>
<style scoped>
.hero{height:252rpx}
.hero-text{position:relative;padding:40rpx 38rpx 0}
.hero-copy{font-size:40rpx;letter-spacing:1rpx;padding:0}
.hero-sub{font-size:24rpx;color:#5c7268;margin-top:20rpx;letter-spacing:0;line-height:1.5}
.task-card{position:relative;border:1rpx solid #e5e8e2;border-radius:20rpx;overflow:hidden;min-height:420rpx;margin-bottom:24rpx}
.task-image{position:absolute;inset:0;width:100%;height:100%}
.task-fade{position:absolute;inset:0;background:linear-gradient(90deg,#fffefcf7,#fffffff0 45%,#ffffff00 82%)}
.task-content{position:relative;padding:32rpx 34rpx}
.task-title{font-size:42rpx;color:#114a36}
.task-desc{font-size:26rpx;color:#46564d;line-height:1.6;margin-top:14rpx;max-width:590rpx}
.task-example{font-size:23rpx;color:#8a7c5e;line-height:1.6;margin-top:16rpx;max-width:590rpx;padding-left:16rpx;border-left:5rpx solid #ddcfa9}
.task-button{width:268rpx;height:84rpx;margin:28rpx 0 0;padding:0;display:flex;align-items:center;justify-content:center;gap:8rpx;font-size:27rpx}
</style>
