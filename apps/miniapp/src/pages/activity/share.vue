<script setup lang="ts">
import { computed, getCurrentInstance, nextTick, ref, watch } from 'vue'
import { onLoad, onShow, onHide, onUnload, onShareAppMessage } from '@dcloudio/uni-app'
import PageReturn from '@/components/base/PageReturn.vue'
import RequestState from '@/components/base/RequestState.vue'
import { api, errorMessage } from '@/services/api'
import type { ActivityPoster } from '@/services/api/types'
import { routes } from '@/services/navigation'
import { useSessionStore } from '@/stores/session'
import { bootstrapIdentity } from '@/services/wechat'
import { usePageShare } from '@/services/wechat/page-share'
import { posterCoverPath, writePosterCode, removePosterCode, savePosterImage, sharePosterImage } from '@/services/wechat/poster-files'
import { POSTER_WIDTH, POSTER_HEIGHT, renderActivityPoster } from '@/services/wechat/activity-poster-canvas'

const session = useSessionStore(), component = getCurrentInstance()?.proxy
const id = ref(''), data = ref<ActivityPoster | null>(null)
const loading = ref(false), generating = ref(false), saving = ref(false), rendering = ref(false), exporting = ref(false)
const error = ref(''), actionError = ref(''), imagePath = ref(''), remaining = ref<number | null>(null)
const subtitle = ref(''), highlight1 = ref(''), highlight2 = ref(''), draftHash = ref(''), baseline = ref('')
const editing = ref(false), generated = ref(false)
let generation = 0, visible = false, disposed = false
const formValue = () => ({ subtitle: subtitle.value.trim(), highlights: [highlight1.value.trim(), highlight2.value.trim()].filter(Boolean) })
const dirty = computed(() => generated.value || JSON.stringify(formValue()) !== baseline.value)
const busy = computed(() => loading.value || generating.value || saving.value || rendering.value || exporting.value)
const { shareReady, shareBusy, shareError, retryShare, shareMessage } = usePageShare(() => data.value ? { path: routes.detail, id: id.value, title: data.value.title } : null)
onShareAppMessage(shareMessage)
function currentRequest() {
  const current = generation, epoch = session.epoch, token = session.token
  return () => visible && !disposed && generation === current && epoch === session.epoch && token === session.token
}
function setForm(value: ActivityPoster) {
  subtitle.value = value.subtitle; highlight1.value = value.highlights[0] || ''; highlight2.value = value.highlights[1] || ''
  draftHash.value = value.sourceHash; baseline.value = JSON.stringify(formValue()); generated.value = false
}
async function load() {
  if (loading.value || !id.value) return
  loading.value = true; error.value = ''; imagePath.value = ''
  const sequence = generation
  try {
    await bootstrapIdentity()
    if (disposed || !visible || sequence !== generation) return
    const current = currentRequest(), value = await api.activityPoster(id.value)
    if (!current()) return
    data.value = value
    if (!dirty.value || !baseline.value) setForm(value)
  } catch (e) { if (visible && sequence === generation) { error.value = errorMessage(e); data.value = null } }
  finally { if (sequence === generation) loading.value = false }
}
async function generateCopy() {
  if (busy.value || !data.value?.canEdit) return
  const current = currentRequest()
  generating.value = true; actionError.value = ''; imagePath.value = ''
  try {
    if (dirty.value) {
      const result = await new Promise<boolean>(resolve => uni.showModal({ title: '重新提炼文案', content: '将替换当前未确认的文案，是否继续？', success: value => resolve(!!value.confirm), fail: () => resolve(false) }))
      if (!result || !current()) return
    }
    const result = await api.generatePosterCopy(id.value)
    if (!current()) return
    subtitle.value = result.subtitle; highlight1.value = result.highlights[0] || ''; highlight2.value = result.highlights[1] || ''
    draftHash.value = result.sourceHash; remaining.value = result.remainingToday; generated.value = true; editing.value = true
  } catch (e) { if (current()) actionError.value = errorMessage(e) }
  finally { if (current()) generating.value = false }
}
async function confirmCopy() {
  if (busy.value || !data.value?.canEdit) return
  const current = currentRequest()
  saving.value = true; actionError.value = ''; imagePath.value = ''
  try {
    const result = await api.savePosterCopy(id.value, { ...formValue(), sourceHash: draftHash.value, version: data.value.version })
    if (!current()) return
    data.value = result; setForm(result); editing.value = false
    uni.showToast({ title: '文案已确认', icon: 'success' })
  } catch (e) { if (current()) actionError.value = errorMessage(e) }
  finally { if (current()) saving.value = false }
}
async function reloadCopy() {
  if (busy.value || !data.value?.canEdit) return
  const current = currentRequest()
  loading.value = true; actionError.value = ''
  try {
    if (dirty.value) {
      const confirmed = await new Promise<boolean>(resolve => uni.showModal({ title: '重新读取文案', content: '将放弃当前未确认的修改，读取最新活动和已确认文案。', success: result => resolve(!!result.confirm), fail: () => resolve(false) }))
      if (!confirmed || !current()) return
    }
    const latest = await api.activityPoster(id.value)
    if (current()) { data.value = latest; setForm(latest); imagePath.value = '' }
  } catch (e) { if (current()) actionError.value = errorMessage(e) }
  finally { if (current()) loading.value = false }
}
function discardCopy() {
  if (busy.value || !data.value) return
  setForm(data.value); editing.value = false; actionError.value = ''
}
async function createPoster() {
  if (busy.value || !data.value || dirty.value || !shareReady.value) return
  const current = currentRequest()
  rendering.value = true; actionError.value = ''; imagePath.value = ''
  let codePath = ''
  try {
    const latest = await api.activityPoster(id.value)
    if (!current()) return
    data.value = latest; setForm(latest)
    const [code, cover, brand] = await Promise.all([
      api.activityPosterCode(id.value), posterCoverPath(latest.coverUrl),
      api.platformBrand().catch(() => ({ displayName: '有聚点', visible: true })),
    ])
    if (!current()) return
    codePath = await writePosterCode(code.base64, code.mimeType)
    if (!current()) return
    await nextTick()
    const path = await renderActivityPoster({ canvasId: 'activity-poster', component, data: latest, coverPath: cover, codePath, brandName: brand.displayName, brandVisible: brand.visible })
    if (current()) imagePath.value = path
  } catch (e) { if (current()) actionError.value = errorMessage(e) }
  finally { removePosterCode(codePath); rendering.value = false }
}
async function exportImage(share: boolean) {
  if (busy.value || dirty.value || !imagePath.value || !data.value || !shareReady.value) return
  const current = currentRequest(), original = data.value
  exporting.value = true; actionError.value = ''
  try {
    const latest = await api.activityPoster(id.value)
    if (!current()) return
    if (latest.sourceHash !== original.sourceHash || latest.version !== original.version) {
      imagePath.value = ''; data.value = latest; setForm(latest)
      throw new Error('活动或海报文案已更新，请重新生成海报')
    }
    if (share) await sharePosterImage(imagePath.value)
    else { await savePosterImage(imagePath.value); if (current()) uni.showToast({ title: '已保存到相册', icon: 'success' }) }
  } catch (e) { if (current()) actionError.value = errorMessage(e) }
  finally { if (current()) exporting.value = false }
}
function previewPoster() { if (imagePath.value) uni.previewImage({ urls: [imagePath.value] }) }
onLoad(options => { id.value = String(options?.id || ''); if (!id.value) error.value = '活动链接不完整，请返回重试' })
onShow(() => { visible = true; void load() })
function invalidate() { generation++; loading.value = false; generating.value = false; saving.value = false; exporting.value = false; imagePath.value = '' }
onHide(() => { visible = false; invalidate() })
onUnload(() => { disposed = true; visible = false; invalidate() })
watch(() => [session.token, session.epoch, session.member?.inviteCode], (value, previous) => {
  if (previous && value.every((part, index) => part === previous[index])) return
  invalidate(); data.value = null; baseline.value = ''; generated.value = false; subtitle.value = ''; highlight1.value = ''; highlight2.value = ''
  if (visible) void load()
}, { flush: 'sync' })
</script>

<template>
  <view class="share-page">
    <PageReturn />
    <RequestState
      :loading="loading"
      :error="error"
      @retry="load"
    />
    <view
      v-if="data"
      class="share-body"
    >
      <text class="activity-name">{{ data.title }}</text>
      <view
        v-if="shareError"
        class="error"
      >
        <text>{{ shareError }}</text><button
          class="text-button"
          :disabled="shareBusy"
          @click="retryShare"
        >
          重试识别
        </button>
      </view>
      <view class="share-options">
        <button
          class="primary"
          :open-type="shareReady && !busy ? 'share' : undefined"
          :disabled="!shareReady || busy"
        >
          小程序直接分享
        </button>
        <button
          class="secondary"
          :disabled="!shareReady || busy || dirty"
          :loading="rendering"
          @click="createPoster"
        >
          {{ imagePath ? '重新生成海报' : '活动海报分享' }}
        </button>
      </view>
      <text class="hint">两种分享均带上你的邀请来源。</text>
      <view
        v-if="data.canEdit"
        class="copy-panel"
      >
        <view class="copy-header"><text>海报文案</text><text class="copy-status">{{ data.copyStatus === 'confirmed' ? '已确认' : data.copyStatus === 'stale' ? '活动已更新' : '尚未设置' }}</text></view>
        <text class="hint">AI 根据活动介绍提炼文案，检查确认后供大家分享。每天最多成功生成 5 次。</text>
        <text
          v-if="remaining !== null"
          class="hint"
        >
          今天还可成功生成 {{ remaining }} 次
        </text>
        <view class="copy-actions">
          <button
            class="secondary"
            :loading="generating"
            :disabled="busy"
            @click="generateCopy"
          >
            AI 提炼文案
          </button><button
            class="text-button"
            :disabled="busy"
            @click="editing = !editing"
          >
            {{ editing ? '收起编辑' : '编辑文案' }}
          </button>
        </view>
        <button
          class="text-button"
          :disabled="busy"
          @click="reloadCopy"
        >
          重新读取已确认文案
        </button>
        <view
          v-if="editing"
          class="copy-form"
        >
          <text class="field-label">简短介绍（选填，40字内）</text><textarea
            v-model="subtitle"
            maxlength="40"
            :disabled="busy"
            placeholder="用一句话介绍活动"
          />
          <text class="field-label">活动亮点（选填，每条24字内）</text><input
            v-model="highlight1"
            maxlength="24"
            :disabled="busy"
            placeholder="亮点一"
          ><input
            v-model="highlight2"
            maxlength="24"
            :disabled="busy"
            placeholder="亮点二"
          >
          <text class="hint">请核对文案，不添加活动中未说明的承诺。确认不修改活动原文。</text>
          <view class="copy-actions">
            <button
              class="primary"
              :disabled="busy"
              :loading="saving"
              @click="confirmCopy"
            >
              确认并使用
            </button><button
              class="text-button"
              :disabled="busy"
              @click="discardCopy"
            >
              放弃修改
            </button>
          </view>
        </view>
        <text
          v-if="dirty"
          class="hint"
        >
          文案尚未确认，请确认或放弃修改后生成海报。
        </text>
        <text
          v-else-if="data.copyStatus !== 'confirmed'"
          class="hint"
        >
          现在也可直接分享使用标题、封面和基本信息的海报。
        </text>
      </view>
      <view
        v-if="actionError"
        class="error"
        role="alert"
      >
        {{ actionError }}
      </view>
      <view
        v-if="imagePath"
        class="poster-preview"
      >
        <image
          :src="imagePath"
          mode="widthFix"
          class="poster-image"
          @click="previewPoster"
        />
        <view class="share-options">
          <button
            class="secondary"
            :disabled="busy || dirty || !shareReady"
            @click="exportImage(false)"
          >
            保存到相册
          </button><button
            class="primary"
            :disabled="busy || dirty || !shareReady"
            @click="exportImage(true)"
          >
            分享海报
          </button>
        </view>
        <text class="hint">海报中的小程序码属于你；请使用自己生成的海报分享。</text>
      </view>
    </view>
    <canvas
      id="activity-poster"
      canvas-id="activity-poster"
      class="poster-canvas"
      :style="{ width: POSTER_WIDTH + 'px', height: POSTER_HEIGHT + 'px' }"
    />
  </view>
</template>

<style scoped>
.share-page { padding: 24rpx 30rpx calc(40rpx + env(safe-area-inset-bottom)); }
.activity-name { display: block; margin: 20rpx 0 30rpx; font-size: 38rpx; line-height: 1.5; font-weight: 600; overflow-wrap: anywhere; }
.share-options, .copy-actions { display: flex; gap: 20rpx; align-items: center; }
.share-options button { display: flex; flex: 1; align-items: center; justify-content: center; min-width: 0; min-height: 88rpx; margin: 0; padding: 20rpx 16rpx; font-size: 28rpx; line-height: 1.5; }
.hint { display: block; margin: 18rpx 0; font-size: 26rpx; line-height: 1.6; color: #68776f; }
.copy-panel { margin: 32rpx 0; padding: 28rpx; border-radius: 20rpx; background: #fff; }
.copy-header { display: flex; justify-content: space-between; font-size: 32rpx; font-weight: 600; }
.copy-status { font-weight: 400; font-size: 25rpx; color: #68776f; }
.copy-actions button { margin: 0; font-size: 28rpx; }
.copy-form { padding-top: 20rpx; }
.field-label { display: block; margin: 20rpx 0 12rpx; font-size: 27rpx; }
.copy-form input, .copy-form textarea { box-sizing: border-box; width: 100%; margin-bottom: 16rpx; padding: 18rpx; border: 1rpx solid #dce5df; border-radius: 10rpx; background: #f8faf9; font-size: 28rpx; }
.copy-form input { height: 80rpx; }.copy-form textarea { height: 140rpx; }
.poster-image { display: block; width: 100%; margin: 28rpx 0; box-shadow: 0 6rpx 24rpx #16332915; }
.poster-canvas { position: fixed; left: -2000px; top: 0; pointer-events: none; }
</style>
