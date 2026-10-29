<script setup lang="ts">
import { ref, watch } from 'vue'
import { mediaUrl } from '@/services/api/environment'
const props = defineProps<{ name: string; avatarUrl?: string | null; subtitle?: string; clickable: boolean }>()
defineEmits<{ (event: 'open'): void }>()
const failed = ref(false)
watch(() => props.avatarUrl, () => { failed.value = false })
</script>
<template>
  <button
    class="fellow-person"
    :class="{unavailable:!clickable}"
    :disabled="!clickable"
    @click="$emit('open')"
  >
    <view class="fellow-avatar">
      <image
        v-if="avatarUrl && !failed"
        class="fellow-avatar-image"
        :src="mediaUrl(avatarUrl)"
        mode="aspectFill"
        @error="failed=true"
      />
      <uni-icons
        v-else
        type="person"
        size="40rpx"
        color="#477460"
      />
    </view>
    <view class="fellow-copy">
      <view class="fellow-name">
        {{ name }}
      </view><view
        v-if="subtitle"
        class="fellow-subtitle"
      >
        {{ subtitle }}
      </view>
    </view>
    <text
      v-if="clickable"
      class="fellow-arrow"
      aria-hidden="true"
    >
      ›
    </text>
  </button>
</template>
<style scoped>
.fellow-person{display:flex;align-items:center;gap:22rpx;width:100%;text-align:left;padding:24rpx 0;margin:0;background:transparent;line-height:1.5;border-radius:0;color:#173b2b}.fellow-person::after{border:0}.fellow-person.unavailable{background:transparent;color:#173b2b}.fellow-avatar{width:84rpx;height:84rpx;border-radius:50%;background:#e4efe8;flex:none;display:flex;align-items:center;justify-content:center;overflow:hidden}.fellow-avatar-image{width:100%;height:100%}.fellow-copy{flex:1;min-width:0}.fellow-name{font-size:29rpx;font-weight:600;overflow-wrap:anywhere}.fellow-subtitle{font-size:24rpx;color:#7c8d83;margin-top:6rpx;overflow-wrap:anywhere}.fellow-arrow{font-size:36rpx;color:#789386}
</style>
