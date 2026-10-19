<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import { onLoad, onUnload } from '@dcloudio/uni-app'
import { useSessionStore } from '@/stores/session'
import { api, errorMessage } from '@/services/api'
import { mediaUrl, LOCAL_TEST } from '@/services/api/environment'
import { bootstrapIdentity, uploadAvatar } from '@/services/wechat'
import { finishProfile, routes, navigate } from '@/services/navigation'
import type { LegalDocuments } from '@/services/api/types'
const session = useSessionStore(), name = ref(''), invite = ref(''), returnTo = ref(''), busy = ref(false), error = ref('')
const selectedAvatar = ref('')
const avatarPreview = computed(() => selectedAvatar.value || mediaUrl(session.member?.avatarUrl))
const documents = ref<LegalDocuments | null>(null), agreed = ref(false), legalLoading = ref(false), legalError = ref('')
let active = true, legalGeneration = 0, identityGeneration = 0, nameEdited = false, acceptedLegal = ''
function editName(event: unknown) {
    const value = (event as { detail?: { value?: unknown } })?.detail?.value
    if (typeof value === 'string') { nameEdited = true; name.value = value }
}
async function loadLegal() {
  const current = ++legalGeneration
  legalLoading.value = true; legalError.value = ''; documents.value = null; agreed.value = false
  try { const result = await api.legalDocuments(); if (active && current === legalGeneration) documents.value = result }
  catch (e) { if (active && current === legalGeneration) legalError.value = errorMessage(e) }
  finally { if (active && current === legalGeneration) legalLoading.value = false }
}
onUnload(() => { active = false; legalGeneration++; identityGeneration++ })
watch(() => session.token, (token, previous) => {
  if (active && previous && previous !== token) {
    identityGeneration++; selectedAvatar.value = ''; name.value = ''; nameEdited = false; acceptedLegal = ''
    if (!token) void loadLegal()
  }
}, { flush: 'sync' })
const cancelTarget = computed(() => {
  const target = returnTo.value, path = target.split('?')[0]
  if (!Object.values(routes).includes(path) || path === routes.login) return ''
  if (path === routes.circleEditor) return routes.circle
  if (path === routes.editor) return routes.activity
  if (path === routes.activityDraft) return routes.assistant
  if (path === routes.activitySearch) return routes.assistant
  if (path === routes.form) return target.replace(routes.form, routes.detail)
  return target
})
const cancelText = computed(() => !cancelTarget.value ? '暂不完善，先看看活动' : cancelTarget.value === routes.circle ? '暂不继续，返回学友圈' : cancelTarget.value === routes.activity ? '暂不继续，返回活动' : cancelTarget.value === routes.assistant ? '暂不继续，返回助手' : cancelTarget.value.startsWith(routes.circleDetail + '?') ? '暂不继续，返回帖子' : '暂不继续，返回原页面')
function cancel() { if (!busy.value) finishProfile(cancelTarget.value) }
onLoad(async (options) => {
    void loadLegal()
    try { returnTo.value = decodeURIComponent(String(options?.returnTo || '')) }
    catch { returnTo.value = '' }
    invite.value = session.pendingInvite
    name.value = session.member?.displayName || ''
    const current = identityGeneration, epoch = session.epoch
    try {
        await bootstrapIdentity()
        if (!active || current !== identityGeneration || epoch !== session.epoch) return
        if (session.member?.profileComplete) { finishProfile(returnTo.value); return }
        if (!nameEdited) name.value = session.member?.displayName || ''
    }
    catch (e) { if (active && current === identityGeneration) error.value = errorMessage(e) }
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
async function ensureIdentity() {
    if (!agreed.value || !documents.value) throw new Error('请先阅读并同意用户协议和隐私政策')
    if (!session.token) await bootstrapIdentity()
    if (!active) throw new Error('页面已离开，请重新操作')
    const token = session.token, epoch = session.epoch, versions = documents.value
    const key = [token, versions.terms.version, versions.privacy.version].join(':')
    if (acceptedLegal !== key) {
        await api.acceptLegal({ termsVersion: versions.terms.version, privacyVersion: versions.privacy.version })
        if (!active || token !== session.token || epoch !== session.epoch) throw new Error('身份已变更，请重新操作')
        acceptedLegal = key
    }
}
async function submit(event?: unknown) {
    const submittedName = (event as { detail?: { value?: { displayName?: unknown } } } | undefined)?.detail?.value?.displayName
    if (typeof submittedName === 'string') { nameEdited = true; name.value = submittedName }
    await perform(async () => {
        await ensureIdentity()
        const token = session.token, epoch = session.epoch
        const valid = () => active && token === session.token && epoch === session.epoch
        if (!name.value.trim()) throw new Error('请填写用户名称')
        if (selectedAvatar.value) {
            await uploadAvatar(selectedAvatar.value)
            if (!valid()) return
            selectedAvatar.value = ''
        }
        await api.profile(name.value.trim())
        if (!valid()) return
        if (!session.member?.profileComplete) throw new Error('请完成头像选择和手机号授权后继续')
        finishProfile(returnTo.value)
    })
}
function legal(kind: 'terms' | 'privacy') { navigate(routes[kind]) }
function remindPhoneConsent() {
    if (!active || busy.value) return
    uni.showToast({ title: documents.value ? '请先阅读并同意用户协议和隐私政策' : '协议尚未就绪，请稍后或重新读取协议', icon: 'none', duration: 2500 })
}
function testPhone() { if (LOCAL_TEST) void perform(async () => { await ensureIdentity(); if (active && !session.member?.boundPhone) await api.phone('huiju-local-test') }) }
function testAvatar() {
    if (LOCAL_TEST) void perform(async () => { await ensureIdentity(); await api.avatar('iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAIAAAAlC+aJAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAAn0lEQVRoge2SQQkAQRDDKiPiKmP9cyLuEQYKEZCGhtfTRDdgA6pXZBfqXaIbsAHVK7IL9S7RDdiA6hXZhXqX6AZsQPWK7EK9S3QDNqB6RXah3iW6ARtQvSK7UO8S3YANqF6RXah3iW7ABlSvyC7Uu0Q3YAOqV2QX6l2iG7AB1SuyC/Uu0Q3YgOoV2YV6l+gGbED1iuxCvUt0AzagesU/fHBggNPKQZE8AAAAAElFTkSuQmCC', 'image/png') })
}
async function avatar(event: { detail: { avatarUrl?: string } }) {
    const path = event.detail.avatarUrl
    if (!path || busy.value || !active) return
    selectedAvatar.value = path
    if (session.token && agreed.value && documents.value) await perform(async () => {
        await ensureIdentity()
        await uploadAvatar(path)
        if (active) selectedAvatar.value = ''
    })
}
async function phone(event: { detail: { code?: string; errMsg?: string } }) {
    if (!event.detail.code) {
        error.value = '手机号授权未完成，请重试'
        return
    }
    await perform(async () => {
        await ensureIdentity()
        if (active && !session.member?.boundPhone) await api.phone(event.detail.code!)
    })
}
</script>
<template>
  <view class="login">
    <view
      v-if="LOCAL_TEST"
      class="error test-notice"
    >
      本地模拟测试：独立测试身份，手机号不经过微信授权。
    </view>
    <view class="login-hero">
      <image
        class="campus"
        src="/static/huiju/campus.jpg"
        mode="aspectFill"
      />
      <view class="brand-block"><text class="brand serif">会聚</text><view class="gold-line" /></view>
    </view>
    <view class="login-body">
      <view class="welcome">完善资料，成为会员</view>
      <view class="subtitle">游客可先浏览，完善资料后参与活动</view>
      <form @submit="submit">
        <view
          class="profile-form"
        >
          <view class="avatar-row">
            <text class="field-label">用户头像</text>
            <view class="avatar-controls">
              <view class="avatar">
                <image
                  v-if="avatarPreview"
                  :src="avatarPreview"
                  mode="aspectFill"
                />
                <uni-icons
                  v-else
                  type="person-filled"
                  size="32"
                  color="#bac5bf"
                />
              </view>
              <button
                v-if="LOCAL_TEST && session.token"
                class="avatar-button"
                :disabled="busy"
                @click="testAvatar"
              >
                使用测试头像
              </button>
              <button
                v-else
                class="avatar-button"
                open-type="chooseAvatar"
                :disabled="busy"
                @chooseavatar="avatar"
              >
                选择头像 <uni-icons
                  type="arrow-right"
                  size="16"
                  color="#52665c"
                />
              </button>
            </view>
          </view>
          <view class="form-field">
            <text class="field-label">用户名称</text>
            <view class="input-wrap">
              <input
                v-model="name"
                name="displayName"
                :type="LOCAL_TEST ? 'text' : 'nickname'"
                maxlength="100"
                class="name-input"
                placeholder="填写或选择微信昵称"
                placeholder-class="field-placeholder"
                :disabled="busy"
                :cursor-spacing="100"
                @input="editName"
              >
              <uni-icons
                type="compose"
                size="22"
                color="#8d9c94"
              />
            </view>
          </view>
          <view class="form-field">
            <text class="field-label">用户手机号</text>
            <view
              v-if="session.member?.boundPhone"
              class="phone-input bound-phone"
            >
              {{ session.member.boundPhone }}
            </view>
            <view
              v-else
              class="phone-input"
            >
              <text class="field-placeholder">请授权获取手机号</text>
              <button
                v-if="!agreed || !documents"
                class="phone-button"
                :disabled="busy"
                @click="remindPhoneConsent"
              >
                {{ LOCAL_TEST ? '绑定模拟手机号' : '快捷获取' }}
              </button>
              <button
                v-else-if="LOCAL_TEST"
                class="phone-button"
                :disabled="busy"
                @click="testPhone"
              >
                绑定模拟手机号
              </button>
              <button
                v-else
                class="phone-button"
                open-type="getPhoneNumber"
                :disabled="busy"
                @getphonenumber="phone"
              >
                快捷获取
              </button>
            </view>
          </view>
          <view class="form-field last">
            <view class="field-heading"><text class="field-label">邀请码</text><text class="optional">首次进入后固定</text></view>
            <input
              :value="session.token ? '邀请关系已固定' : invite"
              class="invite-input"
              maxlength="32"
              disabled
              placeholder="正在确认首次来源"
              placeholder-class="field-placeholder"
              :cursor-spacing="100"
            >
          </view>
        </view>
        <view
          v-if="error"
          class="error"
        >
          {{ error }}
        </view>
        <view
          v-if="legalLoading || legalError"
          class="legal-status"
        >
          <text v-if="legalLoading">正在读取协议…</text>
          <view
            v-else-if="legalError"
            class="legal-retry"
          >
            <text>{{ legalError }}</text><button
              class="text-button"
              @click="loadLegal"
            >
              重新读取协议
            </button>
          </view>
        </view>
        <view
          v-if="documents"
          class="consent-row"
        >
          <checkbox-group
            class="consent-checkbox"
            @change="agreed = $event.detail.value.includes('agree')"
          >
            <label class="consent-label"><checkbox
              value="agree"
              :checked="agreed"
              :disabled="busy"
              color="#07583f"
            /><text>我已阅读并同意</text></label>
          </checkbox-group>
          <text
            class="legal-link"
            @click="legal('terms')"
          >
            《用户协议》
          </text><text
            class="legal-link"
            @click="legal('privacy')"
          >
            《隐私政策》
          </text>
        </view>
        <button
          class="primary login-button"
          form-type="submit"
          :loading="busy"
          :disabled="busy || !agreed || !documents"
        >
          保存资料并继续
        </button>
      </form>
      <view
        v-if="documents?.development"
        class="development-notice"
      >
        开发测试文本，正式协议待补充
      </view>
      <button
        class="text-button cancel-button"
        :disabled="busy"
        @click="cancel"
      >
        {{ cancelText }}
      </button>
    </view>
  </view>
</template>
<style scoped>
.login { min-height: 100vh; background: #fffdf9; }
.test-notice { margin: 16rpx 30rpx; }
.login-hero { height: 300rpx; position: relative; overflow: hidden; }
.campus { width: 100%; height: 100%; display: block; }
.brand-block { position: absolute; left: 38rpx; bottom: 28rpx; }
.brand { color: #fffdf9; font-size: 65rpx; letter-spacing: 4rpx; line-height: 1.15; text-shadow: 0 2rpx 10rpx #153e3270; }
.gold-line { width: 42rpx; height: 5rpx; margin-top: 12rpx; background: #d1ac60; border-radius: 4rpx; }
.login-body { padding: 34rpx 34rpx calc(24rpx + env(safe-area-inset-bottom)); }
.welcome { font-size: 42rpx; font-weight: 600; line-height: 1.4; color: #07583f; }
.subtitle { font-size: 26rpx; line-height: 1.6; color: #7b817d; margin: 8rpx 0 26rpx; }
.profile-form { padding: 0 26rpx; background: #fff; border-radius: 26rpx; box-shadow: 0 6rpx 32rpx #214b3510; }
.avatar-row { display: flex; align-items: center; justify-content: space-between; min-height: 126rpx; border-bottom: 1rpx solid #e8ece9; gap: 16rpx; }
.field-label { margin: 0; font-size: 29rpx; line-height: 1.5; font-weight: 500; color: #172832; }
.avatar-controls { display: flex; align-items: center; gap: 18rpx; }
.avatar-controls .avatar { width: 80rpx; height: 80rpx; }
.avatar-button { display: flex; align-items: center; gap: 8rpx; font-size: 25rpx; line-height: 1.4; padding: 16rpx 20rpx; border-radius: 40rpx; background: #eef5f1; color: #52665c; }
.form-field { padding: 20rpx 0; border-bottom: 1rpx solid #e8ece9; }
.form-field.last { border: 0; padding-bottom: 26rpx; }
.input-wrap, .phone-input, .invite-input { margin-top: 12rpx; height: 80rpx; width: 100%; border-radius: 15rpx; background: #eef5f1; font-size: 27rpx; }
.input-wrap { display: flex; align-items: center; padding: 0 22rpx; gap: 12rpx; }
.name-input { min-width: 0; flex: 1; height: 80rpx; font-size: 27rpx; }
.field-placeholder { color: #8a9690; }
.phone-input { display: flex; align-items: center; justify-content: space-between; padding-left: 22rpx; gap: 8rpx; }
.phone-input > text { min-width: 0; font-size: 25rpx; }
.phone-button { flex-shrink: 0; border-radius: 0; border-left: 1rpx solid #becfc5; padding: 4rpx 22rpx; font-size: 27rpx; background: transparent; color: #07583f; line-height: 1.5; }
.phone-button[disabled] { background: transparent; color: #81938a; }
.bound-phone { color: #07583f; }
.field-heading { display: flex; align-items: center; justify-content: space-between; }
.optional { color: #919a95; font-size: 24rpx; }
.invite-input { padding: 0 22rpx; }
.error { margin-top: 18rpx; font-size: 25rpx; }
.legal-status { color: #7b817d; font-size: 24rpx; }
.legal-retry { margin-top: 20rpx; }
.consent-row { display: flex; align-items: center; justify-content: center; white-space: nowrap; margin-top: 22rpx; font-size: 23rpx; color: #747d77; }
.consent-checkbox { flex-shrink: 0; }
.consent-label { display: flex; align-items: center; min-height: 76rpx; }
.consent-label checkbox { transform: scale(.72); transform-origin: center; margin-left: -8rpx; margin-right: -2rpx; }
.legal-link { color: #07583f; line-height: 76rpx; flex-shrink: 0; }
.login-button.primary { margin: 10rpx 0 0; padding: 24rpx 20rpx; border-radius: 20rpx; background: #07583f; box-shadow: none; font-size: 31rpx; line-height: 1.5; }
.login-button.primary[disabled] { color: #7a9084; background: #dce8e0; }
.development-notice { text-align: center; font-size: 22rpx; line-height: 1.6; color: #8a928d; margin-top: 18rpx; }
.cancel-button.text-button { font-size: 26rpx; margin: 12rpx auto 0; padding: 12rpx 0; }
</style>
