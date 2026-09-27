<script setup lang="ts">
import { ref, watch } from 'vue'
import { onLoad, onShow, onHide, onUnload } from '@dcloudio/uni-app'
import { api, ApiError, errorMessage, refreshMember } from '@/services/api'
import type { MemberCard as Card } from '@/services/api/types'
import { routes, loginPage } from '@/services/navigation'
import { useSessionStore } from '@/stores/session'
import RequestState from '@/components/base/RequestState.vue'
import MemberCard from '@/components/business/MemberCard.vue'
const session = useSessionStore(), id = ref(''), card = ref<Card | null>(null), loading = ref(false), error = ref(''), needsProfile = ref(false)
let generation = 0, visible = false
function completeProfile() { loginPage(routes.memberCard + '?id=' + encodeURIComponent(id.value)) }
async function load() {
  const current = ++generation
  card.value = null; error.value = ''; needsProfile.value = false; loading.value = false
  if (!id.value) { error.value = '名片链接无效'; return }
  if (!session.token) { needsProfile.value = true; return }
  loading.value = true
  try {
    const member = await refreshMember()
    if (current !== generation) return
    if (!member?.profileComplete) { needsProfile.value = true; return }
    const result = await api.memberCard(id.value)
    if (current === generation) card.value = result
  } catch (e) {
    if (current !== generation) return
    if (e instanceof ApiError && (e.status === 401 || e.status === 403)) needsProfile.value = true
    else error.value = errorMessage(e)
  } finally { if (current === generation) loading.value = false }
}
const stop = watch(() => [session.token, session.epoch], () => {
  generation++; card.value = null; error.value = ''; loading.value = false
  if (visible) void load()
}, { flush: 'sync' })
onLoad(options => { id.value = typeof options?.id === 'string' ? options.id : '' })
onShow(() => { visible = true; void load() })
onHide(() => { visible = false; generation++; card.value = null })
onUnload(() => { generation++; stop() })
</script>
<template>
  <view class="card-page">
    <RequestState
      :loading="loading"
      :error="error"
      @retry="load"
    />
    <view
      v-if="needsProfile && !loading"
      class="profile-gate"
    >
      <uni-icons
        type="locked"
        size="66rpx"
        color="#247759"
      /><view class="gate-heading">完善资料后查看会员名片</view><view class="gate-copy">请先绑定手机号，并设置头像和用户名称。</view><button
        class="primary"
        @click="completeProfile"
      >
        {{ session.token ? '完善资料' : '登录并完善资料' }}
      </button>
    </view>
    <MemberCard
      v-if="card"
      :card="card"
    />
  </view>
</template>
<style scoped>
.card-page{min-height:100vh;background:#eff9f4;padding:26rpx 26rpx calc(32rpx + env(safe-area-inset-bottom))}.profile-gate{margin-top:40rpx;text-align:center;background:#fff;border-radius:24rpx;padding:42rpx 30rpx}.gate-heading{font-size:32rpx;font-weight:600;margin:20rpx 0}.gate-copy{font-size:26rpx;color:#7b8982;line-height:1.7;margin-bottom:30rpx}.profile-gate button{font-size:29rpx;min-height:82rpx}
</style>
