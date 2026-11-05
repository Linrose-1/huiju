<script setup lang="ts">
import PageReturn from '@/components/base/PageReturn.vue'
import { ref, watch } from 'vue'
import { onLoad, onShow, onHide, onUnload, onReachBottom, onPullDownRefresh } from '@dcloudio/uni-app'
import { api, errorMessage } from '@/services/api'
import type { PublicMember } from '@/services/api/types'
import { mediaUrl } from '@/services/api/environment'
import { navigate, routes, requireProfile } from '@/services/navigation'
import { useSessionStore } from '@/stores/session'
import RequestState from '@/components/base/RequestState.vue'
import ListMore from '@/components/base/ListMore.vue'
const id = ref(''), kind = ref<'roster' | 'readers'>('roster'), people = ref<(PublicMember & { publicAnswers?: { questionId: string; prompt: string; value: string | string[] }[] })[]>([])
const loading = ref(false), moreLoading = ref(false), error = ref(''), moreError = ref(''), hasMore = ref(false)
const session = useSessionStore()
let generation = 0, offset = 0, visible = false, opening = false
async function load(more = false, background = false) {
  const targetCount = background === true ? offset : 0, retain = targetCount > 0
  if (more && (loading.value || moreLoading.value || !hasMore.value || moreError.value)) return
  if (!more) { generation++; if (!retain) { offset = 0; people.value = []; hasMore.value = false }; error.value = ''; moreError.value = ''; moreLoading.value = false }
  const current = generation, epoch = session.epoch, token = session.token
  const active = () => visible && current === generation && epoch === session.epoch && token === session.token
  if (!id.value) { error.value = '活动链接不完整'; uni.stopPullDownRefresh(); return }
  if (more || retain) moreLoading.value = true; else loading.value = true
  try {
    let result = kind.value === 'readers' ? await api.activityReaders(id.value, more ? offset : 0) : await api.roster(id.value, { offset: more ? offset : 0 })
    const nextItems = [...result.items]
    while (active() && result.hasMore && result.items.length && nextItems.length < targetCount) {
      result = kind.value === 'readers' ? await api.activityReaders(id.value, nextItems.length) : await api.roster(id.value, { offset: nextItems.length })
      nextItems.push(...result.items)
    }
    if (!active()) return
    if (!more) { offset = 0; people.value = [] }
    offset += nextItems.length
    const known = new Set(people.value.map(person => person.memberId))
    const items: typeof people.value = nextItems
    people.value.push(...items.filter(person => !known.has(person.memberId)))
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
onShow(() => { visible = true; void load(false, true) })
onHide(() => { visible = false; generation++; loading.value = false; moreLoading.value = false; for (const person of people.value) person.publicAnswers = [] })
const stop = watch(() => [session.token, session.epoch], () => { generation++; people.value = []; if (visible) void load() })
onUnload(() => { visible = false; generation++; stop() })
onReachBottom(() => { void load(true) })
onPullDownRefresh(() => { void load() })
</script>
<template>
  <view class="people-page">
    <PageReturn />
    <RequestState
      :loading="loading"
      :error="error"
      @retry="load()"
    />
    <template v-if="people.length || (!loading && !error)">
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
          <view class="person-name">
            {{ person.displayName || '有聚点会员' }}<template v-if="kind === 'roster'">
              <view
                v-for="answer in person.publicAnswers || []"
                :key="answer.questionId"
                class="public-answer"
              >
                <text v-if="Array.isArray(answer.value) ? answer.value.some(value => value.trim()) : answer.value.trim()">{{ answer.prompt }}：{{ Array.isArray(answer.value) ? answer.value.filter(value => value.trim()).join('、') : answer.value }}</text>
              </view>
            </template>
          </view>
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
.public-answer{font-size:24rpx;color:#718b94;line-height:1.6;white-space:pre-wrap;overflow-wrap:anywhere}
.people-page{min-height:100vh;padding:24rpx 24rpx calc(24rpx + env(safe-area-inset-bottom));background:#f1f8f5}.people-list{background:#fff;border-radius:20rpx;padding:0 24rpx}.person{display:flex;align-items:center;gap:20rpx;width:100%;padding:24rpx 0;background:transparent;border-radius:0;text-align:left;border-bottom:1rpx solid #edf3ef}.person:last-child{border-bottom:0}.person-avatar{width:80rpx;height:80rpx;border-radius:50%;flex-shrink:0}.placeholder{display:flex;align-items:center;justify-content:center;background:#e8f2ed}.person-name{flex:1;min-width:0;font-size:30rpx;color:#16333c;overflow-wrap:anywhere}.empty{padding:80rpx 24rpx;text-align:center;font-size:28rpx;color:#718b94}
</style>
