<script setup lang="ts">
import { computed, getCurrentInstance, nextTick, onBeforeUnmount, ref } from 'vue'
import { cropGeometry } from '@/services/activity-images'
const instance = getCurrentInstance()
const visible = ref(false), src = ref(''), width = ref(1), height = ref(1), frameWidth = ref(300)
const zoom = ref(1), x = ref(0), y = ref(0), saving = ref(false), error = ref('')
let resolveCrop: ((path: string | null) => void) | null = null, sequence = 0
const geometry = computed(() => cropGeometry(width.value, height.value, frameWidth.value, zoom.value, x.value, y.value))
const imageStyle = computed(() => ({ width: geometry.value.width + 'px', height: geometry.value.height + 'px', left: geometry.value.x + 'px', top: geometry.value.y + 'px' }))
function finish(path: string | null) { sequence++; visible.value = false; saving.value = false; resolveCrop?.(path); resolveCrop = null }
async function open(path: string): Promise<string | null> {
  finish(null)
  const request = sequence
  const info = await new Promise<{ width: number; height: number; path: string }>((resolve, reject) => uni.getImageInfo({ src: path, success: resolve, fail: () => reject(new Error('无法读取图片尺寸，请重新选择')) }))
  if (request !== sequence) return null
  width.value = info.width; height.value = info.height; src.value = info.path
  frameWidth.value = Math.min(uni.getSystemInfoSync().windowWidth - 32, 520)
  zoom.value = 1; const initial = cropGeometry(width.value, height.value, frameWidth.value)
  x.value = initial.x; y.value = initial.y; error.value = ''; visible.value = true
  return new Promise(resolve => { resolveCrop = resolve })
}
type Touch = { clientX: number; clientY: number }
let gesture: { x: number; y: number; left: number; top: number; zoom: number; distance: number } | null = null
function distance(touches: ArrayLike<Touch>) { return touches.length > 1 ? Math.hypot(touches[1].clientX - touches[0].clientX, touches[1].clientY - touches[0].clientY) : 0 }
function start(event: { touches: ArrayLike<Touch> }) {
  if (saving.value || !event.touches.length) return
  gesture = { x: event.touches[0].clientX, y: event.touches[0].clientY, left: geometry.value.x, top: geometry.value.y, zoom: zoom.value, distance: distance(event.touches) }
}
function setZoom(value: number) {
  const old = geometry.value, nextZoom = Math.max(1, Math.min(4, value)), ratio = nextZoom / zoom.value
  x.value = frameWidth.value / 2 - (frameWidth.value / 2 - old.x) * ratio
  y.value = frameWidth.value * .4 - (frameWidth.value * .4 - old.y) * ratio
  zoom.value = nextZoom
  x.value = geometry.value.x; y.value = geometry.value.y
}
function move(event: { touches: ArrayLike<Touch> }) {
  if (!gesture || saving.value || !event.touches.length) return
  if (gesture.distance && event.touches.length > 1) setZoom(gesture.zoom * distance(event.touches) / gesture.distance)
  else { const next = cropGeometry(width.value, height.value, frameWidth.value, zoom.value, gesture.left + event.touches[0].clientX - gesture.x, gesture.top + event.touches[0].clientY - gesture.y); x.value = next.x; y.value = next.y }
}
async function confirm() {
  if (saving.value) return
  saving.value = true; error.value = ''; const request = sequence
  try {
    await nextTick()
    const g = geometry.value
    const canvas = uni.createCanvasContext('activity-cover-canvas', instance?.proxy)
    canvas.drawImage(src.value, g.sourceX, g.sourceY, g.sourceWidth, g.sourceHeight, 0, 0, 1250, 1000)
    await new Promise<void>(resolve => canvas.draw(false, () => resolve()))
    const file = await new Promise<string>((resolve, reject) => uni.canvasToTempFilePath({ canvasId: 'activity-cover-canvas', width: 1250, height: 1000, destWidth: 1250, destHeight: 1000, fileType: 'jpg', quality: .9, success: result => resolve(result.tempFilePath), fail: () => reject(new Error('裁剪未完成，请重试')) }, instance?.proxy))
    if (request === sequence) finish(file)
  } catch (e) { if (request === sequence) error.value = e instanceof Error ? e.message : '裁剪未完成，请重试' }
  finally { if (request === sequence) saving.value = false }
}
onBeforeUnmount(() => finish(null))
defineExpose({ open, cancel: () => finish(null) })
</script>
<template>
  <view
    v-if="visible"
    class="crop-overlay"
    @touchmove.stop.prevent
  >
    <view class="crop-heading">
      裁剪封面
    </view><text class="crop-help">
      固定 5:4 · 拖动图片、双指或滑块缩放
    </text>
    <view
      class="crop-frame"
      :style="{ width: frameWidth + 'px', height: frameWidth * .8 + 'px' }"
      @touchstart="start"
      @touchmove.stop.prevent="move"
      @touchend="gesture = null"
    >
      <image
        :src="src"
        :style="imageStyle"
        class="crop-source"
        mode="scaleToFill"
      />
      <view class="crop-grid" />
    </view>
    <slider
      class="crop-slider"
      :value="zoom * 100"
      :min="100"
      :max="400"
      :disabled="saving"
      active-color="#2d805f"
      @changing="setZoom($event.detail.value / 100)"
      @change="setZoom($event.detail.value / 100)"
    />
    <text
      v-if="error"
      class="crop-error"
    >
      {{ error }}
    </text>
    <view class="crop-actions">
      <button
        class="secondary crop-action"
        :disabled="saving"
        @click="finish(null)"
      >
        取消
      </button><button
        class="primary crop-action"
        :loading="saving"
        :disabled="saving"
        @click="confirm"
      >
        使用此封面
      </button>
    </view>
    <canvas
      canvas-id="activity-cover-canvas"
      class="crop-canvas"
      :width="1250"
      :height="1000"
    />
  </view>
</template>
<style scoped>
.crop-overlay{position:fixed;inset:0;z-index:1000;background:#f5f8f7;display:flex;flex-direction:column;align-items:center;padding:calc(30rpx + env(safe-area-inset-top)) 24rpx calc(30rpx + env(safe-area-inset-bottom));overflow:auto}.crop-heading{font-size:34rpx;font-weight:600;margin:20rpx 0}.crop-help{font-size:25rpx;color:#647b6d;margin-bottom:40rpx}.crop-frame{position:relative;overflow:hidden;background:#172e22;flex-shrink:0}.crop-source{position:absolute;max-width:none}.crop-grid{position:absolute;inset:0;border:2rpx solid white;pointer-events:none;background:linear-gradient(90deg,transparent 33%,#ffffff80 33.3%,transparent 33.6%,transparent 66%,#ffffff80 66.3%,transparent 66.6%),linear-gradient(transparent 33%,#ffffff80 33.3%,transparent 33.6%,transparent 66%,#ffffff80 66.3%,transparent 66.6%)}.crop-slider{width:90%;margin-top:35rpx}.crop-actions{display:flex;gap:20rpx;width:100%;margin-top:auto;padding-top:30rpx}.crop-action{flex:1}.crop-error{color:#b14e32;font-size:26rpx}.crop-canvas{position:absolute;left:-10000px;top:0;width:1250px;height:1000px}
</style>
