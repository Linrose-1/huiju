<script setup lang="ts">
import { computed, ref } from 'vue'
import { onShow, onPullDownRefresh, onLoad, onUnload } from '@dcloudio/uni-app'
import { api, errorMessage } from '@/services/api'
import type { Activity } from '@/services/api/types'
import { mediaUrl } from '@/services/api/environment'
import { activityTimeRangeCn, upcomingActivities } from '@/services/presentation'
import { navigate, routes, unavailable } from '@/services/navigation'
import { useSessionStore } from '@/stores/session'
import { scanActivityCode } from '@/services/wechat'
import { activityCodeTarget } from '@/services/activity-code'
import RequestState from '@/components/base/RequestState.vue'
const items = ref<Activity[]>([]), loading = ref(false), error = ref(''), search = ref(''), tab = ref('最新')
let generation = 0
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
onUnload(() => { disposed = true; generation++ })
const filtered = computed(() => {
    const list = items.value.filter(item => `${item.title} ${item.description} ${item.location}`.includes(search.value.trim()))
    return tab.value === '即将开始' ? upcomingActivities(list) : list
})
async function load() {
    const current = ++generation
    loading.value = true
    error.value = ''
    try {
        const result = await api.activities()
        if (current === generation)
            items.value = result.items
    }
    catch (e) {
        if (current === generation)
            error.value = errorMessage(e)
    }
    finally {
        if (current === generation)
            loading.value = false
        uni.stopPullDownRefresh()
    }
}
function chooseTab(value: string) { if (value === '推荐') {
    unavailable('智能推荐暂未开放')
    return
} tab.value = value; }
onLoad(options => { if (options?.inviteCode)
    useSessionStore().pendingInvite = String(options.inviteCode).slice(0, 32); })
onShow(load)
onPullDownRefresh(load)
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
          <uni-icons
            type="plus-filled"
            size="19"
            color="white"
          /> 发起活动
        </button>
      </view>
      <RequestState
        :loading="loading"
        :error="error"
        :empty="!filtered.length"
        :empty-text="search?'没有找到匹配的活动':'暂无公开活动，稍后再来看看'"
        @retry="load"
      />
      <view v-if="!loading && !error">
        <view
          v-for="(activity,index) in filtered"
          :key="activity.id"
          class="activity-card"
          :class="{featured:index===0}"
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
            </view><view
              v-if="index===0"
              class="cover-fade"
            /><text
              v-else
              class="tag cover-tag"
              :class="{paid:activity.feeType==='paid'}"
            >
              {{ activity.feeType==='paid'?'收费':'免费' }}
            </text>
          </view>
          <view class="activity-content">
            <text
              v-if="index===0"
              class="tag"
              :class="{paid:activity.feeType==='paid'}"
            >
              {{ activity.feeType==='paid'?'收费':'免费' }}
            </text><view class="activity-title serif">{{ activity.title }}</view><view class="description">{{ activity.description }}</view><view class="meta">
              <uni-icons
                type="calendar"
                size="18"
                color="#687181"
              /><text>{{ activityTimeRangeCn(activity.startsAt, activity.endsAt) }}</text>
            </view><view class="meta">
              <uni-icons
                type="location"
                size="18"
                color="#687181"
              /><text>{{ activity.location }}</text>
            </view><view class="row between card-bottom">
              <text class="small muted">{{ activity.activeRegistrationCount }} 人已报名</text><button
                v-if="index===0"
                class="primary view-button"
              >
                查看活动 <uni-icons
                  type="arrow-right"
                  size="20"
                  color="white"
                />
              </button>
            </view>
          </view>
        </view>
      </view>
    </view>
  </view>
</template>
<style scoped>.search{background:#f2f4f2;border-radius:12rpx;padding:0 22rpx;height:64rpx}.search input{font-size:28rpx}.tabs{margin:26rpx 6rpx 22rpx;gap:12rpx}.tab-group{gap:32rpx}.tab{position:relative;font-size:25rpx;padding:16rpx 0;color:#535654;white-space:nowrap}.tab.selected{font-weight:600;color:#10533c}.tab.selected::after{content:'';position:absolute;height:4rpx;width:34rpx;background:#166145;bottom:0;left:50%;transform:translateX(-50%);border-radius:5rpx}.create{font-size:23rpx!important;padding:13rpx 19rpx!important;white-space:nowrap}.activity-card{border:1rpx solid #e8e9e5;background:#fff;border-radius:20rpx;padding:18rpx;display:flex;gap:20rpx;margin-bottom:18rpx;position:relative;overflow:hidden}.cover-wrap{position:relative;flex-shrink:0}.cover{width:210rpx;height:235rpx;border-radius:14rpx}.cover-tag{position:absolute;top:12rpx;left:12rpx;z-index:2;font-size:20rpx;padding:3rpx 10rpx}.no-cover{background:#edf1ed;display:flex;align-items:center;justify-content:center;color:#98a39b;font-size:24rpx}.activity-content{position:relative;flex:1;min-width:0}.activity-title{font-size:29rpx;line-height:1.4;color:#131c17;margin:9rpx 0}.description{color:#848987;font-size:23rpx;line-height:1.55;overflow:hidden;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical}.card-bottom{margin-top:20rpx}.view-button{font-size:23rpx!important;padding:14rpx 30rpx!important}.activity-card:not(.featured) .meta{font-size:21rpx;margin-top:7rpx}.featured{min-height:350rpx;padding:24rpx}.featured .cover-wrap{position:absolute;inset:0}.featured .cover{width:100%;height:100%;border-radius:0}.cover-fade{position:absolute;inset:0;background:linear-gradient(90deg,#fffdfbff 15%,#fffdfbe6 53%,#ffffff15),linear-gradient(0deg,#fffdfb 2%,transparent 55%)}.featured .activity-title{font-size:37rpx;margin:22rpx 0 12rpx}.featured .description{max-width:470rpx}.featured .meta{max-width:520rpx}.search .scan-button{display:flex;align-items:center;justify-content:center;gap:8rpx;flex-shrink:0;height:64rpx;min-width:112rpx;padding:0 0 0 14rpx;margin-left:6rpx;border-radius:0;border-left:1rpx solid #dce6df;background:transparent;color:#24684f;font-size:26rpx;line-height:64rpx}</style>
