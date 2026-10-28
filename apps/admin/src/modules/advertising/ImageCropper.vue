<script setup lang="ts">
/* global HTMLCanvasElement, HTMLImageElement, Image, PointerEvent, document */
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { centeredCrop, cropRect, type CropState } from './crop'
const props = defineProps<{ source: string; ratio: number; saving?: boolean }>()
const emit = defineEmits<{ confirm: [value: { base64: string; mimeType: 'image/jpeg' }]; cancel: [] }>()
const canvas = ref<HTMLCanvasElement>(), image = ref<HTMLImageElement>(), error = ref(''), busy = ref(false)
const state = ref<CropState>(centeredCrop(1500, 750, props.ratio)), zoom = ref(1)
const height = computed(() => Math.round(720 / props.ratio))
let generation = 0, drag: { x: number; y: number; left: number; top: number } | null = null
function draw() {
  const ctx = canvas.value?.getContext('2d')
  if (!ctx || !image.value) return
  const rect = cropRect(state.value)
  ctx.drawImage(image.value, rect.x, rect.y, rect.width, rect.height, 0, 0, 720, height.value)
}
watch(() => [props.source, props.ratio], async () => {
  const current = ++generation; error.value = ''; image.value = undefined; zoom.value = 1
  const next = new Image(); next.src = props.source
  try { await next.decode(); if (current !== generation) return; image.value = next; state.value = centeredCrop(next.naturalWidth, next.naturalHeight, props.ratio); draw() }
  catch { if (current === generation) error.value = '原图加载失败，请重新选择图片。' }
}, { immediate: true, flush: 'post' })
watch(zoom, () => { const before = cropRect(state.value); const next = { ...state.value, zoom: zoom.value }; const rect = cropRect(next); state.value = { ...next, x: before.x + (before.width - rect.width) / 2, y: before.y + (before.height - rect.height) / 2 }; draw() })
function start(event: PointerEvent) { if (!image.value) return; canvas.value?.setPointerCapture(event.pointerId); const rect = cropRect(state.value); drag = { x: event.clientX, y: event.clientY, left: rect.x, top: rect.y } }
function move(event: PointerEvent) {
  if (!drag || !canvas.value) return
  const rect = cropRect(state.value), scale = rect.width / canvas.value.getBoundingClientRect().width
  state.value = { ...state.value, x: drag.left - (event.clientX - drag.x) * scale, y: drag.top - (event.clientY - drag.y) * scale }; draw()
}
function reset() { if (!image.value) return; zoom.value = 1; state.value = centeredCrop(image.value.naturalWidth, image.value.naturalHeight, props.ratio); draw() }
function confirm() {
  if (!image.value || busy.value || props.saving) return
  busy.value = true; error.value = ''
  try {
    const rect = cropRect(state.value), output = document.createElement('canvas')
    // Keep the fixed ratio without enlarging low-resolution source pixels.
    const unit = Math.max(1, Math.floor(Math.min(1500 / props.ratio, rect.width / props.ratio)))
    output.width = unit * props.ratio; output.height = unit
    const ctx = output.getContext('2d'); if (!ctx) throw new Error('当前浏览器无法裁剪图片。')
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, output.width, output.height)
    ctx.drawImage(image.value, rect.x, rect.y, rect.width, rect.height, 0, 0, output.width, output.height)
    emit('confirm', { base64: output.toDataURL('image/jpeg', .9).split(',')[1]!, mimeType: 'image/jpeg' })
  } catch (e) { error.value = e instanceof Error ? e.message : '裁剪失败，请重试。' }
  finally { busy.value = false }
}
onBeforeUnmount(() => { generation++ })
</script>
<template>
  <el-dialog
    :model-value="true"
    title="裁剪图片"
    width="820px"
    :close-on-click-modal="false"
    :close-on-press-escape="!saving"
    :show-close="!saving"
    @close="emit('cancel')"
  >
    <p>宽 : 高 = {{ ratio }} : 1 · 建议 {{ ratio === 3 ? '1500 × 500' : '1500 × 750' }} px</p>
    <el-alert
      v-if="error"
      :title="error"
      type="error"
      :closable="false"
    />
    <div class="crop-frame">
      <canvas
        ref="canvas"
        width="720"
        :height="height"
        aria-label="拖动调整图片位置"
        @pointerdown="start"
        @pointermove="move"
        @pointerup="drag = null"
        @pointercancel="drag = null"
      />
      <div class="grid">
        <i
          v-for="n in 9"
          :key="n"
        />
      </div>
    </div>
    <p class="muted">
      拖动图片调整位置，或使用下方滑块缩放。取消不会更改当前图片。
    </p>
    <p
      v-if="image && image.naturalWidth < 1500"
      class="muted"
    >
      原图宽度不足 1500 px，将保留原有清晰度，不放大像素。
    </p>
    <input
      v-model.number="zoom"
      type="range"
      style="width:100%"
      :min="1"
      :max="4"
      :step=".01"
      aria-label="缩放图片"
      :disabled="saving"
    >
    <template #footer>
      <button
        type="button"
        class="el-button"
        :disabled="saving"
        @click="reset"
      >
        重置
      </button><button
        type="button"
        class="el-button"
        :disabled="saving"
        @click="emit('cancel')"
      >
        取消
      </button><button
        type="button"
        class="el-button"
        data-primary="true"
        :disabled="!image || busy || saving"
        @click="confirm"
      >
        使用裁剪结果
      </button>
    </template>
  </el-dialog>
</template>
<style scoped>
.el-button[data-primary="true"]{background:var(--huiju-green);color:white}.crop-frame{position:relative;background:#243d32;overflow:hidden}.crop-frame canvas{display:block;width:100%;touch-action:none;cursor:move}.grid{pointer-events:none;position:absolute;inset:0;display:grid;grid-template-columns:repeat(3,1fr);grid-template-rows:repeat(3,1fr);border:2px solid white}.grid i{border:1px solid #ffffff66}
</style>
