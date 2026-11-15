<script setup lang="ts">
import { ref, watch } from 'vue'
import { onShow, onHide, onUnload, onReachBottom, onPullDownRefresh } from '@dcloudio/uni-app'
import PageReturn from '@/components/base/PageReturn.vue'
import RequestState from '@/components/base/RequestState.vue'
import ListMore from '@/components/base/ListMore.vue'
import { api, ApiError, errorMessage } from '@/services/api'
import type { CommunityRosterMember } from '@/services/api/types'
import { mediaUrl } from '@/services/api/environment'
import { requireProfile, routes } from '@/services/navigation'
import { useSessionStore } from '@/stores/session'

const session = useSessionStore()
const items = ref<CommunityRosterMember[]>([])
const total = ref(0), hasMore = ref(false), ready = ref(false)
const loading = ref(false), loadingMore = ref(false), busyId = ref('')
const error = ref(''), moreError = ref(''), denied = ref(false)
let offset = 0, generation = 0, visible = false

function clear() {
  generation++
  items.value = []; offset = 0; total.value = 0; hasMore.value = false
  ready.value = false; loading.value = false; loadingMore.value = false
  busyId.value = ''; error.value = ''; moreError.value = ''; denied.value = false
}
function handleDenied(e: unknown) {
  if (!(e instanceof ApiError) || e.status !== 403) return false
  clear()
  denied.value = true
  return true
}
async function load(append = false) {
  if (append && (!hasMore.value || loading.value || loadingMore.value || busyId.value)) return
  if (append) { loadingMore.value = true; moreError.value = '' }
  else { clear(); loading.value = true }
  const current = generation
  try {
    if (!append && !await requireProfile(routes.communityMembers)) return
    if (!visible || current !== generation) return
    const page = await api.communityMembers(offset)
    if (!visible || current !== generation) return
    const known = new Set(items.value.map(row => row.memberId))
    items.value.push(...page.items.filter(row => !known.has(row.memberId)))
    offset += page.items.length
    total.value = page.total; hasMore.value = page.items.length > 0 && offset < page.total; ready.value = true
  } catch (e) {
    if (visible && current === generation && !handleDenied(e)) {
      if (append) moreError.value = errorMessage(e)
      else error.value = errorMessage(e)
    }
  } finally {
    if (current === generation) { loading.value = false; loadingMore.value = false }
    if (!append) uni.stopPullDownRefresh()
  }
}
async function change(row: CommunityRosterMember) {
  if (busyId.value) return
  const current = generation, next = !row.isRegistered
  busyId.value = row.memberId
  try {
    const result = await uni.showModal({
      title: next ? '认定在册会员' : '取消在册身份',
      content: `确认将「${row.displayName || row.userNumber}」${next ? '认定为学加社群在册会员' : '改为学加社群非会用户'}？`,
      confirmText: next ? '确认认定' : '确认取消',
    })
    if (!result.confirm || !visible || current !== generation) return
    const updated = await api.setCommunityMembership(row.memberId, next)
    if (!visible || current !== generation) return
    const index = items.value.findIndex(item => item.memberId === updated.memberId)
    if (index >= 0) items.value[index] = updated
    uni.showToast({ title: next ? '已认定为在册会员' : '已取消在册身份', icon: 'none' })
  } catch (e) {
    if (visible && current === generation && !handleDenied(e)) uni.showToast({ title: errorMessage(e), icon: 'none' })
  } finally { if (current === generation) busyId.value = '' }
}
watch(() => [session.token, session.epoch], () => {
  clear()
  if (visible && session.token) void load()
  else if (visible) error.value = '登录已失效，请重新登录'
}, { flush: 'sync' })
onShow(() => { visible = true; void load() })
onHide(() => { visible = false; clear() })
onUnload(() => { visible = false; clear() })
onPullDownRefresh(() => {
  if (busyId.value) uni.stopPullDownRefresh()
  else void load()
})
onReachBottom(() => { if (!moreError.value) void load(true) })
</script>

<template>
  <view class="page-pad roster-page">
    <PageReturn />
    <view v-if="denied" class="empty">仅学加社群管理员可管理成员</view>
    <RequestState v-else :loading="loading" :error="error" @retry="load()" />
    <template v-if="ready">
      <view class="heading"><text>学加社群</text><text class="count">{{ total }} 位用户</text></view>
      <view class="card roster">
        <view v-if="!items.length" class="empty">暂无社群成员</view>
        <view v-for="row in items" :key="row.memberId" class="person">
          <image v-if="row.avatarUrl" class="avatar" :src="mediaUrl(row.avatarUrl)" mode="aspectFill" />
          <view v-else class="avatar fallback"><uni-icons type="person-filled" size="40rpx" color="#6b8779" /></view>
          <view class="identity">
            <view class="name">{{ row.displayName || '未设置名称' }}</view>
            <view class="number">{{ row.userNumber }}</view>
            <text class="status" :class="{ registered: row.isRegistered }">{{ row.isRegistered ? '在册会员' : '非会用户' }}</text>
          </view>
          <button class="action" :class="{ revoke: row.isRegistered }" :disabled="!!busyId" @click="change(row)">
            {{ row.isRegistered ? '取消认定' : '认定会员' }}
          </button>
        </view>
      </view>
      <ListMore :loading="loadingMore" :error="moreError" :has-more="hasMore" :has-items="items.length > 0" @retry="load(true)" />
    </template>
  </view>
</template>

<style scoped>
.roster-page { padding-bottom: calc(48rpx + env(safe-area-inset-bottom)); }
.heading { display: flex; align-items: baseline; justify-content: space-between; padding: 10rpx 4rpx 20rpx; font-size: 34rpx; font-weight: 600; }
.count, .number { color: #66746e; font-size: 24rpx; font-weight: 400; }
.roster { padding: 0 24rpx; }
.person { display: flex; gap: 18rpx; align-items: center; padding: 24rpx 0; }
.person + .person { border-top: 1rpx solid #e3ebe7; }
.avatar { flex: none; width: 76rpx; height: 76rpx; border-radius: 50%; }
.fallback { display: flex; align-items: center; justify-content: center; background: #edf4f0; }
.identity { flex: 1; min-width: 0; }
.name { font-size: 30rpx; font-weight: 600; overflow-wrap: anywhere; }
.number { margin: 4rpx 0; }
.status { font-size: 23rpx; color: #66746e; }
.registered { color: #175c44; }
.action { flex: none; min-height: 88rpx; margin: 0; padding: 0 22rpx; font-size: 25rpx; line-height: 88rpx; color: #175c44; background: #e8f3ed; }
.revoke { color: #75604e; background: #f6f1eb; }
</style>
