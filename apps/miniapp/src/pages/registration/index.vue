<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { onShow, onUnload } from '@dcloudio/uni-app'
import { api, errorMessage } from '@/services/api'
import type { MyRegistration } from '@/services/api/types'
import { activityFilters, myActivityState } from '@/services/my-activities'
import { navigate, routes, loginPage } from '@/services/navigation'
import { useSessionStore } from '@/stores/session'
import RequestState from '@/components/base/RequestState.vue'
import MyActivityCard from '@/components/business/MyActivityCard.vue'
const session = useSessionStore()
const items = ref<MyRegistration[]>([]), loading = ref(false), error = ref('')
const selected = ref('all'), now = ref(Date.now()), showTip = ref(true)
let generation = 0
const filters = computed(() => activityFilters.filter(filter => filter.key !== 'draft').map(filter => ({
  ...filter, count: filter.key === 'all' ? items.value.length : items.value.filter(item => myActivityState(item.activity, item.status, now.value) === filter.key).length
})))
const visibleItems = computed(() => selected.value === 'all' ? items.value : items.value.filter(item => myActivityState(item.activity, item.status, now.value) === selected.value))
async function load() {
  const current = ++generation, token = session.token, epoch = session.epoch
  const isCurrent = () => current === generation && token === session.token && epoch === session.epoch
  items.value = []; error.value = ''; now.value = Date.now()
  if (!token) { loading.value = false; return }
  loading.value = true
  try {
    const result = await api.registrations()
    if (isCurrent()) items.value = result.items
  } catch (e) { if (isCurrent()) error.value = errorMessage(e) }
  finally { if (isCurrent()) loading.value = false }
}
function open(item: MyRegistration) { navigate(routes.result + '?id=' + item.activityId) }
function browse() { uni.switchTab({ url: routes.activity }) }
const stop = watch(() => [session.token, session.epoch], () => { selected.value = 'all'; void load() }, { flush: 'sync' })
onShow(load)
onUnload(() => { generation++; stop() })
</script>
<template>
  <view class="activities-page">
    <view class="activity-tabs">
      <view
        class="tab"
        @click="navigate(routes.organizedActivities, true)"
      >
        我发起的
      </view>
      <view
        class="tab active"
        @click="selected='all'"
      >
        我报名的
      </view>
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
          @click="selected=filter.key"
        >
          {{ filter.label }}<text v-if="!loading && !error"> ({{ filter.count }})</text>
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
        :empty-text="items.length?'当前分类下暂无活动':'还没有报名记录，去发现感兴趣的活动吧'"
        @retry="load"
      />
      <template v-if="!loading && !error">
        <MyActivityCard
          v-for="item in visibleItems"
          :key="item.id"
          :activity="item.activity"
          :now="now"
          :registration-status="item.status"
          @open="open(item)"
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
    <view
      v-if="showTip"
      class="tip"
    >
      <uni-icons
        type="info"
        size="40rpx"
        color="#31ad70"
      /><view class="tip-content"><view class="tip-title">小提示</view><text>活动前可在报名详情中查看安排，及时留意活动通知。</text></view><view
        class="dismiss"
        @click="showTip=false"
      >
        <uni-icons
          type="closeempty"
          size="30rpx"
          color="#87988f"
        />
      </view>
    </view>
  </view>
</template>
<style scoped>.activities-page{min-height:100vh;box-sizing:border-box;padding:22rpx 26rpx calc(30rpx + env(safe-area-inset-bottom));background:#f5f9f7}.activity-tabs{display:flex;align-items:center;gap:34rpx;padding:6rpx 8rpx 24rpx}.tab{font-size:29rpx;color:#65756b;line-height:1.5;padding:12rpx 0 16rpx;white-space:nowrap;border-bottom:3rpx solid transparent}.tab.active{font-weight:600;color:#169657;border-color:#169657}.start{margin:0 0 0 auto;padding:0 18rpx;background:linear-gradient(110deg,#31b16b,#07974a);color:white;border-radius:32rpx;height:58rpx;line-height:58rpx;font-size:25rpx;white-space:nowrap}.start::after{border:0}.filters{width:100%;margin-bottom:20rpx;white-space:nowrap}.filter-row{display:flex;gap:12rpx;min-width:max-content}.filter{padding:12rpx 21rpx;border-radius:30rpx;background:#fff;color:#819086;font-size:25rpx;line-height:1.4;flex-shrink:0}.filter.selected{background:#dff2e8;color:#179456}.limit{font-size:24rpx;color:#859389;padding:16rpx;line-height:1.5}.tip{display:flex;gap:18rpx;align-items:center;background:#edf5f0;border-radius:20rpx;padding:22rpx;margin-top:22rpx}.tip-content{flex:1;min-width:0;font-size:23rpx;color:#8a9b90;line-height:1.6}.tip-title{font-size:28rpx;font-weight:600;color:#263b2d;margin-bottom:4rpx}.dismiss{width:48rpx;height:48rpx;display:flex;align-items:center;justify-content:center;align-self:flex-start}.browse{background:#e1f2e8;color:#198653;font-size:28rpx;border-radius:32rpx}</style>
