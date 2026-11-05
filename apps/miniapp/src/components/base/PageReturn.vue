<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { backOrHome, hasPreviousPage } from '@/services/navigation'
const standalone = ref(false)
onMounted(() => { standalone.value = !hasPreviousPage() })
</script>
<template>
  <view
    v-if="standalone"
    class="page-return"
  >
    <button
      class="text-button page-return-button"
      @click="backOrHome"
    >
      返回首页
    </button>
  </view>
</template>
<style scoped>
.page-return{padding:12rpx 24rpx;display:flex;justify-content:flex-start}.page-return-button{margin:0;padding:12rpx 0;min-height:64rpx;font-size:26rpx;color:#24684f;background:transparent}
</style>
