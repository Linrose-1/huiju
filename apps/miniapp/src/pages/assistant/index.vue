<script setup lang="ts">
import { routes, unavailable } from '@/services/navigation'
function browse() { uni.switchTab({ url: routes.activity }); }
</script>
<template>
  <view>
    <view class="hero">
      <image
        class="hero-image"
        src="/static/huiju/campus.jpg"
        mode="aspectFill"
      /><view class="hero-fade" /><view class="hero-copy serif">“学加”活动智能助手</view>
    </view><view class="sheet">
      <view class="task-card">
        <image
          class="task-image"
          src="/static/huiju/assistant-plan.jpg"
          mode="aspectFill"
        /><view class="task-fade" /><view class="task-content">
          <text class="ribbon">AI 助力，高效筹备</text><view class="task-title serif">帮我发活动</view><view class="task-desc">说说想法，生成可修改的活动草稿</view><view class="feature"><view class="feature-icon" />智能生成活动方案</view><view class="feature">
            <view class="feature-icon">
              <uni-icons
                type="compose"
                size="23"
              />
            </view>支持自定义修改
          </view><view class="feature">
            <view class="feature-icon">
              <uni-icons
                type="checkbox"
                size="23"
              />
            </view>快速完善活动信息
          </view><button
            class="primary task-button"
            @click="unavailable('活动筹备暂不可用')"
          >
            暂未开放 <uni-icons
              type="arrow-right"
              size="22"
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
        /><view class="task-fade" /><view class="task-content">
          <text class="ribbon green">AI 推荐，发现更多可能</text><view class="task-title serif">帮我找活动</view><view class="task-desc">根据你的兴趣和需求，发现适合的活动</view><view class="feature">
            <view class="feature-icon">
              <uni-icons
                type="search"
                size="23"
              />
            </view>智能匹配兴趣标签
          </view><view class="feature"><view class="feature-icon" />推荐优质园区活动</view><view class="feature">
            <view class="feature-icon">
              <uni-icons
                type="paperplane"
                size="23"
              />
            </view>查看活动详情并报名
          </view><button
            class="primary task-button"
            @click="browse"
          >
            浏览活动 <uni-icons
              type="arrow-right"
              size="22"
              color="white"
            />
          </button>
        </view>
      </view>
      <view class="interest card"><view class="section-title serif">你可能感兴趣</view><text class="muted small">智能推荐暂未开放，可到活动页浏览真实活动。</text></view>
    </view>
  </view>
</template>
<style scoped>.hero-copy{font-size:40rpx;letter-spacing:1rpx;padding-top:52rpx}.task-card{position:relative;border:1rpx solid #e5e8e2;border-radius:20rpx;overflow:hidden;min-height:410rpx;margin-bottom:18rpx}.task-image{position:absolute;inset:0;width:100%;height:100%}.task-fade{position:absolute;inset:0;background:linear-gradient(90deg,#fffefcf5,#ffffffdf 43%,#ffffff00 80%)}.task-content{position:relative;padding:22rpx 24rpx}.ribbon{display:inline-block;background:#d4915d;border-radius:40rpx;color:#fff;padding:8rpx 18rpx;font-size:23rpx}.ribbon.green{background:#367c5f}.task-title{font-size:43rpx;color:#114a36;margin:20rpx 0 10rpx}.task-desc{font-size:24rpx;color:#6b7482;margin-bottom:20rpx}.feature-icon{width:23px;height:23px;flex:0 0 23px;display:flex;align-items:center;justify-content:center}.feature{display:flex;align-items:center;gap:14rpx;color:#636f7d;margin:10rpx 0;font-size:24rpx}.task-button{width:228rpx;margin-top:24rpx;padding:15rpx!important;font-size:26rpx}.interest{border:1rpx solid #e5e8e2;margin-top:16rpx;padding:22rpx}.interest .section-title{margin-bottom:14rpx}</style>
