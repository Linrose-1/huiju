<script setup lang="ts">
import { ref, watch } from 'vue'
import { onLoad, onShow, onHide, onUnload, onPullDownRefresh, onReachBottom } from '@dcloudio/uni-app'
import PageReturn from '@/components/base/PageReturn.vue'
import RequestState from '@/components/base/RequestState.vue'
import ListMore from '@/components/base/ListMore.vue'
import { api } from '@/services/api'
import { mediaUrl } from '@/services/api/environment'
import { circleTime, useCircleList } from '@/services/circle'
import { useSessionStore } from '@/stores/session'

const id = ref('')
const list = useCircleList(async offset => {
  if (!id.value) throw new Error('帖子链接不完整，请从商友圈重新进入')
  const page = await api.circleReaders(id.value, offset)
  return { ...page, items: page.items.map(reader => ({ ...reader, id: reader.memberId })) }
})
const { items, loading, loadingMore, error, moreError, hasMore } = list
const session = useSessionStore()
let visible = false
watch(() => [session.token, session.epoch], () => { if (visible) void list.load() }, { flush: 'sync' })
onLoad(query => { id.value = String(query?.id || '') })
onShow(() => { visible = true; void list.load() })
onHide(() => { visible = false; list.clear() })
onUnload(() => { visible = false; list.clear() })
onPullDownRefresh(() => list.load())
onReachBottom(() => list.load(true))
</script>
<template>
  <view class="readers-page">
    <PageReturn />
    <RequestState
      :loading="loading"
      :error="error"
      :empty="!items.length"
      empty-text="暂无阅读记录"
      @retry="list.load()"
    />
    <view
      v-if="items.length"
      class="readers-list"
    >
      <view
        v-for="reader in items"
        :key="reader.id"
        class="reader"
      >
        <image
          v-if="reader.avatarUrl"
          class="portrait"
          :src="mediaUrl(reader.avatarUrl)"
          mode="aspectFill"
        />
        <text
          v-else
          class="portrait placeholder"
        >
          {{ reader.displayName?.slice(0, 1) || '友' }}
        </text>
        <view class="reader-info">
          <view>{{ reader.displayName || '学友' }}</view>
          <view
            v-if="reader.readCount != null && reader.lastReadAt"
            class="stats"
          >
            阅读 {{ reader.readCount }} 次 · 最近 {{ circleTime(reader.lastReadAt) }}
          </view>
        </view>
      </view>
    </view>
    <ListMore
      :loading="loadingMore"
      :error="moreError"
      :has-more="hasMore"
      :has-items="!!items.length"
      @retry="list.retryMore"
    />
  </view>
</template>
<style scoped>
.readers-page{padding:24rpx 24rpx calc(24rpx + env(safe-area-inset-bottom))}.readers-list{border-radius:20rpx;background:white;padding:0 24rpx}.reader{display:flex;align-items:center;gap:20rpx;padding:24rpx 0;border-bottom:1rpx solid #e5ece8}.reader:last-child{border:0}.portrait{width:76rpx;height:76rpx;border-radius:50%;flex:none}.placeholder{display:flex;align-items:center;justify-content:center;background:#e7f0e9;color:#436b57}.reader-info{color:#203d32;font-size:30rpx}.stats{font-size:24rpx;color:#597267;margin-top:6rpx}
</style>
