<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'
import { onShow, onUnload } from '@dcloudio/uni-app'
import { api, errorMessage, refreshMember } from '@/services/api'
import type { ProfileDetails, CardSettings } from '@/services/api/types'
import { mediaUrl } from '@/services/api/environment'
import { routes, loginPage } from '@/services/navigation'
import { cardFields, emptySettings, previewCard } from '@/services/member-card'
import { useSessionStore } from '@/stores/session'
import RequestState from '@/components/base/RequestState.vue'
import MemberCard from '@/components/business/MemberCard.vue'
const session = useSessionStore(), settings = reactive(emptySettings())
const details = ref<ProfileDetails | null>(null), loading = ref(false), loaded = ref(false), busy = ref(false), error = ref(''), actionError = ref(''), preview = ref(false)
const card = computed(() => session.member && details.value ? previewCard(session.member, details.value, settings) : null)
let generation = 0
async function load() {
  const current = ++generation
  error.value = ''; actionError.value = ''; loaded.value = false; preview.value = false
  if (!session.token) { loading.value = false; return }
  loading.value = true
  try {
    const [, profile, values] = await Promise.all([refreshMember(), api.profileDetails(), api.cardSettings()])
    if (current !== generation) return
    details.value = profile; Object.assign(settings, values); loaded.value = true
  } catch (e) { if (current === generation) error.value = errorMessage(e) }
  finally { if (current === generation) loading.value = false }
}
function changeSetting(key: keyof CardSettings, event: unknown) { settings[key] = (event as { detail: { value: boolean } }).detail.value }
async function save() {
  if (busy.value || !loaded.value || !session.token) return
  const current = generation
  busy.value = true; actionError.value = ''
  try {
    await api.saveCardSettings({ ...settings })
    if (current === generation) uni.showToast({ title: '设置已保存', icon: 'success' })
  } catch (e) { if (current === generation) actionError.value = errorMessage(e) }
  finally { if (current === generation) busy.value = false }
}
const stop = watch(() => [session.token, session.epoch], () => {
  generation++; details.value = null; Object.assign(settings, emptySettings()); busy.value = false; preview.value = false; void load()
}, { flush: 'sync' })
onShow(() => { if (!loaded.value) void load() })
onUnload(() => { generation++; stop() })
</script>
<template>
  <view class="settings-page">
    <view
      v-if="!session.token"
      class="empty"
    >
      登录后设置自己的名片<button
        class="text-button"
        @click="loginPage(routes.cardSettings)"
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
        <view class="notice">
          <uni-icons
            type="info-filled"
            size="32rpx"
            color="#117b58"
          /><text>只向已完善资料的会员展示你开启的字段。</text>
        </view>
        <view class="panel">
          <view class="heading">固定展示</view><view class="identity">
            <view class="avatar">
              <image
                v-if="session.member?.avatarUrl"
                :src="mediaUrl(session.member.avatarUrl)"
                mode="aspectFill"
              /><uni-icons
                v-else
                type="person-filled"
                size="45rpx"
                color="#6e947f"
              />
            </view><view class="identity-copy"><view class="member-name">{{ session.member?.displayName || '待设置用户名称' }}</view><view class="hint">头像与用户名称</view></view><text class="hint">始终展示</text>
          </view>
        </view>
        <view class="panel">
          <view class="heading">自主展示</view><view class="hint intro">以下字段默认不公开，可逐项开启。</view><view
            v-for="field in cardFields"
            :key="field.key"
            class="setting-row"
          >
            <uni-icons
              :type="field.icon"
              size="36rpx"
              color="#253a33"
            /><text>{{ field.label }}</text><switch
              :checked="settings[field.setting]"
              :disabled="busy"
              color="#14865c"
              :aria-label="field.label+'展示开关'"
              @change="changeSetting(field.setting, $event)"
            />
          </view>
        </view>
        <view class="notice footer-notice">
          <uni-icons
            type="locked"
            size="38rpx"
            color="#117b58"
          /><text>关闭展示不会删除你的资料。你可以先预览，再保存设置。</text>
        </view>
        <view
          v-if="actionError"
          class="error"
        >
          {{ actionError }}
        </view>
        <view class="footer">
          <button
            class="preview-button"
            :disabled="busy"
            @click="preview = true"
          >
            预览名片
          </button><button
            class="primary save-button"
            :disabled="busy"
            :loading="busy"
            @click="save"
          >
            保存设置
          </button>
        </view>
        <view
          v-if="preview && card"
          class="preview-overlay"
        >
          <view class="preview-header">
            <text>名片预览</text><button
              class="close-button"
              @click="preview = false"
            >
              关闭
            </button>
          </view><scroll-view
            scroll-y
            class="preview-scroll"
          >
            <view class="preview-content"><view class="preview-hint">按当前开关预览，尚未保存的设置不会对外生效。</view><MemberCard :card="card" /></view>
          </scroll-view>
        </view>
      </template>
    </template>
  </view>
</template>
<style scoped>
.settings-page{padding:24rpx 26rpx calc(150rpx + env(safe-area-inset-bottom));min-height:100vh;background:#eff9f4}.notice{display:flex;gap:18rpx;align-items:center;color:#1b5744;background:#e3f4ec;border-radius:16rpx;padding:24rpx;font-size:25rpx;line-height:1.6;margin-bottom:20rpx}.notice text{flex:1}.panel{background:#fff;border-radius:22rpx;padding:28rpx;margin-bottom:20rpx}.heading{font-size:34rpx;font-weight:650}.identity{display:flex;align-items:center;gap:20rpx;margin-top:26rpx}.avatar{width:90rpx;height:90rpx;border-radius:50%;overflow:hidden;flex-shrink:0;display:flex;align-items:center;justify-content:center;background:#e5f2ea}.avatar image{width:100%;height:100%}.identity-copy{flex:1;min-width:0}.member-name{font-size:30rpx;font-weight:600;overflow-wrap:anywhere;margin-bottom:6rpx}.hint{font-size:25rpx;color:#808b8b}.intro{margin:16rpx 0}.setting-row{display:flex;align-items:center;gap:25rpx;min-height:86rpx;border-bottom:1rpx solid #e8eeeb}.setting-row:last-child{border:0}.setting-row text{flex:1;font-size:29rpx}.setting-row switch{flex-shrink:0}.footer-notice{font-size:24rpx}.footer{position:fixed;bottom:0;left:0;right:0;padding:18rpx 28rpx calc(18rpx + env(safe-area-inset-bottom));background:#fff;display:flex;gap:18rpx;z-index:5}.footer button{flex:1;min-height:82rpx;font-size:30rpx;border-radius:18rpx}.preview-button{background:#e3f5eb;color:#116b4c}.save-button{background:linear-gradient(110deg,#15895c,#27a771)}.preview-overlay{position:fixed;inset:0;z-index:20;background:#eff9f4;display:flex;flex-direction:column;padding-bottom:env(safe-area-inset-bottom)}.preview-header{display:flex;align-items:center;justify-content:space-between;padding:20rpx 28rpx;background:#fff;font-size:30rpx;font-weight:600;flex-shrink:0}.close-button{font-size:27rpx;color:#117753;background:#e8f5ee;padding:14rpx 24rpx}.preview-scroll{flex:1;height:0;min-height:0}.preview-content{padding:24rpx}.preview-hint{font-size:24rpx;color:#638576;line-height:1.6;margin-bottom:20rpx}
</style>
