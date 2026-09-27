<script setup lang="ts">
import { reactive, ref, watch } from 'vue'
import { onShow, onUnload } from '@dcloudio/uni-app'
import { api, refreshMember, errorMessage } from '@/services/api'
import type { ProfileDetailsInput } from '@/services/api/types'
import { mediaUrl } from '@/services/api/environment'
import { uploadAvatar } from '@/services/wechat'
import { navigate, loginPage, routes } from '@/services/navigation'
import { useSessionStore } from '@/stores/session'
import RequestState from '@/components/base/RequestState.vue'
const session = useSessionStore()
const emptyForm = (): ProfileDetailsInput => ({ realName: '', email: '', hometown: '', bio: '', resources: '', needs: '' })
const form = reactive(emptyForm()), name = ref(''), loading = ref(false), loaded = ref(false), busy = ref(false), error = ref(''), actionError = ref('')
const shortFields = [{ key: 'realName', label: '真实姓名', max: 100 }, { key: 'email', label: '邮箱', max: 320 }, { key: 'hometown', label: '家乡', max: 100 }] as const
const longFields = [{ key: 'bio', label: '个人简介', placeholder: '介绍一下自己' }, { key: 'resources', label: '我有资源', placeholder: '你愿意分享的经验或资源' }, { key: 'needs', label: '我需资源', placeholder: '你希望获得的帮助或合作' }] as const
let generation = 0
async function load() {
  const current = ++generation
  loaded.value = false; error.value = ''; actionError.value = ''
  if (!session.token) { loading.value = false; return }
  loading.value = true
  try {
    const [member, details] = await Promise.all([refreshMember(), api.profileDetails()])
    if (current !== generation) return
    name.value = member?.displayName || ''
    for (const key of Object.keys(form) as (keyof ProfileDetailsInput)[]) form[key] = details[key] || ''
    loaded.value = true
  } catch (e) { if (current === generation) error.value = errorMessage(e) }
  finally { if (current === generation) loading.value = false }
}
async function save() {
  if (busy.value || !loaded.value || !session.token) return
  if (!name.value.trim()) { actionError.value = '请填写用户名称'; return }
  const current = generation, token = session.token, epoch = session.epoch
  const valid = () => current === generation && token === session.token && epoch === session.epoch
  busy.value = true; actionError.value = ''
  let detailsSaved = false
  try {
    await api.saveProfileDetails({ ...form }); detailsSaved = true
    if (!valid()) return
    if (name.value.trim() !== session.member?.displayName || !session.member?.profileComplete) await api.profile(name.value.trim())
    if (valid()) uni.showToast({ title: '资料已保存', icon: 'success' })
  } catch (e) { if (valid()) actionError.value = (detailsSaved ? '补充资料已保存，用户名称未保存：' : '') + errorMessage(e) }
  finally { if (valid()) busy.value = false }
}
async function avatar(event: { detail: { avatarUrl?: string } }) {
  if (busy.value || !loaded.value || !event.detail.avatarUrl) return
  const current = generation
  busy.value = true; actionError.value = ''
  try { await uploadAvatar(event.detail.avatarUrl) }
  catch (e) { if (current === generation) actionError.value = errorMessage(e) }
  finally { if (current === generation) busy.value = false }
}
const stop = watch(() => [session.token, session.epoch], () => {
  generation++; loaded.value = false; busy.value = false; name.value = ''; Object.assign(form, emptyForm()); void load()
}, { flush: 'sync' })
onShow(() => { if (!loaded.value) void load() })
onUnload(() => { generation++; stop() })
</script>
<template>
  <view class="profile-page">
    <view
      v-if="!session.token"
      class="empty"
    >
      登录后编辑自己的资料<button
        class="text-button"
        @click="loginPage(routes.profile)"
      >
        去登录
      </button>
    </view>
    <template v-else>
      <RequestState
        :loading="loading"
        :error="error"
        @retry="load"
      />
      <template v-if="loaded">
        <view class="panel">
          <view class="section-heading">基本资料</view>
          <view class="form-row avatar-row">
            <text class="label">头像</text><button
              class="avatar-button"
              open-type="chooseAvatar"
              :disabled="busy"
              @chooseavatar="avatar"
            >
              <view class="portrait">
                <image
                  v-if="session.member?.avatarUrl"
                  :src="mediaUrl(session.member.avatarUrl)"
                  mode="aspectFill"
                /><uni-icons
                  v-else
                  type="person-filled"
                  size="60rpx"
                  color="#689380"
                />
              </view><text>更换头像</text><uni-icons
                type="arrow-right"
                size="30rpx"
              />
            </button>
          </view>
          <view class="form-row">
            <text class="label">用户名称</text><input
              v-model="name"
              :disabled="busy"
              class="input"
              type="nickname"
              maxlength="100"
              placeholder="请输入用户名称"
            >
          </view>
          <view class="form-row phone-row">
            <text class="label">手机号</text><view class="field-content">
              <view
                v-if="session.member?.boundPhone"
                class="phone-value"
              >
                {{ session.member.boundPhone }}<text class="bound">已绑定</text>
              </view><button
                v-else
                class="text-button"
                @click="loginPage(routes.profile)"
              >
                去绑定手机号
              </button><view class="hint">绑定后暂不支持自行修改</view>
            </view>
          </view>
        </view>
        <view class="panel">
          <view class="heading-row"><view class="section-heading">补充资料</view><text class="hint">以下资料选填</text></view>
          <view
            v-for="field in shortFields"
            :key="field.key"
            class="form-row optional-row"
          >
            <text class="label">{{ field.label }}</text><input
              v-model="form[field.key]"
              :disabled="busy"
              class="input"
              :maxlength="field.max"
              :placeholder="'请输入'+field.label"
            >
          </view>
          <view
            v-for="field in longFields"
            :key="field.key"
            class="form-row optional-row long-row"
          >
            <text class="label">{{ field.label }}</text><view class="textarea-wrap">
              <textarea
                v-model="form[field.key]"
                :disabled="busy"
                maxlength="2000"
                :placeholder="field.placeholder"
                :adjust-position="true"
              /><view class="counter">{{ form[field.key].length }}/2000</view>
            </view>
          </view>
        </view>
        <button
          class="visibility-link"
          :disabled="busy"
          @click="navigate(routes.cardSettings)"
        >
          <uni-icons
            type="locked"
            size="38rpx"
            color="#12805b"
          /><text>资料的可见范围由名片展示设置控制</text><uni-icons
            type="arrow-right"
            size="28rpx"
          />
        </button>
        <view
          v-if="actionError"
          class="error"
        >
          {{ actionError }}
        </view>
        <view class="footer">
          <button
            class="primary save-button"
            :disabled="busy"
            :loading="busy"
            @click="save"
          >
            保存资料
          </button>
        </view>
      </template>
    </template>
  </view>
</template>
<style scoped>
.profile-page{padding:24rpx 24rpx calc(150rpx + env(safe-area-inset-bottom));background:#f3f8f6;min-height:100vh}.panel{background:#fff;border-radius:22rpx;padding:28rpx 24rpx;margin-bottom:22rpx}.section-heading{font-size:32rpx;font-weight:650;display:flex;align-items:center;gap:14rpx}.section-heading:before{content:'';width:7rpx;height:28rpx;background:#148364;border-radius:5rpx}.heading-row{display:flex;align-items:center;justify-content:space-between;margin-bottom:12rpx}.form-row{display:flex;align-items:center;gap:18rpx;padding:22rpx 0;border-bottom:1rpx solid #edf0ef}.form-row:last-child{border-bottom:0;padding-bottom:4rpx}.label{width:142rpx;flex-shrink:0;font-size:28rpx}.input{flex:1;min-width:0;background:#f3f5f5;height:68rpx;padding:0 18rpx;border-radius:12rpx;font-size:28rpx}.avatar-button{display:flex;align-items:center;gap:12rpx;flex:1;padding:0;background:transparent;font-size:26rpx}.avatar-button text{margin-left:auto}.portrait{height:110rpx;width:110rpx;border-radius:50%;overflow:hidden;background:#eaf3ed;display:flex;align-items:center;justify-content:center}.portrait image{width:100%;height:100%}.field-content{flex:1;min-width:0}.phone-value{font-size:28rpx;display:flex;align-items:center;justify-content:space-between;gap:8rpx}.bound{color:#126e4c;background:#e3f5ea;font-size:22rpx;padding:5rpx 12rpx;border-radius:30rpx}.hint{color:#9099a1;font-size:23rpx;line-height:1.6}.phone-row .hint{margin-top:12rpx}.optional-row{border:0;padding:12rpx 0}.long-row{align-items:flex-start}.long-row .label{padding-top:18rpx}.textarea-wrap{flex:1;min-width:0;background:#f3f5f5;border-radius:12rpx;padding:18rpx}.textarea-wrap textarea{width:100%;height:124rpx;font-size:27rpx;line-height:1.6}.counter{text-align:right;font-size:22rpx;color:#919ba4}.visibility-link{width:100%;display:flex;align-items:center;gap:16rpx;padding:24rpx;background:#fff;border-radius:20rpx;font-size:23rpx;text-align:left}.visibility-link text{flex:1}.footer{position:fixed;left:0;right:0;bottom:0;background:#fff;padding:16rpx 28rpx calc(16rpx + env(safe-area-inset-bottom));z-index:5}.save-button{width:100%;font-size:30rpx;min-height:82rpx;border-radius:20rpx;background:linear-gradient(110deg,#117c62,#43b989)}
</style>
