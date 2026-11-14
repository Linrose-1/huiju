<script setup lang="ts">
import PageReturn from '@/components/base/PageReturn.vue'
import { computed, ref, watch } from 'vue'
import { onShow, onHide, onUnload, onReachBottom, onPullDownRefresh } from '@dcloudio/uni-app'
import { api, errorMessage } from '@/services/api'
import type { ActivityCounts } from '@/services/api'
import type { MyRegistration } from '@/services/api/types'
import { activityFilters } from '@/services/my-activities'
import { navigate, routes, loginPage } from '@/services/navigation'
import { useSessionStore } from '@/stores/session'
import RequestState from '@/components/base/RequestState.vue'
import ListMore from '@/components/base/ListMore.vue'
import MyActivityCard from '@/components/business/MyActivityCard.vue'
const session = useSessionStore()
const items = ref<MyRegistration[]>([]), loading = ref(false), error = ref(''), hasMore = ref(false)
const loadingMore = ref(false), moreError = ref(''), counts = ref<ActivityCounts | null>(null)
const selected = ref('all'), now = ref(Date.now())
let generation = 0, offset = 0, shown = false
const filters = computed(() => activityFilters.filter(filter => filter.key !== 'draft').map(filter => ({ ...filter, count: counts.value?.[filter.key] ?? 0 })))
const visibleItems = computed(() => [...items.value].sort((a, b) =>
  Date.parse(a.activity.startsAt) - Date.parse(b.activity.startsAt)
))
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
    let result = await api.registrations({ offset: 0, status: selected.value })
    const nextItems = [...result.items]
    while (isCurrent() && result.hasMore && result.items.length && nextItems.length < targetCount) {
      result = await api.registrations({ offset: nextItems.length, status: selected.value })
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
    const result = await api.registrations({ offset, status: selected.value })
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
function open(item: MyRegistration) { navigate(routes.result + '?id=' + item.activityId) }
function browse() { uni.switchTab({ url: routes.activity }) }
const stop = watch(() => [session.token, session.epoch], () => { selected.value = 'all'; clear(); if (shown) void load() }, { flush: 'sync' })
onShow(() => { shown = true; void load(true) })
onHide(() => { shown = false; generation++; loading.value = false; loadingMore.value = false })
onUnload(() => { shown = false; clear(); stop() })
onReachBottom(more)
onPullDownRefresh(load)
</script>
<template>
  <view class="activities-page itinerary-page">
    <PageReturn />
    <view class="activity-tabs">
      <view class="tab active" @click="selectFilter('all')">我报名的</view>
      <view class="tab" @click="navigate(routes.organizedActivities, true)">我发起的</view>

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
      登录后查看自己的报名<button
        class="text-button"
        @click="loginPage(routes.registrations)"
      >
        去登录
      </button>
    </view>
    <template v-else>
      <RequestState
        :loading="loading"
        :error="error"
        :empty="!visibleItems.length"
        :empty-text="selected!=='all'?'当前分类下暂无报名记录':'还没有报名记录，去发现感兴趣的活动吧'"
        @retry="load"
      />
      <template v-if="items.length || (!loading && !error)">
        <MyActivityCard
          v-for="(item, index) in visibleItems"
          :key="item.id"
          :activity="item.activity"
          :now="now"
          :registration="item"
          :previous-start="visibleItems[index - 1]?.activity.startsAt"
          @open="open(item)"
        />

        <ListMore
          :loading="loadingMore"
          :error="moreError"
          :has-more="hasMore"
          :has-items="!!items.length"
          @retry="retryMore"
        />

        <button
          v-if="!items.length"
          class="browse"
          @click="browse"
        >
          去看活动
        </button>
      </template>
    </template>
  </view>
</template>
<style scoped src="../../styles/my-activities.css"></style>
