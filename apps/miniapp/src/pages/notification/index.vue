<script setup lang="ts">
import { ref, watch } from 'vue'
import { onShow, onHide, onUnload } from '@dcloudio/uni-app'
import { api, errorMessage } from '@/services/api'
import type { ActivityNotification } from '@/services/api/types'
import { dateTime } from '@/services/presentation'
import { navigate, routes, loginPage } from '@/services/navigation'
import { useSessionStore } from '@/stores/session'
import RequestState from '@/components/base/RequestState.vue'
const session = useSessionStore()
const items = ref<ActivityNotification[]>([]), loading = ref(false), error = ref(''), actionError = ref(''), busy = ref(false), hasMore = ref(false)
let generation = 0
let shown = false
function currentRequest() {
  const current = generation, token = session.token, epoch = session.epoch
  return () => current === generation && !!token && token === session.token && epoch === session.epoch
}
function clear() {
  generation++
  items.value = []; error.value = ''; actionError.value = ''; hasMore.value = false
  loading.value = false; busy.value = false
}
async function load() {
  clear()
  const active = currentRequest()
  if (!session.token) { loading.value = false; return }
  loading.value = true
  try {
    const result = await api.notifications()
    if (active()) { items.value = result.items; hasMore.value = result.hasMore }
  } catch (e) { if (active()) error.value = errorMessage(e) }
  finally { if (active()) loading.value = false }
}
async function open(item: ActivityNotification) {
  if (busy.value || !session.token || !items.value.includes(item)) return
  const active = currentRequest(), activityId = item.activityId
  busy.value = true; actionError.value = ''
  try {
    if (!item.readAt) {
      await api.readNotification(item.id)
      if (!active()) return
      item.readAt = new Date().toISOString()
    }
    if (active() && activityId) navigate(routes.detail+'?id='+encodeURIComponent(activityId))
  } catch (e) { if (active()) actionError.value = errorMessage(e) }
  finally { if (active()) busy.value = false }
}
const stop = watch(() => [session.token, session.epoch], () => { clear(); if (shown) void load() }, { flush: 'sync' })
onShow(() => { shown = true; void load() })
onHide(() => { shown = false; clear() })
onUnload(() => { shown = false; clear(); stop() })
</script>
<template>
  <view class="page-pad notifications-page">
    <view
      v-if="!session.token"
      class="empty"
    >
      登录后查看自己的通知<button
        class="text-button"
        @click="loginPage(routes.notifications)"
      >
        去登录
      </button>
    </view>
    <template v-else>
      <view class="notification-hint">
        <uni-icons
          type="info-filled"
          size="34rpx"
          color="#26775d"
        /><text>已报名活动的变动，会在这里通知你。</text>
      </view>
      <RequestState
        :loading="loading"
        :error="error"
        :empty="!items.length"
        empty-text="暂无活动变动通知"
        @retry="load"
      />
      <view
        v-if="actionError"
        class="error"
      >
        {{ actionError }}
      </view>
      <template v-if="!loading && !error">
        <view
          v-for="item in items"
          :key="item.id"
          class="card message"
        >
          <view class="message-icon">
            <uni-icons
              type="notification"
              size="36rpx"
              color="#26775d"
            />
          </view>
          <view class="message-content">
            <view class="row between">
              <text class="section-title">{{ item.title }}</text><text
                v-if="!item.readAt"
                class="unread"
              >
                未读
              </text>
            </view>
            <view class="body">{{ item.body }}</view>
            <view class="message-footer">
              <view class="muted small">{{ dateTime(item.createdAt) }}</view>
              <button
                class="text-button"
                :disabled="busy"
                @click="open(item)"
              >
                {{ item.activityId?'查看活动 →':item.readAt?'已读':'标为已读' }}
              </button>
            </view>
          </view>
        </view>
        <view
          v-if="hasMore"
          class="muted small"
        >
          当前显示最近 100 条通知。
        </view>
      </template>
    </template>
  </view>
</template>
<style scoped>
.notifications-page{min-height:100vh;background:#f4f8f7;padding:20rpx 26rpx calc(40rpx + env(safe-area-inset-bottom))}
.notification-hint{display:flex;align-items:center;gap:18rpx;background:#e9f4ef;color:#205d49;padding:22rpx 24rpx;border-radius:18rpx;font-size:27rpx;line-height:1.6;margin-bottom:18rpx}
.message{display:flex;align-items:flex-start;gap:18rpx;padding:24rpx;border-radius:20rpx;margin-bottom:18rpx}
.message-icon{display:flex;align-items:center;justify-content:center;flex-shrink:0;width:64rpx;height:64rpx;border-radius:50%;background:#e8f6ee}
.message-content{flex:1;min-width:0}
.message .section-title{font-size:31rpx;line-height:1.5;margin:0;overflow-wrap:anywhere}
.unread{flex-shrink:0;color:#27745b;font-size:24rpx;white-space:nowrap}
.unread::before{content:'';display:inline-block;width:12rpx;height:12rpx;background:#27745b;border-radius:50%;margin-right:10rpx}
.body{white-space:pre-wrap;overflow-wrap:anywhere;line-height:1.7;margin:14rpx 0 18rpx;font-size:27rpx;color:#616a76}
.message-footer{display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;column-gap:16rpx}
.message-footer .small{font-size:24rpx;line-height:1.6}
.message .text-button{text-align:right;font-size:26rpx;min-height:64rpx;padding:12rpx 0;margin-left:auto}
</style>
