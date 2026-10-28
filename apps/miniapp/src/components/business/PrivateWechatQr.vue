<script setup lang="ts">
import { ref, watch, onUnmounted } from 'vue'
import { useSessionStore } from '@/stores/session'
import { downloadWechatQr } from '@/services/wechat/member-qr'
const props = defineProps<{ url: string }>()
const session = useSessionStore(), path = ref(''), error = ref(''), busy = ref(false)
let generation = 0
async function load(preview = false) {
  if (busy.value) return
  const current = ++generation
  busy.value = true; error.value = ''; path.value = ''
  try {
    const file = await downloadWechatQr(props.url)
    if (current !== generation) return
    path.value = file
    if (preview) uni.previewImage({ urls: [file], current: file })
  } catch (e) { if (current === generation) error.value = e instanceof Error ? e.message : '二维码加载失败，请重试' }
  finally { if (current === generation) busy.value = false }
}
watch(() => [props.url, session.token, session.epoch], () => { generation++; busy.value = false; path.value = ''; error.value = ''; if (props.url && session.token) void load() }, { immediate: true })
onUnmounted(() => { generation++ })
</script>
<template>
  <view class="wechat-qr">
    <button
      class="qr-button"
      :disabled="busy"
      @click="load(true)"
    >
      <image
        v-if="path"
        :src="path"
        mode="aspectFit"
        class="qr-image"
      />
      <text>{{ busy ? '正在加载二维码…' : error ? '重新加载二维码' : '点击放大微信二维码' }}</text>
    </button>
    <text
      v-if="error"
      class="error"
    >
      {{ error }}
    </text>
  </view>
</template>
<style scoped>
.qr-button{padding:16rpx;background:#f2f7f4;color:#246b52;font-size:26rpx;line-height:1.6;display:flex;flex-direction:column;align-items:center;gap:12rpx}.qr-button:after{border:0}.qr-image{width:240rpx;height:240rpx}.error{display:block;font-size:24rpx;margin-top:12rpx}
</style>
