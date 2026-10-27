<script setup lang="ts">
import { usePageShare } from '@/services/wechat/page-share'
import { ref, watch } from 'vue'
import { onShareAppMessage, onShareTimeline, onLoad, onShow, onHide, onUnload, onPullDownRefresh } from '@dcloudio/uni-app'
import { api, errorMessage, refreshMember } from '@/services/api'
import type { CirclePost } from '@/services/api/types'
import { useSessionStore } from '@/stores/session'
import { routes, navigate, requireProfile } from '@/services/navigation'
import { mediaUrl } from '@/services/api/environment'
import { categoryLabel, subtypeLabel, stateLabel, circleTime, newRequestId } from '@/services/circle'
import RequestState from '@/components/base/RequestState.vue'
const session = useSessionStore(), post = ref<CirclePost | null>(null), id = ref('')
const loading = ref(false), error = ref(''), actionError = ref(''), sheet = ref(false), phone = ref(''), sending = ref(false)
const galleryIndex = ref(0)
let version = 0, pendingIntent = false, visible = false, confirming = false
let intentRequest: { phone: string; requestId: string } | null = null
function clear() { version++; post.value = null; loading.value = false; error.value = ''; sheet.value = false; phone.value = ''; actionError.value = ''; sending.value = false; intentRequest = null }
watch(() => [session.token, session.epoch], (_, old) => {
  if (old?.[0] && !confirming) pendingIntent = false
  clear()
  if (visible) void load()
}, { flush: 'sync' })
async function load() {
  const current = ++version, token = session.token, epoch = session.epoch
  loading.value = true; error.value = ''; post.value = null
  const valid = () => current === version && token === session.token && epoch === session.epoch && visible
  try {
    if (!id.value) throw new Error('帖子链接不完整，请从学友圈重新进入')
    const result = await api.circlePost(id.value)
    if (!valid()) return
    post.value = result
    galleryIndex.value = 0
    if (pendingIntent && result.state === 'open' && !result.isOwner && session.member?.profileComplete) {
      pendingIntent = false; phone.value = session.member.boundPhone || ''; sheet.value = true
    }
  } catch (e) { if (valid()) error.value = errorMessage(e) }
  finally { if (valid()) loading.value = false }
}
async function confirmIntent() {
  if (confirming || !post.value || post.value.state !== 'open' || post.value.isOwner) return
  confirming = true; pendingIntent = true; actionError.value = ''
  try {
    if (!await requireProfile(routes.circleDetail + '?id=' + encodeURIComponent(id.value) + '&intent=1')) return
    if (!visible) return
    await load()
  } catch (e) { if (visible) actionError.value = errorMessage(e) }
  finally { confirming = false }
}
function closeSheet() { if (sending.value) return; sheet.value = false; phone.value = ''; intentRequest = null; actionError.value = ''; pendingIntent = false }
async function submit() {
  if (sending.value || !sheet.value || post.value?.state !== 'open' || post.value.isOwner) return
  const contact = phone.value.trim()
  if (!/^\+?[0-9][0-9 ()-]{4,30}[0-9]$/.test(contact)) { actionError.value = '请填写有效的联系电话'; return }
  if (intentRequest && intentRequest.phone !== contact) { actionError.value = '请先重试上次提交，确认结果后再修改电话'; return }
  const token = session.token, epoch = session.epoch, current = version
  const valid = () => token === session.token && epoch === session.epoch && current === version && visible
  sending.value = true; actionError.value = ''
  try {
    const member = await refreshMember()
    if (!valid()) return
    if (!member?.profileComplete) { pendingIntent = true; sheet.value = false; await requireProfile(routes.circleDetail + '?id=' + encodeURIComponent(id.value) + '&intent=1'); return }
    intentRequest ||= { phone: contact, requestId: newRequestId() }
    await api.submitCircleIntent(id.value, intentRequest.phone, intentRequest.requestId)
    if (!valid()) return
    sending.value = false; closeSheet(); uni.showToast({ title: '意向已提交', icon: 'success' })
  } catch (e) {
    if (valid()) {
      const message = errorMessage(e)
      if (typeof e === 'object' && e && 'code' in e && ['POST_UNAVAILABLE','NOT_FOUND'].includes(String(e.code))) {
        pendingIntent = false; clear(); await load()
        if (token === session.token && epoch === session.epoch && visible) actionError.value = message
      } else { actionError.value = message; if (typeof e === 'object' && e && 'status' in e && Number(e.status) >= 400 && Number(e.status) < 500) intentRequest = null }
    }
  } finally { if (valid()) sending.value = false }
}
function goHome() { uni.switchTab({url:routes.circle}) }
function preview(index: number) { if (post.value?.images.length) uni.previewImage({ current: index, urls: post.value.images.map(x => mediaUrl(x.url)) }) }
onLoad(options => { id.value = String(options?.id || ''); pendingIntent = options?.intent === '1'; session.captureInvite(options?.inviteCode) })
onShow(() => { visible = true; void load() })
onPullDownRefresh(async () => {
  try { if (!sheet.value && !sending.value) await load() }
  finally { uni.stopPullDownRefresh() }
})
onHide(() => { visible = false; clear() })
onUnload(() => { visible = false; pendingIntent = false; clear() })
const { shareReady, shareError, shareBusy, retryShare, shareMessage, shareTimeline } = usePageShare(() => post.value && post.value.state !== 'removed' ? {path: routes.circleDetail, id: id.value, title: post.value.title} : null, true)
onShareAppMessage(shareMessage)
onShareTimeline(shareTimeline)
</script>
<template>
  <view class="circle-page circle-safe circle-detail">
    <view
      v-if="shareError"
      class="error"
      role="alert"
    >
      <text>{{ shareError }}</text>
      <button
        class="text-button"
        :disabled="shareBusy"
        @click="retryShare"
      >
        {{ shareBusy ? '正在识别…' : '重试分享' }}
      </button>
    </view>
    <RequestState
      :loading="loading"
      :error="error"
      @retry="load"
    />
    <template v-if="post">
      <view
        v-if="post.state === 'removed'"
        class="circle-card"
      >
        <view class="circle-title">帖子已下架</view><view class="circle-copy">该帖子暂不可查看或提交意向。</view><button
          class="btn-secondary"
          @tap="goHome"
        >
          返回学友圈
        </button>
      </view>
      <template v-else>
        <view
          v-if="post.images.length"
          class="detail-hero"
        >
          <swiper
            class="detail-swiper"
            :current="galleryIndex"
            @change="galleryIndex=$event.detail.current"
          >
            <swiper-item
              v-for="(picture,index) in post.images"
              :key="picture.id"
            >
              <image
                class="detail-hero-image"
                :src="mediaUrl(picture.url)"
                mode="aspectFill"
                @tap="preview(index)"
              />
            </swiper-item>
          </swiper>
          <text class="detail-image-count">{{ galleryIndex + 1 }}/{{ post.images.length }}</text>
        </view>
        <view
          class="circle-card detail-content"
          :class="{'has-hero':post.images.length}"
        >
          <view class="detail-labels">
            <text class="circle-tag">{{ categoryLabel(post.category) }}{{ post.subtype?' · '+subtypeLabel(post.subtype):'' }}</text><text
              class="circle-status"
              :class="post.state"
            >
              {{ stateLabel(post.state) }}
            </text>
          </view>
          <view class="circle-title detail-title">{{ post.title }}</view>
          <view class="circle-author">
            <image
              v-if="post.author?.avatarUrl"
              class="circle-avatar"
              :src="mediaUrl(post.author.avatarUrl)"
              mode="aspectFill"
            /><view><view>{{ post.author?.displayName || '学友' }}</view><text class="circle-muted">{{ circleTime(post.createdAt) }}</text></view>
          </view>
          <view class="detail-facts"><view v-if="post.location">位置 <text>{{ post.location }}</text></view><view v-if="post.area">面积 <text>{{ post.area }}</text></view><view v-if="post.price">价格 / 预算 <text>{{ post.price }}</text></view><view v-if="post.validUntil">有效期 <text>{{ post.validUntil }}</text></view><view v-if="post.storeName">门店名称 <text>{{ post.storeName }}</text></view></view>
          <view class="circle-copy detail-body">{{ post.body }}</view>
          <button
            v-if="post.isOwner && post.state==='open'"
            class="btn-secondary detail-edit"
            @tap="navigate(routes.circleEditor+'?id='+id)"
          >
            编辑帖子
          </button>
        </view>
        <view
          v-if="post.state === 'ended'"
          class="circle-card circle-muted"
        >
          帖子已结束，内容仍可查看，暂不接受新的意向。
        </view>
        <view
          v-if="actionError && !sheet"
          class="circle-error"
        >
          {{ actionError }}
        </view>
        <view class="circle-footer">
          <button
            class="btn-secondary detail-share"
            :open-type="shareReady ? 'share' : undefined"
            :disabled="!shareReady"
          >
            分享
          </button><button
            v-if="post.isOwner"
            class="btn-primary"
            @tap="navigate(routes.circleIntents+'?id='+id)"
          >
            收到的意向
          </button><button
            v-else
            class="btn-primary"
            :disabled="post.state !== 'open' || confirming"
            @tap="confirmIntent"
          >
            {{ post.state === 'ended'?'已结束':'我感兴趣' }}
          </button>
        </view>
      </template>
    </template>
    <view
      v-if="sheet && post"
      class="circle-sheet-mask"
      @tap.self="closeSheet"
    >
      <view class="circle-sheet">
        <view class="circle-sheet-handle" /><view class="circle-sheet-heading">确认意向</view><view class="circle-muted sheet-description">提交后，联系电话仅该帖发布者可见</view>
        <view class="circle-field-label">联系电话</view><input
          v-model="phone"
          class="input"
          type="text"
          :maxlength="32"
          :disabled="sending || !!intentRequest"
          placeholder="填写联系电话"
        >
        <view class="circle-muted sheet-note">联系电话仅帖子作者可见，不会修改你的绑定手机号</view><view
          v-if="actionError"
          class="circle-error"
        >
          {{ actionError }}
        </view>
        <view class="circle-actions">
          <button
            class="btn-secondary"
            :disabled="sending"
            @tap="closeSheet"
          >
            取消
          </button><button
            class="btn-primary"
            :loading="sending"
            :disabled="sending"
            @tap="submit"
          >
            {{ intentRequest?'重试提交':'确认提交' }}
          </button>
        </view>
      </view>
    </view>
  </view>
</template>
<style lang="scss">@import './circle.scss';</style>
<style scoped>.detail-labels{display:flex;align-items:center;justify-content:space-between}.detail-title{font-size:40rpx;margin-top:24rpx}.detail-facts{margin-top:26rpx;font-size:27rpx;line-height:2;color:#89928c}.detail-facts text{color:#425a4b;margin-left:22rpx}.detail-gallery image{width:100%;border-radius:16rpx;margin-top:20rpx}.sheet-description{text-align:center}.sheet-post{padding:24rpx;background:#f1f7f3;border-radius:16rpx;margin:28rpx 0}.sheet-post .circle-title{margin-top:14rpx;font-size:31rpx}.sheet-note{margin-top:16rpx;font-size:23rpx}</style>
<style scoped>
.circle-detail{padding:0 0 calc(170rpx + env(safe-area-inset-bottom))}.detail-hero{position:relative;height:450rpx}.detail-swiper,.detail-hero-image{width:100%;height:100%}.detail-image-count{position:absolute;bottom:38rpx;right:30rpx;border-radius:40rpx;background:#12251dbb;color:#fff;padding:8rpx 20rpx;font-size:27rpx}.detail-content{position:relative;padding:28rpx 34rpx;margin-bottom:0}.detail-content.has-hero{margin-top:-16rpx;border-radius:26rpx 26rpx 0 0}.detail-content .circle-tag{background:#f3e4c4;color:#956623;border-radius:40rpx;padding:9rpx 22rpx}.detail-title{font-size:40rpx;line-height:1.4;margin-top:20rpx}.detail-facts:empty{display:none}.detail-facts{background:#f2f7f4;padding:18rpx 22rpx;border-radius:16rpx;font-size:27rpx}.detail-body{color:#38493f;font-size:29rpx;margin-top:28rpx;line-height:1.85}.detail-edit{margin-top:28rpx;padding:18rpx}.circle-footer .detail-share{flex:0.7}.circle-sheet-heading{margin-top:24rpx;font-size:40rpx}.sheet-description{margin-bottom:34rpx}.sheet-note{font-size:23rpx}
</style>
