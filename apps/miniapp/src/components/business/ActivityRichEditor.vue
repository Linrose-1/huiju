<script setup lang="ts">
/* global UniApp */
import { computed, getCurrentInstance, onBeforeUnmount, ref, watch } from 'vue'
import { ACTIVITY_BODY_MAX_LENGTH, normalizeActivityRichText, type ActivityRichValue } from '@/services/activity-rich-text'

const props = defineProps<{ value: ActivityRichValue; disabled?: boolean }>()
const emit = defineEmits<{ (event: 'update:value', value: ActivityRichValue): void; (event: 'validity', valid: boolean): void }>()
const instance = getCurrentInstance()
const editorId = `activity-rich-editor-${instance?.uid ?? 0}`
const error = ref(''), length = ref(props.value.text.length), ready = ref(false)
const formats = ref<Record<string, unknown>>({})
const locked = computed(() => props.disabled || !ready.value)
let context: UniApp.EditorContext | undefined
let disposed = false, applying = false, pending = false, rendered = ''
function validate(text: string) {
  length.value = text.length
  error.value = text.length > ACTIVITY_BODY_MAX_LENGTH ? `正文最多${ACTIVITY_BODY_MAX_LENGTH}字，已保留内容，请删减后保存。` : ''
  emit('validity', !error.value)
}
function sync() {
  if (!context || disposed) return
  if (applying) { pending = true; return }
  try {
    const value = normalizeActivityRichText(props.value.delta, props.value.text)
    const signature = JSON.stringify(value.delta)
    validate(value.text)
    if (signature === rendered) return
    applying = true
    context.setContents({ delta: value.delta, success: () => { rendered = signature }, fail: () => { error.value = '正文加载失败，请重试。'; emit('validity', false) }, complete: () => {
      applying = false
      if (pending) { pending = false; sync() }
    } })
  } catch (e) { error.value = (e as Error).message; emit('validity', false) }
}
function onReady() {
  if (disposed) return
  uni.createSelectorQuery().in(instance?.proxy).select(`#${editorId}`).context(result => {
    if (disposed) return
    context = (Array.isArray(result) ? result[0]?.context : result.context) as UniApp.EditorContext | undefined
    ready.value = !!context
    if (context) sync()
    else { error.value = '编辑器初始化失败，请重新进入。'; emit('validity', false) }
  }).exec()
}
function retry() { rendered = ''; onReady() }
function onInput(event: { detail: { delta?: unknown; text?: string } }) {
  if (disposed || props.disabled || applying) return
  try {
    const value = normalizeActivityRichText(event.detail.delta, event.detail.text ?? '')
    rendered = JSON.stringify(value.delta)
    validate(value.text)
    emit('update:value', value)
  } catch (e) { error.value = (e as Error).message; emit('validity', false) }
}
function format(name: 'bold' | 'italic' | 'underline' | 'list', value?: string) {
  if (!locked.value) context?.format(name, value ?? '')
}
function status(event: { detail: Record<string, unknown> }) { formats.value = event.detail }
watch(() => props.value, sync, { deep: true })
onBeforeUnmount(() => { disposed = true; context = undefined })
</script>
<template>
  <view class="rich-editor">
    <view class="rich-toolbar">
      <button
        class="format-button bold"
        :class="{ selected: formats.bold }"
        :disabled="locked"
        aria-label="加粗"
        @tap="format('bold')"
      >
        B
      </button>
      <button
        class="format-button italic"
        :class="{ selected: formats.italic }"
        :disabled="locked"
        aria-label="斜体"
        @tap="format('italic')"
      >
        I
      </button>
      <button
        class="format-button underline"
        :class="{ selected: formats.underline }"
        :disabled="locked"
        aria-label="下划线"
        @tap="format('underline')"
      >
        U
      </button>
      <button
        class="format-button"
        :class="{ selected: formats.list === 'ordered' }"
        :disabled="locked"
        @tap="format('list', 'ordered')"
      >
        编号
      </button>
      <button
        class="format-button"
        :class="{ selected: formats.list === 'bullet' }"
        :disabled="locked"
        @tap="format('list', 'bullet')"
      >
        列表
      </button>
    </view>
    <editor
      :id="editorId"
      class="rich-input"
      :read-only="disabled"
      placeholder="介绍活动内容、流程及参与须知"
      @ready="onReady"
      @input="onInput"
      @statuschange="status"
    />
    <view class="rich-count">
      {{ length }} / {{ ACTIVITY_BODY_MAX_LENGTH }}
    </view>
    <view
      v-if="error"
      class="rich-error"
    >
      {{ error }}
    </view>
    <button
      v-if="error && length <= ACTIVITY_BODY_MAX_LENGTH"
      :disabled="disabled"
      @tap="retry"
    >
      重新加载正文
    </button>
  </view>
</template>
<style scoped>
.rich-editor { border: 1rpx solid #d8ded9; border-radius: 16rpx; overflow: hidden; }
.rich-toolbar { display: flex; gap: 8rpx; padding: 12rpx; background: #f5f7f4; }
.format-button { margin: 0; min-width: 80rpx; min-height: 80rpx; padding: 0 16rpx; font-size: 28rpx; line-height: 80rpx; background: transparent; }
.format-button::after { border: 0; }
.format-button.selected { color: #247552; background: #e2eee6; }
.bold { font-weight: bold; }.italic { font-style: italic; }.underline { text-decoration: underline; }
.rich-input { box-sizing: border-box; height: 520rpx; padding: 24rpx; font-size: 30rpx; line-height: 1.7; }
.rich-count { padding: 8rpx 24rpx 16rpx; text-align: right; color: #667369; font-size: 24rpx; }
.rich-error { padding: 0 24rpx 20rpx; color: #ad3c32; font-size: 26rpx; }
</style>
