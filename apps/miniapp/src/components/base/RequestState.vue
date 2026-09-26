<script setup lang="ts">
defineProps<{
    loading?: boolean
    error?: string
    empty?: boolean
    emptyText?: string
}>()
defineEmits<{
    (event: 'retry'): void
}>()
</script>
<template>
  <view
    v-if="loading"
    class="empty"
  >
    正在加载…
  </view><view
    v-else-if="error"
    class="empty"
  >
    <view class="error">
      {{ error }}
    </view><button
      class="text-button"
      @click="$emit('retry')"
    >
      重新加载
    </button>
  </view><view
    v-else-if="empty"
    class="empty"
  >
    {{ emptyText || '暂无内容' }}
  </view>
</template>
