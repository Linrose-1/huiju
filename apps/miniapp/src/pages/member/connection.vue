<script setup lang="ts">
import { ref, watch, computed } from 'vue'
import { onLoad, onShow, onHide, onUnload, onReachBottom, onPullDownRefresh } from '@dcloudio/uni-app'
import { api, ApiError, errorMessage } from '@/services/api'
import type { FellowSummary, ConnectionNode, ConnectionEdge } from '@/services/api/types'
import { navigate, routes, requireProfile, returnToMemberCard } from '@/services/navigation'
import { validateConnectionSegment } from '@/services/connection-path'
import { useSessionStore } from '@/stores/session'
import FellowPerson from '@/components/business/FellowPerson.vue'
import RequestState from '@/components/base/RequestState.vue'
const session = useSessionStore(), id = ref('')
const source = ref<FellowSummary | null>(null), target = ref<FellowSummary | null>(null)
const nodes = ref<ConnectionNode[]>([]), edges = ref<ConnectionEdge[]>([]), total = ref(0), nextCursor = ref<number | null>(null)
const loading = ref(false), loadingMore = ref(false), error = ref(''), moreError = ref(''), ready = ref(false), connected = ref(false)
let generation = 0, visible = false
const complete = computed(() => ready.value && connected.value && nextCursor.value === null && nodes.value.length === total.value && !error.value && !moreError.value)
function currentRequest() { const g = generation, token = session.token, epoch = session.epoch; return () => visible && g === generation && token === session.token && epoch === session.epoch }
function clear() { generation++; source.value = null; target.value = null; nodes.value = []; edges.value = []; total.value = 0; nextCursor.value = null; loading.value = false; loadingMore.value = false; error.value = ''; moreError.value = ''; ready.value = false; connected.value = false }
function message(e: unknown) { return e instanceof ApiError && e.code === 'RELATIONSHIP_INCOMPLETE' ? '关系数据异常，暂时无法完整展示链路，请稍后重试。' : errorMessage(e) }
async function load() {
  clear(); loading.value = true; const g = generation
  try {
    if (!id.value) throw new Error('学友链接不完整，请返回名片重新进入')
    const allowed = await requireProfile(routes.connection+'?id='+encodeURIComponent(id.value))
    if (!visible || g !== generation) return
    if (!allowed) { error.value = '完善资料后可查看你与该学友的链路'; return }
    const current = currentRequest(), result = await api.connectionPath(id.value)
    if (!current()) return
    validateConnectionSegment(result,0)
    source.value = result.source; target.value = result.target; connected.value = result.connected
    nodes.value = result.nodes; edges.value = result.edges; total.value = result.totalNodes; nextCursor.value = result.nextCursor; ready.value = true
  } catch (e) { if (visible && g === generation) error.value = message(e) }
  finally { if (g === generation) { loading.value = false; uni.stopPullDownRefresh() } }
}
async function more() {
  if (!ready.value || !connected.value || loading.value || loadingMore.value || moreError.value || nextCursor.value === null) return
  const current = currentRequest(), cursor = nextCursor.value; loadingMore.value = true
  try {
    const result = await api.connectionPath(id.value,cursor)
    if (!current()) return
    validateConnectionSegment(result,cursor,total.value)
    nodes.value.push(...result.nodes); edges.value.push(...result.edges); nextCursor.value = result.nextCursor
  } catch (e) { if (current()) moreError.value = message(e) }
  finally { if (current()) loadingMore.value = false }
}
function retryMore() { moreError.value = ''; void more() }
function open(person: FellowSummary) { if (person.canOpenCard && person.memberId) navigate(routes.memberCard+'?id='+encodeURIComponent(person.memberId)) }
function edgeText(index: number) {
  const edge = edges.value.find(item => Math.max(item.fromIndex,item.toIndex) === index)
  if (!edge) return ''
  const from = nodes.value.find(node => node.index === edge.fromIndex)?.member.displayName || '学友'
  const to = nodes.value.find(node => node.index === edge.toIndex)?.member.displayName || '学友'
  return `${edge.fromIndex < edge.toIndex ? '↓' : '↑'} ${from}邀请了${to}`
}
function subtitle(index: number) { return index === 0 ? '起点 · 我' : index === total.value-1 ? '目标学友' : '中间连接人' }
function returnToCard() {
  returnToMemberCard(id.value)
}
const stop = watch(() => [session.token,session.epoch], () => { clear(); if (visible) void load() }, {flush:'sync'})
onLoad(options => { id.value = String(options?.id || '') })
onShow(() => { visible = true; void load() })
onHide(() => { visible = false; clear() })
onUnload(() => { visible = false; clear(); stop() })
onReachBottom(more)
onPullDownRefresh(load)
</script>
<template>
  <view class="page-pad connection-page">
    <view
      v-if="source && target"
      class="connection-summary"
    >
      <view class="small muted">我与学友的连接</view>
      <view class="connection-endpoints"><text class="endpoint">{{ source.displayName }}（我）</text><text class="endpoint-separator">与</text><text class="endpoint">{{ target.displayName }}</text></view>
      <view
        v-if="connected"
        class="small muted"
      >
        共 {{ total }} 位学友 · {{ Math.max(0,total-1) }} 段邀请关系
      </view>
    </view>
    <RequestState
      :loading="loading"
      :error="error"
      @retry="load"
    />
    <template v-if="ready && !loading && !error">
      <view
        v-if="!connected"
        class="card no-connection"
      >
        暂未找到你们之间的学友邀请链路<view class="small muted no-connection-copy">这里只展示平台内的邀请关系，不代表现实中的关系。</view>
      </view>
      <template v-else>
        <view class="card path-card">
          <view
            v-for="node in nodes"
            :key="node.index"
            class="path-node"
          >
            <view
              v-if="node.index > 0"
              class="invitation-edge"
            >
              {{ edgeText(node.index) }}
            </view>
            <FellowPerson
              :name="node.member.displayName"
              :avatar-url="node.member.avatarUrl"
              :clickable="node.member.canOpenCard"
              :subtitle="subtitle(node.index)"
              @open="open(node.member)"
            />
          </view>
          <view class="path-progress">已显示 {{ nodes.length }} / {{ total }} 位</view>
          <view
            v-if="complete"
            class="path-complete"
          >
            完整链路已展示
          </view>
          <view
            v-else-if="moreError"
            class="path-error"
          >
            <view class="error">{{ moreError }}</view><button
              class="text-button"
              @click="retryMore"
            >
              重试加载后续链路
            </button>
          </view>
          <view
            v-else-if="loadingMore"
            class="path-progress"
          >
            正在加载后续链路…
          </view>
          <button
            v-else-if="nextCursor !== null"
            class="text-button"
            @click="more"
          >
            继续加载
          </button>
        </view>
        <view class="notice">上下顺序表示查看路径，箭头和文字表示实际邀请方向。连接路径不改变邀请关系，中间人的联系方式不会因此公开。</view>
      </template>
    </template>
    <view class="fixed-footer">
      <button
        class="secondary return-card"
        @click="returnToCard"
      >
        返回学友名片
      </button>
    </view>
  </view>
</template>
<style scoped>
.connection-page{min-height:100vh;background:#f3f8f5;padding-bottom:calc(150rpx + env(safe-area-inset-bottom))}.connection-summary{position:sticky;top:0;z-index:2;background:#fff;border:1rpx solid #e7efea;border-radius:18rpx;padding:24rpx 28rpx;margin-bottom:24rpx;box-shadow:0 6rpx 18rpx #173b2b08}.connection-endpoints{display:flex;align-items:center;gap:18rpx;margin:12rpx 0;font-size:30rpx;font-weight:600}.endpoint{min-width:0;overflow-wrap:anywhere;flex:1}.endpoint-separator{color:#82958a;font-size:24rpx;font-weight:400;flex:none}.path-card{padding:8rpx 28rpx 24rpx}.invitation-edge{margin-left:41rpx;border-left:2rpx solid #bfd7c9;padding:20rpx 0 20rpx 58rpx;font-size:24rpx;color:#748a7c;line-height:1.7;overflow-wrap:anywhere}.path-progress,.path-complete{font-size:25rpx;text-align:center;line-height:1.7;margin:20rpx 0 8rpx;color:#819387}.path-complete{color:#267a51}.no-connection{font-size:29rpx;line-height:1.8;text-align:center;padding:48rpx 30rpx}.no-connection-copy{margin-top:16rpx}.return-card{width:100%;font-size:28rpx;min-height:80rpx}.path-error{text-align:center}
</style>
