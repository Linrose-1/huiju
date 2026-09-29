<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { onLoad, onShow, onHide, onUnload } from '@dcloudio/uni-app'
import { api, errorMessage } from '@/services/api'
import type { Activity, Comment, Review, FeedbackContext, ReviewStats } from '@/services/api/types'
import { mediaUrl } from '@/services/api/environment'
import { dateTime, activityTimeRangeWeekday } from '@/services/presentation'
import { routes, loginPage } from '@/services/navigation'
import { useSessionStore } from '@/stores/session'
import RequestState from '@/components/base/RequestState.vue'
const session = useSessionStore()
const id = ref(''), activity = ref<Activity | null>(null), context = ref<FeedbackContext | null>(null), stats = ref<ReviewStats | null>(null)
const tab = ref<'comment' | 'review'>('comment'), mine = ref(false), items = ref<(Comment | Review)[]>([])
const commentCount = ref(0), reviewCount = ref(0), hasMore = ref(false), loading = ref(false), loadingMore = ref(false)
const error = ref(''), listError = ref(''), actionError = ref(''), busy = ref(false), editor = ref(false), content = ref(''), score = ref(5), editId = ref(''), kind = ref<'comment' | 'review'>('comment')
const own = (item: Comment) => !!session.member && item.member.memberId === session.member.id
const isReview = (item: Comment | Review): item is Review => 'score' in item && typeof item.score === 'number'
const statsError = ref(''), statsLoading = ref(false)
const ownReview = computed(() => context.value?.myReview || null)
const separateReview = computed(() => ownReview.value && !items.value.some(item => item.id === ownReview.value?.id))
let offset = 0
let generation = 0, visible = false
function currentRequest() {
    const current = generation, token = session.token, epoch = session.epoch
    return () => current === generation && token === session.token && epoch === session.epoch
}
function clear() {
    generation++; offset = 0; activity.value = null; context.value = null; stats.value = null; items.value = []
    loading.value = false; loadingMore.value = false; busy.value = false; editor.value = false
    content.value = ''; editId.value = ''; error.value = ''; listError.value = ''; actionError.value = ''; hasMore.value = false
    commentCount.value = 0; reviewCount.value = 0
    statsError.value = ''; statsLoading.value = false
}
async function load() {
    clear()
    if (!id.value) { error.value = '活动链接不完整'; return }
    const active = currentRequest(); loading.value = true
    try {
        const [nextActivity, nextContext, comments, reviews] = await Promise.all([
            api.activity(id.value), api.feedbackContext(id.value), api.feedbackComments(id.value, 0, mine.value), api.feedbackReviews(id.value)
        ])
        if (!active()) return
        activity.value = nextActivity; context.value = nextContext
        commentCount.value = comments.total; reviewCount.value = reviews.total
        const list = tab.value === 'comment' ? comments : reviews
        items.value = list.items; offset = list.items.length; hasMore.value = list.hasMore
        if (nextContext.isOrganizer) void loadStats()
    } catch (e) { if (active()) error.value = errorMessage(e) }
    finally { if (active()) loading.value = false }
}
async function loadStats() {
    if (!context.value?.isOrganizer || statsLoading.value) return
    const active = currentRequest(); statsLoading.value = true; statsError.value = ''
    try { const result = await api.reviewStats(id.value); if (active()) stats.value = result }
    catch (e) { if (active()) statsError.value = errorMessage(e) }
    finally { if (active()) statsLoading.value = false }
}
async function more() {
    if (loading.value || loadingMore.value || !hasMore.value) return
    const active = currentRequest(), selected = tab.value; loadingMore.value = true; listError.value = ''
    try {
        const result = selected === 'comment' ? await api.feedbackComments(id.value, offset, mine.value) : await api.feedbackReviews(id.value, offset)
        if (!active()) return
        offset += result.items.length
        const known = new Set(items.value.map(item => item.id))
        items.value.push(...result.items.filter(item => !known.has(item.id))); hasMore.value = result.hasMore
    } catch (e) { if (active()) listError.value = errorMessage(e) }
    finally { if (active()) loadingMore.value = false }
}
function selectTab(value: 'comment' | 'review') { if (tab.value !== value && !busy.value) { tab.value = value; void load() } }
function toggleMine() { if (!busy.value) { mine.value = !mine.value; void load() } }
function openEditor(value: 'comment' | 'review', item?: Comment | Review) {
    if (busy.value || loading.value || !context.value) return
    if (!session.token || !session.member?.profileComplete) { loginPage(routes.feedback + '?id=' + id.value); return }
    const target = item || (value === 'review' ? ownReview.value : null)
    if (target && !own(target)) return
    if (!target && !(value === 'comment' ? context.value.canComment : context.value.canReview)) {
        actionError.value = (value === 'comment' ? context.value.commentReason : context.value.reviewReason) || '暂时不能提交'; return
    }
    kind.value = value; editId.value = target?.id || ''; content.value = target?.content || ''; score.value = target && isReview(target) ? target.score : 5
    actionError.value = ''; editor.value = true
}
function closeEditor() { if (!busy.value) { editor.value = false; content.value = ''; editId.value = ''; actionError.value = '' } }
async function submit() {
    if (busy.value || !editor.value) return
    const text = content.value.trim()
    if (!text || text.length > 2000) { actionError.value = '请填写 1–2000 字的内容'; return }
    if (kind.value === 'review' && (!Number.isInteger(score.value) || score.value < 1 || score.value > 5)) { actionError.value = '请选择 1–5 分'; return }
    const active = currentRequest(); busy.value = true; actionError.value = ''
    try {
        if (kind.value === 'comment') {
            if (editId.value) await api.editComment(editId.value, text)
            else await api.createComment(id.value, text)
        } else if (editId.value) await api.editReview(editId.value, text, score.value)
        else await api.createReview(id.value, text, score.value)
        if (active()) { tab.value = kind.value; await load() }
    } catch (e) { if (active()) actionError.value = errorMessage(e) }
    finally { if (active()) busy.value = false }
}
async function remove(item: Comment | Review, value: 'comment' | 'review') {
    if (busy.value || !own(item)) return
    const active = currentRequest(), targetId = item.id; busy.value = true; actionError.value = ''
    try {
        const result = await uni.showModal({ title: value === 'comment' ? '删除评论' : '删除点评', content: '删除后无法恢复，确定删除吗？', confirmText: '删除', confirmColor: '#b74737' })
        if (!active() || !result.confirm) return
        if (value === 'comment') await api.deleteComment(targetId)
        else await api.deleteReview(targetId)
        if (active()) await load()
    } catch (e) { if (active()) actionError.value = errorMessage(e) }
    finally { if (active()) busy.value = false }
}
const stop = watch(() => [session.token, session.epoch], () => { mine.value = false; clear(); if (visible) void load() }, { flush: 'sync' })
onLoad(options => { id.value = String(options?.id || '') })
onShow(() => { visible = true; void load() })
onHide(() => { visible = false; clear() })
onUnload(() => { visible = false; clear(); stop() })
</script>
<template>
  <view class="feedback-page">
    <RequestState
      :loading="loading"
      :error="error"
      @retry="load"
    />
    <template v-if="activity && !loading && !error">
      <view class="activity-card">
        <image
          v-if="activity.coverUrl"
          class="cover"
          :src="mediaUrl(activity.coverUrl)"
          mode="aspectFill"
        />
        <view
          v-else
          class="cover no-cover"
        >
          暂无封面
        </view>
        <view class="summary"><view class="activity-title">{{ activity.title }}</view><view class="meta">{{ activityTimeRangeWeekday(activity.startsAt,activity.endsAt) }}</view><view class="meta">{{ activity.location }}</view></view>
      </view>
      <view class="tabs">
        <button
          :class="{selected:tab==='comment'}"
          :disabled="busy"
          @click="selectTab('comment')"
        >
          评论（{{ commentCount }}）
        </button><button
          :class="{selected:tab==='review'}"
          :disabled="busy"
          @click="selectTab('review')"
        >
          活动点评（{{ reviewCount }}）
        </button>
      </view>
      <view
        v-if="tab==='comment' && session.token"
        class="filter"
      >
        <button
          :disabled="busy"
          @click="toggleMine"
        >
          {{ mine?'查看全部评论':'我的评论' }}
        </button><text v-if="mine">含本人被隐藏的内容</text>
      </view>
      <view
        v-if="tab==='review' && statsError"
        class="error-text"
      >
        评分汇总加载失败：{{ statsError }}<button
          class="more"
          :loading="statsLoading"
          :disabled="statsLoading"
          @click="loadStats"
        >
          重试评分汇总
        </button>
      </view>
      <view
        v-if="tab==='review' && stats"
        class="stats"
      >
        {{ stats.count }} 人点评 · 平均 {{ stats.averageScore===null?'暂无评分':stats.averageScore.toFixed(1)+' 分' }}<text class="stats-note">仅发起人可见</text>
      </view>
      <view
        v-if="tab==='review' && ownReview && separateReview"
        class="my-review"
      >
        <view class="item-name">我的点评 · {{ ownReview.score }} 分</view><view class="body">{{ ownReview.content }}</view><view
          v-if="ownReview.hidden"
          class="hidden-note"
        >
          此点评已被隐藏，仅自己可见
        </view>
        <view class="actions">
          <button
            :disabled="busy"
            @click="openEditor('review',ownReview)"
          >
            修改
          </button><button
            class="delete"
            :disabled="busy"
            @click="remove(ownReview,'review')"
          >
            删除
          </button>
        </view>
      </view>
      <view class="list">
        <view
          v-for="item in items"
          :key="item.id"
          class="feedback-item"
        >
          <image
            v-if="item.member.avatarUrl"
            class="avatar"
            :src="mediaUrl(item.member.avatarUrl)"
            mode="aspectFill"
          /><view
            v-else
            class="avatar avatar-empty"
          >
            {{ item.member.displayName.slice(0,1) }}
          </view>
          <view class="item-main">
            <view class="item-name">{{ own(item)?'我':item.member.displayName }}</view><view
              v-if="isReview(item)"
              class="score"
            >
              {{ '★'.repeat(item.score) }}{{ '☆'.repeat(5-item.score) }} <text>{{ item.score }} 分</text>
            </view><view class="body">{{ item.content }}</view><view
              v-if="item.hidden"
              class="hidden-note"
            >
              此内容已被隐藏，仅自己可见
            </view><view class="item-bottom">
              <text class="time">{{ dateTime(item.createdAt) }}</text><view
                v-if="own(item)"
                class="actions"
              >
                <button
                  :disabled="busy"
                  @click="openEditor(tab,item)"
                >
                  修改
                </button><button
                  class="delete"
                  :disabled="busy"
                  @click="remove(item,tab)"
                >
                  删除
                </button>
              </view>
            </view>
          </view>
        </view>
        <view
          v-if="!items.length"
          class="empty"
        >
          {{ tab==='comment'?(mine?'还没有发表过评论':'暂无评论，来聊聊这场活动吧'):'暂无活动点评' }}
        </view>
      </view>
      <view
        v-if="listError"
        class="error-text"
      >
        {{ listError }}
      </view><button
        v-if="hasMore"
        class="more"
        :loading="loadingMore"
        :disabled="loadingMore"
        @click="more"
      >
        {{ listError?'重试加载':'加载更多' }}
      </button>
      <view
        v-if="tab==='review' && context?.reviewReason && !ownReview"
        class="hint"
      >
        {{ context.reviewReason }}
      </view>
      <view
        v-if="actionError && !editor"
        class="error-text"
      >
        {{ actionError }}
      </view>
      <view class="footer">
        <button
          class="secondary"
          :disabled="busy"
          @click="openEditor('review')"
        >
          {{ ownReview?'修改我的点评':'写活动点评' }}
        </button><button
          class="publish"
          :disabled="busy"
          @click="openEditor('comment')"
        >
          发表评论
        </button>
      </view>
    </template>
    <view
      v-if="editor"
      class="overlay"
      @click="closeEditor"
    >
      <view
        class="sheet"
        @click.stop
      >
        <view class="sheet-heading">
          <text>{{ editId?'修改':'发表' }}{{ kind==='comment'?'评论':'活动点评' }}</text><button
            :disabled="busy"
            @click="closeEditor"
          >
            取消
          </button>
        </view>
        <view
          v-if="kind==='review'"
          class="score-picker"
        >
          <button
            v-for="value in 5"
            :key="value"
            :class="{chosen:score===value}"
            :disabled="busy"
            @click="score=value"
          >
            {{ value }} 分
          </button>
        </view>
        <textarea
          v-model="content"
          :disabled="busy"
          :maxlength="2000"
          :adjust-position="true"
          :cursor-spacing="100"
          :show-confirm-bar="false"
          placeholder="分享你的真实想法…"
          class="editor-input"
        />
        <view class="counter">{{ content.length }}/2000</view><view
          v-if="actionError"
          class="error-text"
        >
          {{ actionError }}
        </view><button
          class="publish submit"
          :loading="busy"
          :disabled="busy || !content.trim()"
          @click="submit"
        >
          {{ busy?'正在提交':'确认提交' }}
        </button>
      </view>
    </view>
  </view>
</template>
<style scoped>
.feedback-page{min-height:100vh;background:#f1f8f5;padding:24rpx 24rpx calc(160rpx + env(safe-area-inset-bottom));color:#172337;box-sizing:border-box}.activity-card{display:flex;gap:22rpx;background:#fff;padding:24rpx;border-radius:24rpx}.cover{width:192rpx;height:138rpx;flex-shrink:0;border-radius:12rpx}.no-cover,.avatar-empty{display:flex;align-items:center;justify-content:center;background:#eaf2ed;color:#719085;font-size:24rpx}.summary{min-width:0;flex:1}.activity-title{font-size:32rpx;font-weight:600;line-height:1.4;margin-bottom:12rpx;overflow-wrap:anywhere}.meta{color:#7b8695;font-size:24rpx;line-height:1.6;overflow-wrap:anywhere}.tabs{display:flex;margin-top:24rpx;border-bottom:1rpx solid #dfe8e2}.tabs button{flex:1;background:transparent;color:#475267;font-size:30rpx;height:88rpx;line-height:88rpx;border-radius:0}.tabs button.selected{color:#15845f;font-weight:600;border-bottom:5rpx solid #15845f}button::after{border:0}.list,.my-review{background:#fff;border-radius:24rpx;padding:0 24rpx;margin-top:22rpx}.feedback-item{display:flex;gap:22rpx;padding:30rpx 0;border-bottom:1rpx solid #edf0ee}.feedback-item:last-child{border:0}.avatar{width:80rpx;height:80rpx;border-radius:50%;flex-shrink:0}.item-main{flex:1;min-width:0}.item-name{font-size:30rpx;font-weight:600;line-height:1.5}.body{font-size:29rpx;line-height:1.7;white-space:pre-wrap;overflow-wrap:anywhere;margin:10rpx 0}.time{font-size:23rpx;color:#8b94a1}.item-bottom{display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:8rpx}.actions{display:flex;gap:14rpx}.actions button,.filter button{font-size:26rpx;background:transparent;color:#15845f;padding:0 8rpx;min-height:64rpx;line-height:64rpx}.actions .delete{color:#ba4c3f}.filter{display:flex;align-items:center;justify-content:space-between;font-size:23rpx;color:#8b94a1}.filter button{margin:0}.score{color:#dd9b35;font-size:30rpx;margin-top:10rpx}.score text{font-size:24rpx;margin-left:8rpx}.stats,.hint{font-size:26rpx;color:#68766e;padding:24rpx 8rpx;line-height:1.6}.stats-note{font-size:22rpx;margin-left:16rpx;color:#98a29d}.my-review{padding:24rpx}.hidden-note{font-size:24rpx;color:#a06a3f;line-height:1.6}.empty{padding:60rpx 16rpx;text-align:center;color:#87968d;font-size:27rpx}.more{background:transparent;color:#15845f;font-size:26rpx;margin-top:12rpx}.error-text{font-size:26rpx;line-height:1.6;color:#b54b39;padding:16rpx 0}.footer{position:fixed;bottom:0;left:0;right:0;display:flex;gap:18rpx;background:#fff;padding:20rpx 24rpx calc(20rpx + env(safe-area-inset-bottom))}.footer button{flex:1;min-width:0;font-size:29rpx;height:92rpx;line-height:92rpx;border-radius:22rpx;font-weight:600;padding:0}.secondary{background:#eaf5ef;color:#168560}.publish{background:linear-gradient(110deg,#13835e,#359e79);color:#fff;border-radius:20rpx;font-size:30rpx}.overlay{position:fixed;inset:0;z-index:20;background:#0006;display:flex;align-items:flex-end}.sheet{width:100%;box-sizing:border-box;background:#fff;border-radius:28rpx 28rpx 0 0;padding:24rpx 28rpx calc(24rpx + env(safe-area-inset-bottom));max-height:85vh;overflow-y:auto}.sheet-heading{display:flex;align-items:center;justify-content:space-between;font-size:32rpx;font-weight:600}.sheet-heading button{margin:0;background:transparent;color:#6d7f75;font-size:27rpx;line-height:72rpx}.score-picker{display:flex;gap:12rpx;margin:20rpx 0}.score-picker button{flex:1;padding:0;background:#f0f5f2;font-size:27rpx;line-height:72rpx}.score-picker .chosen{background:#d5eee0;color:#117a52}.editor-input{width:100%;box-sizing:border-box;background:#f5f8f6;border-radius:14rpx;padding:20rpx;font-size:29rpx;line-height:1.6;height:240rpx;margin-top:20rpx}.counter{text-align:right;font-size:23rpx;color:#8b968f;margin:12rpx 0 20rpx}.submit{line-height:84rpx}
</style>
