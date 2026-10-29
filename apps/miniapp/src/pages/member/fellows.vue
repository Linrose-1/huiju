<script setup lang="ts">
import { ref, watch } from 'vue'
import { onShow, onHide, onUnload, onReachBottom, onPullDownRefresh } from '@dcloudio/uni-app'
import { api, errorMessage } from '@/services/api'
import type { FellowSummary } from '@/services/api/types'
import { routes, navigate, requireProfile } from '@/services/navigation'
import { useSessionStore } from '@/stores/session'
import FellowPerson from '@/components/business/FellowPerson.vue'
import RequestState from '@/components/base/RequestState.vue'
import ListMore from '@/components/base/ListMore.vue'
const session = useSessionStore()
const inviter = ref<FellowSummary | null>(null), items = ref<FellowSummary[]>([]), total = ref(0), hasMore = ref(false)
const loading = ref(false), loadingMore = ref(false), error = ref(''), moreError = ref(''), ready = ref(false)
let generation = 0, offset = 0, visible = false
function currentRequest() { const g = generation, token = session.token, epoch = session.epoch; return () => visible && g === generation && token === session.token && epoch === session.epoch }
function clear() { generation++; inviter.value = null; items.value = []; total.value = 0; offset = 0; hasMore.value = false; loading.value = false; loadingMore.value = false; error.value = ''; moreError.value = ''; ready.value = false }
async function load() {
  clear(); loading.value = true
  const g = generation
  try {
    const allowed = await requireProfile(routes.fellows)
    if (!visible || g !== generation) return
    if (!allowed) { error.value = '完善资料后可查看我的学友'; return }
    const current = currentRequest(), result = await api.fellows({offset:0,limit:20})
    if (!current()) return
    inviter.value = result.inviter; items.value = result.items; total.value = result.total; hasMore.value = result.hasMore; offset = result.items.length; ready.value = true
  } catch (e) { if (visible && g === generation) error.value = errorMessage(e) }
  finally { if (g === generation) { loading.value = false; uni.stopPullDownRefresh() } }
}
async function more() {
  if (!ready.value || loading.value || loadingMore.value || moreError.value || !hasMore.value) return
  const current = currentRequest(); loadingMore.value = true
  try {
    const result = await api.fellows({offset,limit:20})
    if (!current()) return
    const known = new Set(items.value.map(item => item.memberId))
    items.value.push(...result.items.filter(item => !item.memberId || !known.has(item.memberId)))
    offset += result.items.length; total.value = result.total; hasMore.value = result.hasMore
  } catch (e) { if (current()) moreError.value = errorMessage(e) }
  finally { if (current()) loadingMore.value = false }
}
function retryMore() { moreError.value = ''; void more() }
function open(person: FellowSummary) { if (person.canOpenCard && person.memberId) navigate(routes.memberCard+'?id='+encodeURIComponent(person.memberId)) }
const stop = watch(() => [session.token,session.epoch], () => { clear(); if (visible) void load() }, {flush:'sync'})
onShow(() => { visible = true; void load() })
onHide(() => { visible = false; clear() })
onUnload(() => { visible = false; clear(); stop() })
onReachBottom(more)
onPullDownRefresh(load)
</script>
<template>
  <view class="page-pad fellows-page">
    <view class="notice">这里展示直接邀请你的人，以及你直接邀请的人。邀请关系建立后保持不变。</view>
    <RequestState
      :loading="loading"
      :error="error"
      @retry="load"
    />
    <template v-if="ready && !loading && !error">
      <view class="group-label">邀请我的学友</view>
      <view class="card person-card">
        <FellowPerson
          v-if="inviter"
          :name="inviter.displayName"
          :avatar-url="inviter.avatarUrl"
          :clickable="inviter.canOpenCard"
          subtitle="邀请我的人"
          @open="open(inviter)"
        />
        <view
          v-else
          class="no-inviter"
        >
          暂无直接邀请你的学友
        </view>
      </view>
      <view class="group-heading">我邀请的学友 <text class="muted">· {{ total }}</text></view>
      <view class="card person-card">
        <view
          v-if="!items.length"
          class="empty"
        >
          还没有直接邀请的学友<button
            class="text-button"
            @click="navigate(routes.invitation)"
          >
            查看我的邀请码
          </button>
        </view>
        <view
          v-for="(person, index) in items"
          :key="person.memberId || index"
          class="fellow-row"
        >
          <FellowPerson
            :name="person.displayName"
            :avatar-url="person.avatarUrl"
            :clickable="person.canOpenCard"
            :subtitle="person.canOpenCard?'直接学友':'资料尚未完善，暂不可查看名片'"
            @open="open(person)"
          />
        </view>
        <ListMore
          :loading="loadingMore"
          :error="moreError"
          :has-more="hasMore"
          :has-items="items.length > 0"
          @retry="retryMore"
        />
      </view>
      <view class="muted small privacy-copy">点击头像或姓名查看名片，资料按对方的公开设置展示。</view>
    </template>
  </view>
</template>
<style scoped>
.fellows-page{min-height:100vh;background:#f3f8f5;padding-bottom:calc(32rpx + env(safe-area-inset-bottom))}.group-label{font-size:25rpx;color:#7e9185;margin:32rpx 0 12rpx}.group-heading{font-size:29rpx;font-weight:600;margin:36rpx 0 18rpx}.person-card{padding:4rpx 28rpx}.no-inviter{font-size:27rpx;color:#7e9185;padding:32rpx 0}.fellow-row + .fellow-row{border-top:1rpx solid #eaf0ec}.privacy-copy{line-height:1.7;margin-top:22rpx}
</style>
