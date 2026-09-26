<script setup lang="ts">
import { ref } from 'vue'
import { onShow } from '@dcloudio/uni-app'
import { useSessionStore } from '@/stores/session'
import { api, refreshMember, errorMessage } from '@/services/api'
import { mediaUrl } from '@/services/api/environment'
import { navigate, routes, loginPage, unavailable } from '@/services/navigation'
const session = useSessionStore(), count = ref<number | null>(null), error = ref(''), loading = ref(false)
async function load() { count.value = null; error.value = ''; if (!session.token)
    return; loading.value = true; try {
    await refreshMember()
    const result = await api.registrations()
    count.value = result.items.filter(item => item.status === 'active').length
}
catch (e) {
    error.value = errorMessage(e)
}
finally {
    loading.value = false
} }
function openRegistrations() { if (!session.token)
    loginPage(routes.registrations)
else
    navigate(routes.registrations); }
function invitation() { if (!session.member) {
    loginPage(routes.mine)
    return
} uni.showModal({ title: '我的邀请码', content: session.member.inviteCode, confirmText: '复制', success: result => { if (result.confirm)
        uni.setClipboardData({ data: session.member!.inviteCode }); } }); }
async function logout() { const result = await uni.showModal({ title: '退出登录', content: '下次报名需要重新登录，确认退出？' }); if (!result.confirm)
    return; try {
    await api.logout()
}
catch (e) {
    error.value = '本机已退出，远端会话撤销未确认：' + errorMessage(e)
}
finally {
    session.clear()
    count.value = null
} }
onShow(load)
</script>
<template>
  <view>
    <view class="mine-hero">
      <image
        class="hero-image"
        src="/static/huiju/campus.jpg"
        mode="aspectFill"
      /><view class="mine-fade" /><view class="identity row">
        <view class="avatar portrait">
          <image
            v-if="session.member?.avatarUrl"
            :src="mediaUrl(session.member.avatarUrl)"
            mode="aspectFill"
          /><uni-icons
            v-else
            type="person-filled"
            size="56"
            color="#a4b6ac"
          />
        </view><view class="grow">
          <view class="name serif">{{ session.member?.displayName || (session.token?'待完善资料':'未登录') }}</view><view class="member-number">{{ session.member?'会员编号 '+session.member.memberNumber:'登录后管理自己的活动' }}</view><view class="complete">
            <uni-icons
              :type="session.member?.profileComplete?'checkbox-filled':'info'"
              size="20"
              color="#296e52"
            /> {{ session.member?.profileComplete?'资料已完善':'完善资料，认识更多伙伴' }}
          </view>
        </view><button
          class="edit"
          @click="loginPage(routes.mine)"
        >
          {{ session.token?'编辑资料':'去登录' }} <uni-icons
            type="arrow-right"
            size="19"
            color="#275842"
          />
        </button>
      </view>
    </view>
    <view class="sheet mine-sheet">
      <view
        v-if="error"
        class="error"
      >
        {{ error }}<button
          class="text-button"
          @click="load"
        >
          重试
        </button>
      </view>
      <view class="namecard row">
        <view class="namecard-icon">
          <uni-icons
            type="contact-filled"
            size="54"
            color="#12573f"
          />
        </view><view class="grow"><view class="serif namecard-title">我的名片</view><view class="muted small">选择对同学展示的信息</view></view><button
          class="edit"
          @click="unavailable('名片设置暂未开放')"
        >
          设置名片 <uni-icons
            type="arrow-right"
            size="18"
            color="#275842"
          />
        </button>
      </view>
      <view class="activity-grid">
        <view
          class="tile"
          @click="openRegistrations"
        >
          <view class="row">
            <view class="tile-icon">
              <uni-icons
                type="calendar"
                size="35"
                color="#17553f"
              />
            </view><view class="grow"><view class="tile-title">我报名的</view><view class="muted"><text class="number">{{ loading?'…':count===null?'—':count }}</text> 个活动</view></view><uni-icons
              type="arrow-right"
              size="20"
            />
          </view><view class="muted small tile-desc">查看已报名的活动</view>
        </view><view
          class="tile"
          @click="unavailable('我发起的暂未开放')"
        >
          <view class="row">
            <view class="tile-icon">
              <uni-icons
                type="paperplane-filled"
                size="35"
                color="#17553f"
              />
            </view><view class="grow"><view class="tile-title">我发起的</view><view class="muted small">暂未开放</view></view><uni-icons
              type="arrow-right"
              size="20"
            />
          </view><view class="muted small tile-desc">查看我发起的活动</view>
        </view>
      </view>
      <view class="menu-card">
        <view
          class="menu-row row"
          @click="unavailable('站内通知暂未开放')"
        >
          <uni-icons
            type="notification"
            size="39"
            color="#17543d"
          /><view class="grow"><view class="tile-title">站内通知</view><view class="muted small">暂未开放</view></view><uni-icons
            type="arrow-right"
            size="20"
            color="#818791"
          />
        </view><view
          class="menu-row row"
          @click="invitation"
        >
          <uni-icons
            type="staff"
            size="39"
            color="#17543d"
          /><view class="grow"><view class="tile-title">我的邀请码</view><view class="muted small">邀请同学加入会聚</view></view><uni-icons
            type="arrow-right"
            size="20"
            color="#818791"
          />
        </view>
      </view><button
        v-if="session.token"
        class="text-button logout"
        @click="logout"
      >
        退出登录
      </button>
    </view>
  </view>
</template>
<style scoped>.mine-hero{position:relative;height:380rpx;overflow:hidden}.mine-fade{position:absolute;inset:0;background:linear-gradient(180deg,#ffffffec,#ffffffa8 30%,#ffffff05 80%)}.identity{position:relative;padding:42rpx 34rpx;gap:24rpx;align-items:flex-start}.portrait{width:136rpx;height:136rpx}.name{max-width:245rpx;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:39rpx;color:#154e39;margin:10rpx 0}.member-number{font-size:23rpx;color:#7a8090;margin-bottom:14rpx}.complete{font-size:22rpx;color:#27634d;display:flex;align-items:center;gap:7rpx}.edit{font-size:23rpx;background:#f7fcf9dc;color:#174e3d;border:1rpx solid #dbe6df;padding:13rpx 20rpx;white-space:nowrap}.identity .edit{position:absolute;right:30rpx;top:50rpx;font-size:21rpx;padding:12rpx}.identity .grow{padding-right:10rpx}.mine-sheet{margin-top:-12rpx;min-height:65vh}.namecard{padding:30rpx 20rpx;border:1rpx solid #e8e6df;border-radius:15rpx;background:#fcfbf8;margin-bottom:20rpx;gap:15rpx}.namecard-icon{width:145rpx;text-align:center}.namecard-title{font-size:37rpx;color:#164632;margin-bottom:10rpx}.activity-grid{display:grid;grid-template-columns:1fr 1fr;gap:14rpx;margin-bottom:22rpx}.tile{padding:25rpx 20rpx;border:1rpx solid #e8e9e6;border-radius:17rpx;background:#fff}.tile .row{gap:12rpx}.tile-icon{background:#e8f0eb;border-radius:23rpx;width:78rpx;height:86rpx;display:flex;align-items:center;justify-content:center;flex-shrink:0}.tile-title{font-size:27rpx;font-weight:600;margin-bottom:10rpx;color:#151d18}.number{font-size:42rpx;color:#1c7154}.tile-desc{margin-top:24rpx}.menu-card{background:#fff;border:1rpx solid #e8e9e6;border-radius:19rpx;padding:0 24rpx}.menu-row{padding:32rpx 12rpx;gap:30rpx;min-height:132rpx}.menu-row+.menu-row{border-top:1rpx solid #eaeeeb}.logout{margin:34rpx auto;font-size:23rpx}</style>
