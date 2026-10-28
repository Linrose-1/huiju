<script setup lang="ts">
import { onBeforeUnmount, watch, ref } from 'vue'
import { api } from '@/services/api'
import { mediaUrl } from '@/services/api/environment'
import { navigate, routes } from '@/services/navigation'
import { useAdvertising } from '@/services/advertising'
const props = defineProps<{ placement: 'activity' | 'circle' | 'assistant'; active: boolean; refresh?: number }>()
const list = useAdvertising(offset => api.advertising(props.placement, offset))
const { items, index, total, loading, error, hasMore, autoplay } = list
const failedImages = ref<Record<string, boolean>>({})
watch(() => [props.active, props.refresh], () => {
  if (props.active) { failedImages.value = {}; void list.show() } else list.hide()
}, { immediate: true })
onBeforeUnmount(list.hide)
function change(event: { detail: { current: number } }) { list.change(event.detail.current) }
function open(id: string) { if (props.active) navigate(routes.advertisingIntroduction + '?id=' + encodeURIComponent(id)) }
function retryImage(id: string) { failedImages.value = { ...failedImages.value, [id]: false } }
</script>
<template>
  <view
    class="home-ad"
    :class="{ tall: placement !== 'circle' }"
  >
    <swiper
      v-if="items.length"
      class="ad-swiper"
      :current="index"
      :autoplay="autoplay"
      :interval="5000"
      :duration="300"
      :circular="!hasMore && items.length > 1"
      @change="change"
    >
      <swiper-item
        v-for="(item, position) in items"
        :key="item.id"
      >
        <view
          class="ad-slide"
          @click="open(item.introductionId)"
        >
          <image
            v-if="list.imageVisible(position) && !failedImages[item.id]"
            class="ad-image"
            :src="mediaUrl(item.imageUrl)"
            mode="aspectFill"
            :aria-label="item.title"
            @error="failedImages[item.id] = true"
          />
          <view
            v-if="failedImages[item.id]"
            class="image-error"
          >
            <text>图片暂时无法显示</text>
            <button
              class="image-retry"
              @click.stop="retryImage(item.id)"
            >
              重新加载图片
            </button>
          </view>
        </view>
      </swiper-item>
    </swiper>
    <view
      v-else
      class="ad-fallback"
    >
      <slot />
    </view>
    <text
      v-if="items.length"
      class="ad-label"
    >
      广告
    </text>
    <text
      v-if="total > 1"
      class="ad-count"
    >
      {{ index + 1 }} / {{ total }}
    </text>
    <view
      v-if="error"
      class="ad-retry"
    >
      <text>{{ items.length ? '后续图片未能加载' : '广告暂未加载' }}</text>
      <button
        class="retry-button"
        :disabled="loading"
        @click="list.retry()"
      >
        重试
      </button>
    </view>
    <text
      v-else-if="loading && !items.length"
      class="ad-loading"
    >
      正在加载…
    </text>
  </view>
</template>
<style scoped>
.home-ad{position:relative;width:100%;height:250rpx;background:#eaf2ee;overflow:hidden}.home-ad.tall{height:375rpx}.ad-swiper,.ad-slide,.ad-fallback,.ad-image{width:100%;height:100%}.ad-label,.ad-count{position:absolute;right:20rpx;background:#183d3266;color:white;border-radius:8rpx;padding:4rpx 12rpx;font-size:22rpx;pointer-events:none}.ad-label{top:16rpx}.ad-count{bottom:14rpx;border-radius:24rpx}.ad-retry{position:absolute;left:16rpx;bottom:12rpx;background:#fffffff0;border-radius:8rpx;display:flex;align-items:center;gap:12rpx;padding-left:16rpx;color:#536d60;font-size:22rpx;max-width:580rpx}.retry-button{background:transparent;color:#176348;font-size:24rpx;margin:0;padding:8rpx 18rpx;line-height:1.8}.ad-loading{position:absolute;left:16rpx;bottom:12rpx;background:#ffffffe6;color:#617469;font-size:22rpx;padding:6rpx 14rpx;border-radius:8rpx}.image-error{height:100%;display:flex;align-items:center;justify-content:center;flex-direction:column;gap:12rpx;color:#63796b;font-size:26rpx}.image-retry{font-size:26rpx;background:white;color:#216e4e;padding:8rpx 20rpx}
</style>
