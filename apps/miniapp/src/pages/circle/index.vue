<script setup lang="ts">
import { ref, watch } from 'vue'
import { useSessionStore } from '@/stores/session'
import { onShow, onHide, onUnload, onReachBottom, onPullDownRefresh } from '@dcloudio/uni-app'
import { api } from '@/services/api'
import type { CirclePost } from '@/services/api/types'
import { routes, navigate } from '@/services/navigation'
import { mediaUrl } from '@/services/api/environment'
import { useCircleList, circleCategories, categoryLabel, subtypeLabel, stateLabel } from '@/services/circle'
import RequestState from '@/components/base/RequestState.vue'
import ListMore from '@/components/base/ListMore.vue'
const category = ref('all'), filters = [{ key: 'all', label: '全部' }, ...circleCategories]
const list = useCircleList<CirclePost>(offset => api.circlePosts({ offset, category: category.value }))
const { items, loading, loadingMore, error, moreError, hasMore } = list
function selectCategory(key: string) { if (category.value === key) return; category.value = key; void list.load() }
let visible = false
const session = useSessionStore()
watch(() => [session.token,session.epoch], () => { if(visible) void list.load() }, {flush:'sync'})
onShow(() => { visible=true;void list.load() }); onHide(() => {visible=false;list.clear()}); onUnload(() => {visible=false;list.clear()})
onReachBottom(() => list.load(true)); onPullDownRefresh(() => list.load())
</script>
<template>
  <view class="circle-home">
    <view class="circle-home-hero">
      <image
        class="circle-home-hero-image"
        src="/static/huiju/circle-park.jpg"
        mode="aspectFill"
      />
      <view class="circle-home-hero-fade" />
      <view class="circle-home-hero-copy serif"><view>连接园区伙伴，</view><view>共享资源机会</view><view class="circle-home-line" /><text>资源互通 · 合作共赢 · 园区更好</text></view>
    </view>
    <view class="circle-page">
      <view class="circle-chips">
        <view
          v-for="filter in filters"
          :key="filter.key"
          class="circle-chip"
          :class="{selected:category===filter.key}"
          @click="selectCategory(filter.key)"
        >
          {{ filter.label }}
        </view>
      </view>
      <view class="circle-home-entries">
        <view
          class="circle-home-entry"
          @click="navigate(routes.circleEditor)"
        >
          <view class="circle-home-symbol">＋</view><view class="grow"><view class="circle-title">发布</view><text class="circle-muted">分享资源与机会</text></view><text>›</text>
        </view>
        <view
          class="circle-home-entry"
          @click="navigate(routes.circleMine)"
        >
          <view class="circle-home-symbol gold">▤</view><view class="grow"><view class="circle-title">我的帖子</view><text class="circle-muted">查看与管理</text></view><text>›</text>
        </view>
      </view>
      <RequestState
        :loading="loading"
        :error="error"
        :empty="!items.length"
        empty-text="暂时没有相关帖子"
        @retry="list.load()"
      />
      <view
        v-for="post in items"
        :key="post.id"
        class="circle-card"
        @click="navigate(routes.circleDetail+'?id='+post.id)"
      >
        <view class="row">
          <view class="grow">
            <view class="circle-tag">{{ categoryLabel(post.category) }}{{ post.subtype ? ' · '+subtypeLabel(post.subtype) : '' }}</view><view class="circle-title home-title">{{ post.title }}</view><view class="circle-copy home-summary">{{ post.body }}</view><view
              v-if="post.location"
              class="circle-muted"
            >
              ⌖ {{ post.location }}
            </view>
          </view><image
            v-if="post.images[0]"
            class="circle-photo"
            :src="mediaUrl(post.images[0].url)"
            mode="aspectFill"
          />
        </view>
        <view class="circle-author">
          <image
            v-if="post.author?.avatarUrl"
            class="circle-avatar"
            :src="mediaUrl(post.author.avatarUrl)"
            mode="aspectFill"
          /><view>
            <view>{{ post.author?.displayName || '学友' }}</view><view
              v-if="post.state==='ended'"
              class="circle-muted"
            >
              {{ stateLabel(post.state) }}
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
  </view>
</template>
<style lang="scss">@import './circle.scss';</style>
<style scoped>
.circle-home-hero{position:relative;height:275rpx;overflow:hidden;background:#eaf4ed}.circle-home-hero-image{position:absolute;right:0;top:0;width:65%;height:100%}.circle-home-hero-fade{position:absolute;inset:0;background:linear-gradient(90deg,#f2f8f3 15%,#f2f8f3dd 45%,#f2f8f300 80%)}.circle-home-hero-copy{position:relative;font-size:40rpx;line-height:1.5;padding:24rpx 40rpx;color:#124b35;letter-spacing:2rpx}.circle-home-hero-copy text{font-family:sans-serif;font-weight:400;font-size:23rpx;color:#7a8980;letter-spacing:0}.circle-home-line{height:4rpx;width:64rpx;background:#cba260;margin:16rpx 0 12rpx}.circle-home-entries{display:flex;gap:16rpx;margin-bottom:24rpx}.circle-home-entry{flex:1;min-width:0;background:#fff;border-radius:18rpx;padding:19rpx 16rpx;display:flex;align-items:center;gap:14rpx}.circle-home-entry .circle-title{font-size:30rpx}.circle-home-symbol{width:64rpx;height:64rpx;flex-shrink:0;border-radius:50%;background:#18573f;color:#fff;font-size:49rpx;text-align:center;line-height:59rpx}.circle-home-symbol.gold{background:#d5b268;font-size:40rpx}.home-title{margin:14rpx 0 10rpx}.home-summary{display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:2;overflow:hidden}.circle-home .circle-avatar{width:54rpx;height:54rpx}
</style>
