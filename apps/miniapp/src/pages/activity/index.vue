<script setup lang="ts">
import { ref, watch } from 'vue'
import { onShow, onHide, onPullDownRefresh, onReachBottom, onLoad, onUnload } from '@dcloudio/uni-app'
import { api, errorMessage } from '@/services/api'
import type { Activity } from '@/services/api/types'
import { mediaUrl } from '@/services/api/environment'
import { activityTimeRangeWeekday, fee } from '@/services/presentation'
import { navigate, routes, unavailable } from '@/services/navigation'
import { useSessionStore } from '@/stores/session'
import { scanActivityCode } from '@/services/wechat'
import { activityCodeTarget } from '@/services/activity-code'
import RequestState from '@/components/base/RequestState.vue'
const items = ref<Activity[]>([]), loading = ref(false), loadingMore = ref(false), hasMore = ref(false)
const error = ref(''), moreError = ref(''), search = ref(''), tab = ref('最新')
let generation = 0, offset = 0, searchTimer: ReturnType<typeof globalThis.setTimeout> | undefined
const scanning = ref(false)
let disposed = false
async function scanActivity() {
    if (scanning.value || disposed) return
    scanning.value = true
    const session = useSessionStore(), epoch = session.epoch, token = session.token
    const current = () => !disposed && epoch === session.epoch && token === session.token
    try {
        const result = await scanActivityCode()
        if (!result || !current()) return
        const target = activityCodeTarget(result.path || '') || activityCodeTarget(result.result)
        if (!target) {
            uni.showModal({ title: '无法识别活动', content: '请扫描会聚活动二维码，该二维码不是支持的活动链接。', showCancel: false })
            return
        }
        navigate(routes.detail + '?id=' + encodeURIComponent(target.id) + (target.inviteCode ? '&inviteCode=' + encodeURIComponent(target.inviteCode) : ''))
    } catch (e) {
        if (current()) uni.showModal({ title: '扫码失败', content: errorMessage(e), showCancel: false })
    } finally { scanning.value = false }
}
onHide(() => { generation++; globalThis.clearTimeout(searchTimer) })
onUnload(() => { disposed = true; generation++; globalThis.clearTimeout(searchTimer) })
async function load() {
    const current = ++generation
    offset = 0
    items.value = []
    hasMore.value = false
    loading.value = true
    loadingMore.value = false
    error.value = ''
    moreError.value = ''
    try {
        const result = await api.activities({ sort: tab.value === '即将开始' ? 'upcoming' : 'latest', q: search.value.trim() })
        if (current === generation) {
            items.value = result.items
            offset = result.items.length
            hasMore.value = result.hasMore
        }
    }
    catch (e) {
        if (current === generation)
            error.value = errorMessage(e)
    }
    finally {
        if (current === generation)
            loading.value = false
        if (current === generation) uni.stopPullDownRefresh()
    }
}
async function more() {
    if (loading.value || loadingMore.value || !hasMore.value || moreError.value || disposed) return
    const current = generation
    loadingMore.value = true
    try {
        const result = await api.activities({ offset, sort: tab.value === '即将开始' ? 'upcoming' : 'latest', q: search.value.trim() })
        if (current !== generation) return
        offset += result.items.length
        const known = new Set(items.value.map(item => item.id))
        items.value.push(...result.items.filter(item => !known.has(item.id)))
        hasMore.value = result.hasMore
    } catch (e) { if (current === generation) moreError.value = errorMessage(e) }
    finally { if (current === generation) loadingMore.value = false }
}
function retryMore() { moreError.value = ''; void more() }
function chooseTab(value: string) { if (value === '推荐') {
    unavailable('智能推荐暂未开放')
    return
} if (tab.value !== value) { tab.value = value; globalThis.clearTimeout(searchTimer); void load() } }
watch(search, () => {
    globalThis.clearTimeout(searchTimer)
    generation++
    items.value = []
    hasMore.value = false
    loadingMore.value = false
    loading.value = true
    searchTimer = globalThis.setTimeout(() => { if (!disposed) void load() }, 300)
})
onLoad(options => { if (options?.inviteCode)
    useSessionStore().pendingInvite = String(options.inviteCode).slice(0, 32); })
onShow(load)
onPullDownRefresh(load)
onReachBottom(more)
</script>
<template>
  <view>
    <view class="hero">
      <image
        class="hero-image"
        src="/static/huiju/campus.jpg"
        mode="aspectFill"
      /><view class="hero-fade" /><view class="hero-copy serif">连接资产运营人才，<br>共建共享“学加”学友生态。</view>
    </view><view class="sheet">
      <view class="search row">
        <uni-icons
          type="search"
          size="22"
          color="#9aa39e"
        /><input
          v-model="search"
          class="grow"
          placeholder="搜索活动"
          confirm-type="search"
          maxlength="100"
        >
        <button
          class="scan-button"
          :disabled="scanning"
          :loading="scanning"
          @click="scanActivity"
        >
          <uni-icons
            v-if="!scanning"
            type="scan"
            size="36rpx"
            color="#24684f"
          />扫码
        </button>
      </view>
      <view class="tabs row between">
        <view class="row tab-group">
          <view
            v-for="name in ['推荐','最新','即将开始']"
            :key="name"
            class="tab"
            :class="{selected:tab===name}"
            @click="chooseTab(name)"
          >
            {{ name }}
          </view>
        </view><button
          class="primary create"
          @click="navigate(routes.editor)"
        >
          <view class="create-content">
            <view class="create-symbol">
              <view class="create-symbol-horizontal" /><view class="create-symbol-vertical" />
            </view><text class="create-text">发起活动</text>
          </view>
        </button>
      </view>
      <RequestState
        :loading="loading"
        :error="error"
        :empty="!items.length"
        :empty-text="search?'没有找到匹配的活动':'暂无公开活动，稍后再来看看'"
        @retry="load"
      />
      <view v-if="!loading && !error">
        <view
          v-for="activity in items"
          :key="activity.id"
          class="activity-card"
          @click="navigate(routes.detail+'?id='+activity.id)"
        >
          <view class="cover-wrap">
            <image
              v-if="activity.coverUrl"
              :src="mediaUrl(activity.coverUrl)"
              class="cover"
              mode="aspectFill"
            /><view
              v-else
              class="cover no-cover"
            >
              暂无封面
            </view><text
              class="tag cover-tag"
              :class="{paid:activity.feeType==='paid'}"
            >
              {{ fee(activity) }}
            </text>
          </view>
          <view class="activity-content">
            <view class="activity-title serif">{{ activity.title }}</view><view class="description">{{ activity.description }}</view><view class="meta">
              <uni-icons
                type="calendar"
                size="28rpx"
                color="#687181"
              /><text class="meta-text">{{ activityTimeRangeWeekday(activity.startsAt, activity.endsAt) }}</text>
            </view><view class="meta">
              <uni-icons
                type="location"
                size="28rpx"
                color="#687181"
              /><text class="meta-text location-text">{{ activity.location }}</text>
            </view><view class="card-bottom">
              <view
                v-if="activity.registeredMembers?.length"
                class="avatar-stack"
              >
                <view
                  v-for="person in activity.registeredMembers || []"
                  :key="person.memberId"
                  class="member-avatar"
                >
                  <image
                    v-if="person.avatarUrl"
                    :src="mediaUrl(person.avatarUrl)"
                    mode="aspectFill"
                  />
                  <text v-else>{{ person.displayName?.slice(0, 1) || '友' }}</text>
                </view>
              </view><text class="registration-count">{{ activity.activeRegistrationCount ? activity.activeRegistrationCount+' 人已报名' : '暂无报名' }}</text>
            </view>
          </view>
        </view>
      </view>
      <view
        v-if="items.length"
        class="list-footer"
      >
        <view v-if="loadingMore">加载中…</view>
        <view
          v-else-if="moreError"
          class="load-error"
        >
          <text>{{ moreError }}</text><button
            class="text-button"
            @click="retryMore"
          >
            重试加载
          </button>
        </view>
        <view v-else-if="!hasMore && !loading">没有更多了</view>
      </view>
    </view>
  </view>
</template>

<style scoped>
.search{background:#f2f4f2;border-radius:12rpx;padding:0 22rpx;height:64rpx}.search input{font-size:28rpx}.tabs{margin:26rpx 6rpx 22rpx;gap:12rpx}.tab-group{gap:32rpx}.tab{position:relative;font-size:25rpx;padding:16rpx 0;color:#535654;white-space:nowrap}.tab.selected{font-weight:600;color:#10533c}.tab.selected::after{content:'';position:absolute;height:4rpx;width:34rpx;background:#166145;bottom:0;left:50%;transform:translateX(-50%);border-radius:5rpx}.create{font-size:23rpx!important;padding:13rpx 19rpx!important;white-space:nowrap}.create-content{display:flex;align-items:center;justify-content:center;gap:8rpx;height:34rpx}.create-symbol{position:relative;flex:none;width:34rpx;height:34rpx;border-radius:50%;background:#fff}.create-symbol-horizontal,.create-symbol-vertical{position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);background:#0b6847;border-radius:2rpx}.create-symbol-horizontal{width:17rpx;height:3rpx}.create-symbol-vertical{width:3rpx;height:17rpx}.create-text{display:block;height:34rpx;line-height:34rpx}.search .scan-button{display:flex;align-items:center;justify-content:center;gap:8rpx;flex-shrink:0;height:64rpx;min-width:112rpx;padding:0 0 0 14rpx;margin-left:6rpx;border-radius:0;border-left:1rpx solid #dce6df;background:transparent;color:#24684f;font-size:26rpx;line-height:64rpx}
.activity-card{padding:16rpx;border:1rpx solid #e8e9e5;background:#fff;border-radius:20rpx;display:flex;gap:20rpx;margin-bottom:18rpx;position:relative;overflow:hidden;box-shadow:0 8rpx 28rpx #153f2910}
.cover-wrap{position:relative;width:210rpx;flex:none}.cover{display:block;width:210rpx;height:100%;min-height:265rpx;border-radius:14rpx}.no-cover{background:linear-gradient(145deg,#c8dfd2,#eaf2e7);color:#416c55;font-size:27rpx;letter-spacing:2rpx;display:flex;align-items:center;justify-content:center}.cover-tag{position:absolute;top:12rpx;left:12rpx;z-index:2;font-size:22rpx;padding:5rpx 12rpx;box-shadow:0 3rpx 10rpx #0000001a}
.activity-content{display:flex;flex-direction:column;flex:1;min-width:0;padding:3rpx 0 2rpx}.activity-title{font-size:31rpx;line-height:1.36;color:#182b22;margin:0;overflow:hidden;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical}.description{color:#7b847e;font-size:24rpx;line-height:1.45;margin-top:8rpx;overflow:hidden;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical}.activity-card .meta{gap:7rpx;margin-top:9rpx;font-size:23rpx;line-height:1.35;align-items:flex-start}.meta-text{min-width:0;overflow:hidden;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical}.location-text{-webkit-line-clamp:1}
.card-bottom{display:flex;align-items:center;gap:10rpx;min-height:50rpx;margin-top:auto;padding-top:13rpx}.avatar-stack{display:flex;align-items:center;flex:none;padding-left:4rpx}.member-avatar{width:48rpx;height:48rpx;margin-left:-5rpx;border:3rpx solid #fff;border-radius:50%;overflow:hidden;background:#dcebe0;color:#286649;display:flex;align-items:center;justify-content:center;font-size:23rpx;box-shadow:0 1rpx 4rpx #183d271c}.member-avatar image{width:100%;height:100%}.registration-count{color:#557365;font-size:23rpx;white-space:nowrap}
.list-footer{padding:20rpx 0 34rpx;text-align:center;color:#829087;font-size:24rpx}.load-error{display:flex;align-items:center;justify-content:center;gap:10rpx;flex-wrap:wrap}.load-error .text-button{font-size:24rpx}
</style>
