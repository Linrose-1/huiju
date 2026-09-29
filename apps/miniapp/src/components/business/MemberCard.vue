<script setup lang="ts">
import { computed } from 'vue'
import type { MemberCard } from '@/services/api/types'
import { mediaUrl } from '@/services/api/environment'
import { cardFields } from '@/services/member-card'
const props = defineProps<{ card: MemberCard }>()
const visibleFields = (keys: readonly string[]) => keys.flatMap(key => {
  const field = cardFields.find(item => item.key === key)
  return field && Object.prototype.hasOwnProperty.call(props.card, key) ? [field] : []
})
const personalFields = computed(() => visibleFields(['realName', 'hometown', 'boundPhone', 'email']))
const storyFields = computed(() => visibleFields(['resources', 'needs', 'bio']))
</script>
<template>
  <view class="member-card">
    <view class="identity-hero">
      <image
        class="hero-scenery"
        src="/static/huiju/campus.jpg"
        mode="aspectFill"
      />
      <view class="hero-shade" />
      <view class="identity-row">
        <view class="portrait">
          <image
            v-if="card.avatarUrl"
            class="portrait-image"
            :src="mediaUrl(card.avatarUrl)"
            mode="aspectFill"
          />
          <uni-icons
            v-else
            type="person-filled"
            size="92rpx"
            color="#c5d8cb"
          />
        </view>
        <view class="identity-text">
          <view class="brand">
            会聚
          </view>
          <text class="display-name">
            {{ card.displayName }}
          </text>
        </view>
        <view class="hero-motto">
          <text>让专业的人</text><text>在一起</text>
        </view>
      </view>
      <view class="hero-caption">
        <view class="caption-line" /><text>链接同行，共建更好的商业未来</text>
      </view>
    </view>
    <view class="card-content">
      <view
        v-if="personalFields.length"
        class="section personal-section"
      >
        <view class="section-heading">
          <view class="heading-mark" /><text>个人信息</text><view class="heading-line" />
        </view>
        <view
          v-for="field in personalFields"
          :key="field.key"
          class="info-row"
        >
          <uni-icons
            :type="field.icon"
            size="36rpx"
            color="#748b83"
          />
          <text class="info-label">
            {{ field.key === 'boundPhone' ? '手机号' : field.label }}
          </text>
          <text
            class="info-value"
            user-select
          >
            {{ card[field.key] || '暂未填写' }}
          </text>
        </view>
      </view>
      <view
        v-for="field in storyFields"
        :key="field.key"
        class="section story-section"
        :class="{ 'needs-section': field.key === 'needs' }"
      >
        <view class="section-heading">
          <view class="heading-mark" /><text>{{ field.label }}</text><view class="heading-line" />
        </view>
        <view class="story-content">
          <view
            v-if="field.key !== 'bio'"
            class="story-icon"
          >
            <view
              v-if="field.key === 'resources'"
              class="resource-leaf"
            >
              <view class="leaf-left" /><view class="leaf-right" />
            </view>
            <uni-icons
              v-else
              type="person"
              size="48rpx"
              color="#b2985f"
            />
          </view>
          <text
            class="story-value"
            user-select
          >
            {{ card[field.key] || '暂未填写' }}
          </text>
        </view>
      </view>
      <view
        v-if="!personalFields.length && !storyFields.length"
        class="section no-fields"
      >
        暂未公开更多资料
      </view>
      <view class="privacy-note">
        <uni-icons
          type="locked"
          size="27rpx"
          color="#94a39b"
        /><text>仅展示对方选择公开的资料</text>
      </view>
    </view>
  </view>
</template>
<style scoped>
.member-card{background:#eff7f3;color:#202e29}
.identity-hero{position:relative;overflow:hidden;background:#0a513e;padding:48rpx 34rpx 48rpx;border-bottom:7rpx solid #ceb882;border-radius:0 0 50% 8% / 0 0 30rpx 12rpx}
.hero-scenery{position:absolute;right:0;top:0;width:60%;height:100%;opacity:.36}
.hero-shade{position:absolute;inset:0;background:linear-gradient(90deg,#0b513e 15%,#0b513ee8 46%,#0b513e45)}
.identity-row{position:relative;display:flex;align-items:center;gap:26rpx;min-height:186rpx}
.portrait{height:180rpx;width:180rpx;flex-shrink:0;border:3rpx solid #e9eee4cc;border-radius:50%;overflow:hidden;background:#286f58;display:flex;align-items:center;justify-content:center}
.portrait-image{width:100%;height:100%}
.identity-text{min-width:0;flex:1;padding-right:54rpx}
.brand{display:inline-block;font-size:29rpx;letter-spacing:5rpx;color:#e4d3a4;border-top:2rpx solid #e4d3a4;border-radius:50% 50% 0 0;padding-top:10rpx;margin-bottom:16rpx;font-family:"Songti SC",SimSun,serif}
.display-name{display:block;color:#fffdf4;font-family:"Songti SC",SimSun,serif;font-size:46rpx;font-weight:600;line-height:1.4;overflow-wrap:anywhere}
.hero-motto{position:absolute;right:0;top:6rpx;writing-mode:vertical-rl;line-height:1.7;font-size:20rpx;letter-spacing:5rpx;color:#c2d5c4}
.hero-caption{position:relative;display:flex;align-items:center;gap:16rpx;margin-top:26rpx;color:#c7d6c8;font-size:22rpx;letter-spacing:2rpx;line-height:1.7}
.caption-line{flex:none;width:30rpx;height:2rpx;background:#d6c18c}
.card-content{padding:26rpx 26rpx calc(30rpx + env(safe-area-inset-bottom))}
.section{background:#fff;border-radius:20rpx;padding:28rpx 26rpx;margin-bottom:20rpx}
.section-heading{display:flex;align-items:center;gap:18rpx;margin-bottom:16rpx;font-family:"Songti SC",SimSun,serif;font-size:33rpx;font-weight:600;line-height:1.5}
.heading-mark{width:5rpx;height:26rpx;border-radius:4rpx;background:#08644b;flex:none}
.heading-line{height:1rpx;flex:1;background:#e0e8e3;margin-left:8rpx}
.info-row{display:flex;align-items:flex-start;gap:16rpx;padding:19rpx 0;border-bottom:1rpx solid #e4ebe7;font-size:27rpx;line-height:1.65}
.info-row:last-child{border-bottom:0;padding-bottom:4rpx}
.info-label{width:170rpx;flex:none}
.info-value{flex:1;min-width:0;overflow-wrap:anywhere;white-space:pre-wrap;color:#23392f}
.story-content{display:flex;align-items:flex-start;gap:26rpx;padding:8rpx 8rpx 4rpx}
.story-icon{width:78rpx;height:78rpx;flex:none;display:flex;align-items:center;justify-content:center;border-radius:50%;background:#e9f5ef}
.story-value{min-width:0;flex:1;white-space:pre-wrap;overflow-wrap:anywhere;font-size:29rpx;line-height:1.75}
.needs-section .heading-mark{background:#b59a60}.needs-section .story-icon{background:#f5f0e5}
.resource-leaf{position:relative;width:42rpx;height:44rpx}.resource-leaf:after{content:'';position:absolute;width:2rpx;height:34rpx;background:#12654d;left:20rpx;top:12rpx}
.leaf-left,.leaf-right{position:absolute;top:2rpx;width:22rpx;height:27rpx;border:2rpx solid #12654d}.leaf-left{left:0;border-radius:0 100% 0 100%}.leaf-right{right:0;border-radius:100% 0 100% 0}
.privacy-note{display:flex;justify-content:center;align-items:center;gap:9rpx;color:#8b9b92;font-size:23rpx;line-height:1.6;padding:6rpx 0}
.no-fields{text-align:center;font-size:27rpx;line-height:1.8;color:#81958a;padding:40rpx 26rpx}
</style>
