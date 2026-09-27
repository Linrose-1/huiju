<script setup lang="ts">
import { computed } from 'vue'
import type { MemberCard } from '@/services/api/types'
import { mediaUrl } from '@/services/api/environment'
import { cardFields } from '@/services/member-card'
const props = defineProps<{ card: MemberCard }>()
const fields = computed(() => cardFields.filter(field => Object.prototype.hasOwnProperty.call(props.card, field.key)))
</script>
<template>
  <view class="member-card">
    <view class="identity-block">
      <view class="portrait">
        <image
          v-if="card.avatarUrl"
          class="portrait-image"
          :src="mediaUrl(card.avatarUrl)"
          mode="aspectFill"
        /><uni-icons
          v-else
          type="person-filled"
          size="82rpx"
          color="#5d927b"
        />
      </view>
      <view class="identity-text">
        <view class="display-name">
          {{ card.displayName }}
        </view><view class="subtitle">
          会员名片
        </view>
      </view>
    </view>
    <view
      v-for="field in fields"
      :key="field.key"
      class="field-block"
    >
      <view class="field-icon">
        <uni-icons
          :type="field.icon"
          size="42rpx"
          color="#09694d"
        />
      </view>
      <view class="field-text">
        <view class="field-label">
          {{ field.label }}
        </view><text
          class="field-value"
          user-select
        >
          {{ card[field.key] || '暂未填写' }}
        </text>
      </view>
    </view>
    <view
      v-if="!fields.length"
      class="no-fields"
    >
      暂未公开更多资料
    </view>
    <view class="privacy-note">
      <uni-icons
        type="locked"
        size="28rpx"
        color="#899c93"
      /> 此页仅展示对方选择公开的资料
    </view>
  </view>
</template>
<style scoped>
.identity-block,.field-block{background:#fff;border-radius:24rpx;margin-bottom:22rpx;display:flex;align-items:center;padding:32rpx;gap:28rpx}.portrait{height:150rpx;width:150rpx;flex-shrink:0;border-radius:50%;overflow:hidden;background:#e8f4ed;display:flex;align-items:center;justify-content:center}.portrait-image{width:100%;height:100%}.identity-text,.field-text{min-width:0;flex:1}.display-name{font-size:40rpx;font-weight:650;overflow-wrap:anywhere}.subtitle{color:#8c9494;font-size:28rpx;margin-top:14rpx}.field-block{align-items:flex-start;gap:24rpx}.field-icon{height:64rpx;width:64rpx;border-radius:50%;background:#e7f6ee;display:flex;align-items:center;justify-content:center;flex-shrink:0}.field-label{font-size:30rpx;font-weight:600;color:#105c46;margin:8rpx 0 14rpx}.field-value{font-size:29rpx;line-height:1.65;white-space:pre-wrap;overflow-wrap:anywhere;color:#20282a}.privacy-note,.no-fields{color:#87998f;text-align:center;font-size:24rpx;line-height:1.7;padding:12rpx}.no-fields{padding:35rpx;background:#fff;border-radius:20rpx}
</style>
