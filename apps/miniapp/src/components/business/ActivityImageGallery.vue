<script setup lang="ts">
import { ref, watch } from 'vue'
import { mediaUrl } from '@/services/api/environment'
const props = defineProps<{ urls: string[] }>()
const current = ref(0), failed = ref<Record<number, boolean>>({}), retries = ref<Record<number, number>>({})
watch(() => props.urls, () => { current.value = 0; failed.value = {}; retries.value = {} }, { deep: true })
function preview(index: number) { uni.previewImage({ current: mediaUrl(props.urls[index]), urls: props.urls.map(mediaUrl) }) }
function retry(index: number) { failed.value[index] = false; retries.value[index] = (retries.value[index] || 0) + 1 }
</script>
<template>
  <view
    v-if="urls.length"
    class="activity-gallery"
  >
    <swiper
      class="gallery-swiper"
      :current="current"
      :autoplay="false"
      @change="current = $event.detail.current"
    >
      <swiper-item
        v-for="(url, index) in urls"
        :key="url + index"
      >
        <view
          v-if="failed[index]"
          class="gallery-failed"
        >
          <text>图片暂未加载</text><button
            class="text-button"
            @click="retry(index)"
          >
            重新加载
          </button>
        </view>
        <image
          v-else
          :key="url + (retries[index] || 0)"
          class="gallery-image"
          :src="mediaUrl(url)"
          :mode="index === 0 ? 'aspectFill' : 'aspectFit'"
          @click="preview(index)"
          @error="failed[index] = true"
        />
      </swiper-item>
    </swiper>
    <text
      v-if="urls.length > 1"
      class="gallery-count"
    >
      {{ current + 1 }} / {{ urls.length }}
    </text>
  </view>
</template>
<style scoped>
.activity-gallery{position:relative;width:100%;aspect-ratio:5/4;border-radius:12rpx;overflow:hidden;background:#e8eeeb;margin-bottom:12rpx}.gallery-swiper{width:100%;height:100%}.gallery-image{display:block;width:100%;height:100%}.gallery-count{position:absolute;right:20rpx;bottom:18rpx;border-radius:24rpx;background:#173e2fb3;color:#fff;font-size:23rpx;padding:4rpx 17rpx;pointer-events:none}.gallery-failed{height:100%;display:flex;flex-direction:column;align-items:center;justify-content:center;color:#718278;font-size:26rpx}
</style>
