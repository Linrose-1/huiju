<script setup lang="ts">
import { ref } from 'vue'
import { onMounted, onUnmounted } from 'vue'
import { api, errorMessage } from '@/services/api'
import type { LegalDocuments } from '@/services/api/types'
defineProps<{ kind: 'terms' | 'privacy' }>()
const documents = ref<LegalDocuments | null>(null), loading = ref(false), error = ref('')
let generation = 0
async function load() {
  const current = ++generation
  loading.value = true; error.value = ''
  try { const result = await api.legalDocuments(); if (current === generation) documents.value = result }
  catch (e) { if (current === generation) error.value = errorMessage(e) }
  finally { if (current === generation) loading.value = false }
}
onMounted(load)
onUnmounted(() => { generation++ })
</script>
<template>
  <view class="legal-document">
    <view
      v-if="loading"
      class="muted"
    >
      正在读取…
    </view>
    <view
      v-else-if="error"
      class="error"
    >
      {{ error }}<button
        class="text-button"
        @click="load"
      >
        重试
      </button>
    </view>
    <view v-else-if="documents">
      <view
        v-if="documents.development"
        class="development"
      >
        开发测试文本，正式正文与运营主体待补充
      </view>
      <view class="version">
        版本：{{ documents[kind].version }}
      </view>
      <text
        class="body"
        selectable
      >
        {{ documents[kind].body }}
      </text>
    </view>
  </view>
</template>
<style scoped>
.legal-document{padding:40rpx 32rpx calc(48rpx + env(safe-area-inset-bottom));background:#fff;min-height:100vh}.development{padding:24rpx;background:#fff6df;color:#765319;border-radius:16rpx;font-size:26rpx;line-height:1.6;margin-bottom:28rpx}.version{color:#78837c;font-size:24rpx;margin-bottom:24rpx}.body{font-size:30rpx;line-height:1.85;white-space:pre-wrap;overflow-wrap:anywhere}
</style>
