<script setup lang="ts">
import { ref, watch } from 'vue'
import { onLoad, onShow, onHide, onUnload, onReachBottom, onPullDownRefresh } from '@dcloudio/uni-app'
import { api, errorMessage } from '@/services/api'
import type { PublicMember } from '@/services/api/types'
import { mediaUrl } from '@/services/api/environment'
import { navigate, routes, requireProfile } from '@/services/navigation'
import { useSessionStore } from '@/stores/session'
import RequestState from '@/components/base/RequestState.vue'
import ListMore from '@/components/base/ListMore.vue'
const id = ref(''), kind = ref<'roster' | 'readers'>('roster'), people = ref<PublicMember[]>([])
const loading = ref(false), moreLoading = ref(false), error = ref(''), moreError = ref(''), hasMore = ref(false)
const session = useSessionStore()
let generation = 0, offset = 0, visible = false, opening = false
async function load(more = false) {
  if (more && (loading.value || moreLoading.value || !hasMore.value || moreError.value)) return
  if (!more) { generation++; offset = 0; people.value = []; hasMore.value = false; error.value = ''; moreError.value = ''; moreLoading.value = false }
  const current = generation, epoch = session.epoch, token = session.token
  const active = () => visible && current === generation && epoch === session.epoch && token === session.token
  if (!id.value) { error.value = '活动链接不完整'; uni.stopPullDownRefresh(); return }
  if (more) moreLoading.value = true; else loading.value = true
  try {
    const result = kind.value === 'readers' ? await api.activityReaders(id.value, offset) : await api.roster(id.value, { offset })
    if (!active()) return
    offset += result.items.length
    const known = new Set(people.value.map(person => person.memberId))
    people.value.push(...result.items.filter(person => !known.has(person.memberId)))
    hasMore.value = result.hasMore
  } catch (e) { if (active()) { if (more) moreError.value = errorMessage(e); else error.value = errorMessage(e) } }
  finally { if (active()) { loading.value = false; moreLoading.value = false; uni.stopPullDownRefresh() } }
}
function retryMore() { moreError.value = ''; void load(true) }
async function openMember(memberId: string) {
  if (opening || !memberId) return
  opening = true
  const current = generation, target = routes.memberCard + '?id=' + encodeURIComponent(memberId)
  try { if (await requireProfile(target) && visible && current === generation) navigate(target) }
  catch (e) { if (visible) uni.showToast({ title: errorMessage(e), icon: 'none' }) }
  finally { opening = false }
}
onLoad(options => {
  id.value = String(options?.id || '')
  kind.value = options?.kind === 'readers' ? 'readers' : 'roster'
  uni.setNavigationBarTitle({ title: kind.value === 'readers' ? '阅读留痕' : '报名名单' })
})
onShow(() => { visible = true; void load() })
onHide(() => { visible = false; generation++; loading.value = false; moreLoading.value = false })
const stop = watch(() => [session.token, session.epoch], () => { generation++; people.value = []; if (visible) void load() })
onUnload(() => { visible = false; generation++; stop() })
onReachBottom(() => { void load(true) })
onPullDownRefresh(() => { void load() })
</script>
<template>
  <view class="people-page">
    <RequestState
      :loading="loading"
      :error="error"
      @retry="load()"
    />
    <template v-if="!loading && !error">
      <view
        v-if="!people.length"
        class="empty"
      >
        {{ kind==='readers' ? '暂无会员阅读记录' : '还没有人报名' }}
      </view>
      <view
        v-else
        class="people-list"
      >
        <button
          v-for="person in people"
          :key="person.memberId"
          class="person"
          @click="openMember(person.memberId)"
        >
          <image
            v-if="person.avatarUrl"
            :src="mediaUrl(person.avatarUrl)"
            class="person-avatar"
            mode="aspectFill"
          />
          <view
            v-else
            class="person-avatar placeholder"
          >
            <uni-icons
              type="person-filled"
              size="40rpx"
              color="#82968a"
            />
          </view>
          <text class="person-name">{{ person.displayName || '有聚点会员' }}</text>
          <uni-icons
            type="arrow-right"
            size="28rpx"
            color="#82968a"
          />
        </button>
      </view>
      <ListMore
        :loading="moreLoading"
        :error="moreError"
        :has-more="hasMore"
        :has-items="!!people.length"
        @retry="retryMore"
      />
    </template>
  </view>
</template>
<style scoped>
.people-page{min-height:100vh;padding:24rpx 24rpx calc(24rpx + env(safe-area-inset-bottom));background:#f1f8f5}.people-list{background:#fff;border-radius:20rpx;padding:0 24rpx}.person{display:flex;align-items:center;gap:20rpx;width:100%;padding:24rpx 0;background:transparent;border-radius:0;text-align:left;border-bottom:1rpx solid #edf3ef}.person:last-child{border-bottom:0}.person-avatar{width:80rpx;height:80rpx;border-radius:50%;flex-shrink:0}.placeholder{display:flex;align-items:center;justify-content:center;background:#e8f2ed}.person-name{flex:1;min-width:0;font-size:30rpx;color:#16333c;overflow-wrap:anywhere}.empty{padding:80rpx 24rpx;text-align:center;font-size:28rpx;color:#718b94}
</style>
