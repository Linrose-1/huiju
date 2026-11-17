<script setup lang="ts">
import { computed, ref, watch } from 'vue'

const props = defineProps<{
  startsAt?: string | null
  endsAt?: string | null
  date?: string | null
  disabled?: boolean
}>()
const emit = defineEmits<{ (event: 'confirm', value: { startsAt: string; endsAt: string }): void }>()
const startDate = ref(''), startTime = ref(''), endDate = ref(''), endTime = ref(''), error = ref('')
function beijingParts(value?: string | null) {
  const time = value ? Date.parse(value) : NaN
  if (!Number.isFinite(time)) return { date: '', time: '' }
  const local = new Date(time + 8 * 60 * 60 * 1000).toISOString()
  return { date: local.slice(0, 10), time: local.slice(11, 16) }
}
const today = computed(() => beijingParts(new Date().toISOString()).date)
watch([() => props.startsAt, () => props.endsAt, () => props.date], () => {
  const start = beijingParts(props.startsAt), end = beijingParts(props.endsAt)
  startDate.value = start.date || props.date || ''
  startTime.value = start.time
  endDate.value = end.date || startDate.value
  endTime.value = end.time
  error.value = ''
}, { immediate: true })
function selectStartDate(value: string) {
  if (props.disabled) return
  const previous = startDate.value
  startDate.value = value
  if (!endDate.value || endDate.value === previous) endDate.value = value
  error.value = ''
}
function confirm() {
  if (props.disabled) return
  if (!startDate.value || !startTime.value || !endDate.value || !endTime.value) {
    error.value = '请选择开始和结束的日期、时间'
    return
  }
  const startsAt = `${startDate.value}T${startTime.value}:00+08:00`
  const endsAt = `${endDate.value}T${endTime.value}:00+08:00`
  if (!Number.isFinite(Date.parse(startsAt)) || !Number.isFinite(Date.parse(endsAt))) {
    error.value = '时间格式不正确，请重新选择'
    return
  }
  if (Date.parse(startsAt) <= Date.now()) {
    error.value = '开始时间需晚于当前时间'
    return
  }
  if (Date.parse(endsAt) <= Date.parse(startsAt)) {
    error.value = '结束时间需晚于开始时间，跨天聚会请选择结束日期'
    return
  }
  error.value = ''
  emit('confirm', { startsAt, endsAt })
}
</script>

<template>
  <view class="time-picker">
    <text class="time-label">开始时间</text>
    <view class="time-row">
      <picker class="time-control" mode="date" :value="startDate || today" :start="today" :disabled="disabled" @change="selectStartDate($event.detail.value)">
        <view class="time-field">{{ startDate || '选择日期' }}<text>⌄</text></view>
      </picker>
      <picker class="time-control" mode="time" :value="startTime || '09:00'" :disabled="disabled" @change="startTime = $event.detail.value; error = ''">
        <view class="time-field">{{ startTime || '选择时间' }}<text>⌄</text></view>
      </picker>
    </view>
    <text class="time-label">结束时间</text>
    <view class="time-row">
      <picker class="time-control" mode="date" :value="endDate || startDate || today" :start="startDate || today" :disabled="disabled" @change="endDate = $event.detail.value; error = ''">
        <view class="time-field">{{ endDate || '选择日期' }}<text>⌄</text></view>
      </picker>
      <picker class="time-control" mode="time" :value="endTime || '11:00'" :disabled="disabled" @change="endTime = $event.detail.value; error = ''">
        <view class="time-field">{{ endTime || '选择时间' }}<text>⌄</text></view>
      </picker>
    </view>
    <text class="time-help">北京时间；跨天聚会可选择不同的结束日期。</text>
    <text v-if="error" class="time-error">{{ error }}</text>
    <button class="time-confirm" :disabled="disabled" @click="confirm">使用这个时间</button>
  </view>
</template>

<style scoped>
.time-picker { padding:24rpx; border:1rpx solid #dce7e0; border-radius:20rpx; background:#f5f9f6; }
.time-label { display:block; margin-bottom:12rpx; color:#315b48; font-size:27rpx; }
.time-row { display:flex; gap:16rpx; margin-bottom:24rpx; }
.time-control { flex:1; min-width:0; }
.time-field { display:flex; align-items:center; justify-content:space-between; gap:12rpx; min-height:88rpx; box-sizing:border-box; padding:12rpx 18rpx; border:1rpx solid #cbdcd1; border-radius:14rpx; background:#fff; color:#244d3a; font-size:27rpx; }
.time-help,.time-error { display:block; font-size:24rpx; line-height:1.5; }
.time-help { color:#687d70; }
.time-error { margin-top:12rpx; color:#a44431; }
.time-confirm { margin-top:22rpx; min-height:88rpx; border-radius:16rpx; background:#176c4f; color:#fff; font-size:28rpx; line-height:88rpx; }
.time-confirm::after { border:0; }
</style>
