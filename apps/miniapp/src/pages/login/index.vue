<script setup lang="ts">
import { ref } from 'vue'
import { onLoad } from '@dcloudio/uni-app'
import { useSessionStore } from '@/stores/session'
import { api, errorMessage, refreshMember } from '@/services/api'
import { mediaUrl } from '@/services/api/environment'
import { loginWithWechat, uploadAvatar } from '@/services/wechat'
import { finishProfile } from '@/services/navigation'
const session = useSessionStore(), name = ref(''), invite = ref(''), returnTo = ref(''), busy = ref(false), error = ref('')
onLoad(async (options) => {
    returnTo.value = String(options?.returnTo || '')
    invite.value = session.pendingInvite
    name.value = session.member?.displayName || ''
    if (session.token) {
        try {
            await refreshMember()
            name.value = session.member?.displayName || ''
        }
        catch (e) {
            error.value = errorMessage(e)
        }
    }
})
async function perform(action: () => Promise<unknown>) { if (busy.value)
    return; busy.value = true; error.value = ''; try {
    await action()
}
catch (e) {
    error.value = errorMessage(e)
}
finally {
    busy.value = false
} }
async function submit() {
    await perform(async () => {
        if (!session.token) {
            session.pendingInvite = invite.value.trim()
            await loginWithWechat()
            name.value = session.member?.displayName || name.value
            if (session.member?.profileComplete)
                finishProfile(returnTo.value)
            return
        }
        if (!name.value.trim())
            throw new Error('请填写用户名称')
        await api.profile(name.value.trim())
        if (!session.member?.profileComplete)
            throw new Error('请完成头像选择和手机号授权后继续')
        finishProfile(returnTo.value)
    })
}
function legal(title: string) { uni.showModal({ title, content: '正式文本尚未配置，当前仅供本地开发验收。', showCancel: false }); }
function avatar(event: {
    detail: {
        avatarUrl?: string
    }
}) { const path = event.detail.avatarUrl; if (path)
    void perform(() => uploadAvatar(path)); }
function phone(event: {
    detail: {
        code?: string
        errMsg?: string
    }
}) { if (!event.detail.code) {
    error.value = '手机号授权未完成，请重试'
    return
} void perform(() => api.phone(event.detail.code!)); }
</script>
<template>
  <view class="login">
    <image
      class="campus"
      src="/static/huiju/campus.jpg"
      mode="aspectFill"
    /><view class="login-body">
      <view class="brand serif">会聚</view><view class="gold-line" /><view class="welcome">完善资料，加入会聚</view><view class="subtitle">认识更多伙伴，从一张真实的名片开始</view><view
        v-if="invite && !session.token"
        class="invitation"
      >
        已识别邀请来源，将由登录时确认
      </view>
      <view class="profile-form">
        <view class="form-row">
          <text>用户头像</text><view class="row">
            <view class="avatar">
              <image
                v-if="session.member?.avatarUrl"
                :src="mediaUrl(session.member.avatarUrl)"
                mode="aspectFill"
              /><uni-icons
                v-else
                type="person-filled"
                size="31"
                color="#bdc6c0"
              />
            </view><button
              v-if="session.token"
              class="field-button"
              open-type="chooseAvatar"
              :disabled="busy"
              @chooseavatar="avatar"
            >
              选择头像 <uni-icons
                type="arrow-right"
                size="17"
                color="#19553f"
              />
            </button><button
              v-else
              class="field-button"
              @click="submit"
            >
              先微信登录
            </button>
          </view>
        </view>
        <view class="form-row">
          <text>用户名称</text><input
            v-model="name"
            type="nickname"
            maxlength="100"
            class="name-input"
            placeholder="请输入用户名称"
            :disabled="busy"
          >
        </view>
        <view class="form-row">
          <text>用户手机号</text><text
            v-if="session.member?.boundPhone"
            class="phone"
          >
            {{ session.member.boundPhone }}
          </text><button
            v-else-if="session.token"
            class="field-button"
            open-type="getPhoneNumber"
            :disabled="busy"
            @getphonenumber="phone"
          >
            授权获取手机号 <uni-icons
              type="arrow-right"
              size="17"
              color="#19553f"
            />
          </button><button
            v-else
            class="field-button"
            @click="submit"
          >
            先微信登录
          </button>
        </view>
        <view class="form-row last">
          <text>邀请码</text><input
            v-model="invite"
            class="name-input"
            maxlength="32"
            :disabled="!!session.token || session.identifying || busy"
            :placeholder="session.token?'首次来源已固定':'请输入邀请码（选填）'"
          >
        </view>
      </view>
      <view
        v-if="error"
        class="error"
      >
        {{ error }}
      </view><button
        class="primary login-button"
        :loading="busy"
        :disabled="busy"
        @click="submit"
      >
        {{ session.token?'保存资料并继续':'微信登录' }}
      </button><view class="legal">登录与授权用于建立会员身份和报名联系。<text @click="legal('用户协议')">用户协议</text> · <text @click="legal('隐私政策')">隐私政策</text></view><button
        class="text-button"
        @click="finishProfile('')"
      >
        暂不登录，先看看活动
      </button>
    </view>
  </view>
</template>
<style scoped>.login{background:#fffdf9;min-height:100vh}.campus{width:100%;height:640rpx;display:block}.login-body{position:relative;margin-top:-38rpx;border-radius:50% 50% 0 0 / 45rpx 45rpx 0 0;padding:44rpx 34rpx 32rpx;background:linear-gradient(140deg,#fffdf9,#fff);text-align:center}.brand{font-size:112rpx;color:#005a42;line-height:1.15;letter-spacing:9rpx}.gold-line{width:62rpx;height:9rpx;background:linear-gradient(90deg,#e4c378,#cc943c);border-radius:8rpx;margin:24rpx auto}.welcome{font-size:43rpx;font-weight:600;color:#142e27}.subtitle{font-size:27rpx;color:#777b79;margin:14rpx 0 20rpx}.invitation{display:inline-block;color:#267158;background:#edf4ef;border-radius:50rpx;padding:10rpx 24rpx;font-size:23rpx;margin-bottom:14rpx}.profile-form{background:#fff;border-radius:22rpx;box-shadow:0 8rpx 35rpx #536d4b0d;padding:0 26rpx;text-align:left}.form-row{min-height:72rpx;border-bottom:1rpx solid #edf0ed;display:flex;align-items:center;justify-content:space-between;gap:18rpx;font-size:28rpx;padding:8rpx 0}.form-row.last{border:0}.form-row .avatar{width:60rpx;height:60rpx}.field-button{font-size:23rpx;padding:10rpx 18rpx;background:#edf5f0;color:#145940;white-space:nowrap}.name-input{background:#f5f5f5;width:390rpx;border-radius:12rpx;height:48rpx;font-size:23rpx;padding:6rpx 16rpx;max-width:65%}.phone{font-size:24rpx;color:#376d55}.login-button{margin:18rpx 0!important;font-size:30rpx!important;padding:23rpx!important;box-shadow:0 6rpx 16rpx #0c543426}.legal{font-size:21rpx;line-height:1.8;color:#91918d}.legal text{color:#1d6049}.error{margin-top:16rpx;text-align:left}</style>
