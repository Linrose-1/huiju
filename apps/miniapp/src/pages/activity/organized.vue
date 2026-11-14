<script setup lang="ts">
import PageReturn from '@/components/base/PageReturn.vue'
import { computed, ref, watch } from 'vue'
import { onShow, onHide, onUnload, onReachBottom, onPullDownRefresh } from '@dcloudio/uni-app'
import { api, errorMessage } from '@/services/api'
import type { ActivityCounts } from '@/services/api'
import type { ManagedActivity } from '@/services/api/types'
import { activityFilters } from '@/services/my-activities'
import { navigate, routes, loginPage } from '@/services/navigation'
import { useSessionStore } from '@/stores/session'
import RequestState from '@/components/base/RequestState.vue'
import ListMore from '@/components/base/ListMore.vue'
import MyActivityCard from '@/components/business/MyActivityCard.vue'
const session = useSessionStore()
const items = ref<ManagedActivity[]>([]), loading = ref(false), error = ref(''), hasMore = ref(false)
const loadingMore = ref(false), moreError = ref(''), counts = ref<ActivityCounts | null>(null)
const selected = ref('all'), now = ref(Date.now())
let generation = 0, offset = 0, shown = false
const filters = computed(() => activityFilters.map(filter => ({ ...filter, count: counts.value?.[filter.key] ?? 0 })))
const visibleItems = computed(() => items.value)
function clear() {
  generation++; offset = 0; items.value = []; counts.value = null; error.value = ''; moreError.value = ''
  loading.value = false; loadingMore.value = false; hasMore.value = false
}
async function load(background = false) {
  const targetCount = background === true ? offset : 0
  const retain = targetCount > 0
  if (retain) { generation++; error.value = ''; moreError.value = '' } else clear()
  now.value = Date.now()
  const current = generation, token = session.token, epoch = session.epoch
  const isCurrent = () => current === generation && token === session.token && epoch === session.epoch
  if (!token) { uni.stopPullDownRefresh(); return }
  loading.value = !retain; loadingMore.value = retain
  try {
    let result = await api.organizedActivities({ offset: 0, status: selected.value })
    const nextItems = [...result.items]
    while (isCurrent() && result.hasMore && result.items.length && nextItems.length < targetCount) {
      result = await api.organizedActivities({ offset: nextItems.length, status: selected.value })
      nextItems.push(...result.items)
    }
    if (isCurrent()) { items.value = nextItems; offset = nextItems.length; hasMore.value = result.hasMore; counts.value = result.counts }
  } catch (e) { if (isCurrent()) error.value = errorMessage(e) }
  finally { if (isCurrent()) { loading.value = false; loadingMore.value = false; uni.stopPullDownRefresh() } }
}
async function more() {
  if (loading.value || loadingMore.value || moreError.value || error.value || !hasMore.value || !session.token) return
  const current = generation, token = session.token, epoch = session.epoch
  const isCurrent = () => current === generation && token === session.token && epoch === session.epoch
  loadingMore.value = true
  try {
    const result = await api.organizedActivities({ offset, status: selected.value })
    if (!isCurrent()) return
    offset += result.items.length
    const known = new Set(items.value.map(item => item.id))
    items.value.push(...result.items.filter(item => !known.has(item.id)))
    hasMore.value = result.hasMore; counts.value = result.counts
  } catch (e) { if (isCurrent()) moreError.value = errorMessage(e) }
  finally { if (isCurrent()) loadingMore.value = false }
}
function retryMore() { moreError.value = ''; void more() }
function selectFilter(value: string) { if (selected.value !== value) { selected.value = value; void load() } }
function open(item: ManagedActivity) { navigate(routes.manage + '?id=' + item.id) }
const stop = watch(() => [session.token, session.epoch], () => { selected.value = 'all'; clear(); if (shown) void load() }, { flush: 'sync' })
onShow(() => { shown = true; void load(true) })
onHide(() => { shown = false; generation++; loading.value = false; loadingMore.value = false })
onUnload(() => { shown = false; clear(); stop() })
onReachBottom(more)
onPullDownRefresh(load)
</script>
<template>
  <view class="activities-page organizer-page">
    <PageReturn />
    <view class="activity-tabs">
      <view class="tab" @click="navigate(routes.registrations, true)">我报名的</view>
      <view class="tab active" @click="selectFilter('all')">我发起的</view>
      <button
        class="start"
        @click="navigate(routes.editor)"
      >
        ＋ 发起活动
      </button>
    </view>
    <scroll-view
      v-if="session.token"
      class="filters"
      scroll-x
    >
      <view class="filter-row">
        <view
          v-for="filter in filters"
          :key="filter.key"
          class="filter"
          :class="{selected:selected===filter.key}"
          @click="selectFilter(filter.key)"
        >
          {{ filter.label }}
        </view>
      </view>
    </scroll-view>
    <view
      v-if="!session.token"
      class="empty"
    >
      登录后管理自己发起的活动<button
        class="text-button"
        @click="loginPage(routes.organizedActivities)"
      >
        去登录
      </button>
    </view>
    <template v-else>
      <RequestState
        :loading="loading"
        :error="error"
        :empty="!visibleItems.length"
        :empty-text="selected!=='all'?'当前分类下暂无活动':'还没有发起活动，创建第一场活动吧'"
        @retry="load"
      />
      <template v-if="items.length || (!loading && !error)">
        <MyActivityCard
          v-for="item in visibleItems"
          :key="item.id"
          :activity="item"
          :now="now"
          @roster="navigate(routes.manage + '?id=' + item.id + '&section=roster')"
          @edit="navigate(routes.editor + '?id=' + item.id)"
          @open="open(item)"
        />
        <ListMore
          :loading="loadingMore"
          :error="moreError"
          :has-more="hasMore"
          :has-items="!!items.length"
          @retry="retryMore"
        />
      </template>
    </template>
  </view>
</template>
<style scoped src="../../styles/my-activities.css"></style>
