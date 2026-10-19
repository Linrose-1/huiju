<script setup lang="ts">
import { ref, watch } from 'vue'
import { onShow, onHide, onUnload } from '@dcloudio/uni-app'
import { api, errorMessage } from '@/services/api'
import { useSessionStore } from '@/stores/session'
import { loginPage, routes } from '@/services/navigation'
const session = useSessionStore()
const activityText = ref(''), assistantText = ref(''), loading = ref(false), saving = ref(false), ready = ref(false), error = ref('')
let generation = 0
async function load() {
  const current = ++generation, epoch = session.epoch, token = session.token
  const valid = () => current === generation && epoch === session.epoch && token === session.token
  ready.value = false; error.value = ''; activityText.value = ''; assistantText.value = ''
  if (!token) { loginPage(routes.contentSettings); return }
  loading.value = true
  try {
    const content = await api.platformContent()
    if (!valid()) return
    if (!content.canEdit) { error.value = '你没有运营文案编辑权限'; return }
    activityText.value = content.activityText; assistantText.value = content.assistantText; ready.value = true
  } catch (e) { if (valid()) error.value = errorMessage(e) }
  finally { if (valid()) loading.value = false }
}
async function save() {
  if (!ready.value || saving.value) return
  if (!activityText.value.trim() || !assistantText.value.trim()) { error.value = '请填写两处文案'; return }
  const current = generation, epoch = session.epoch, token = session.token
  saving.value = true; error.value = ''
  try {
    const result = await api.savePlatformContent({ activityText: activityText.value.trim(), assistantText: assistantText.value.trim() })
    if (current !== generation || token !== session.token || epoch !== session.epoch) return
    activityText.value = result.activityText; assistantText.value = result.assistantText
    uni.showToast({ title: '已保存', icon: 'success' })
  } catch (e) { if (current === generation && epoch === session.epoch) error.value = errorMessage(e) }
  finally { saving.value = false }
}
function invalidate() { generation++; ready.value = false; loading.value = false; activityText.value = ''; assistantText.value = '' }
watch(() => [session.token, session.epoch], invalidate)
onShow(load); onHide(invalidate); onUnload(invalidate)
</script>
<template>
  <view class="content-settings">
    <view
      v-if="loading"
      class="muted"
    >
      正在读取文案…
    </view>
    <view
      v-if="error"
      class="error"
    >
      {{ error }}<button
        v-if="!ready"
        class="text-button"
        @click="load"
      >
        重试
      </button>
    </view>
    <view v-if="ready">
      <view class="field">
        <view class="label">活动页文案</view><textarea
          v-model="activityText"
          maxlength="200"
          :disabled="saving"
          auto-height
        />
      </view>
      <view class="field">
        <view class="label">助手页文案</view><textarea
          v-model="assistantText"
          maxlength="200"
          :disabled="saving"
          auto-height
        />
      </view>
      <view class="label">效果预览</view>
      <view class="preview"><text class="muted">活动页</text><view class="serif">{{ activityText }}</view></view>
      <view class="preview"><text class="muted">助手页</text><view class="serif">{{ assistantText }}</view></view>
      <button
        class="primary"
        :disabled="saving || !activityText.trim() || !assistantText.trim()"
        :loading="saving"
        @click="save"
      >
        保存并生效
      </button>
      <view class="note">保存后，用户下次进入对应页面时看到新文案。</view>
    </view>
  </view>
</template>
<style scoped>
.content-settings{padding:32rpx 30rpx calc(48rpx + env(safe-area-inset-bottom));min-height:100vh}.field{padding:28rpx;background:#fff;border-radius:20rpx;margin-bottom:24rpx}.label{font-size:28rpx;font-weight:600;margin-bottom:20rpx}.field textarea{width:100%;min-height:100rpx;font-size:30rpx;line-height:1.6}.preview{padding:28rpx;background:#e6f1eb;border-radius:20rpx;margin-bottom:24rpx;overflow-wrap:anywhere}.preview .serif{font-size:36rpx;line-height:1.5;margin-top:16rpx}.note{font-size:24rpx;color:#758279;line-height:1.6;margin-top:24rpx}
</style>
