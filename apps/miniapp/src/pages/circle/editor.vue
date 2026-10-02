<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import { onLoad, onShow, onHide, onUnload } from '@dcloudio/uni-app'
import { api, errorMessage } from '@/services/api'
import type { CirclePost, CircleWriteInput } from '@/services/api/types'
import { useSessionStore } from '@/stores/session'
import { routes, navigate, requireProfile } from '@/services/navigation'
import { circleCategories, circleSubtypes, circleImagePreview, newRequestId } from '@/services/circle'
import { chooseCircleImages } from '@/services/circle-images'
import RequestState from '@/components/base/RequestState.vue'
const session = useSessionStore(), id = ref(''), post = ref<CirclePost|null>(null), loading = ref(false), error = ref(''), actionError = ref(''), busy = ref(false), picking = ref(false)
const category = ref<CircleWriteInput['category']>('park'), subtype = ref<CircleWriteInput['subtype']>('rent'), title = ref(''), body = ref(''), location = ref(''), area = ref(''), price = ref(''), validUntil = ref(''), storeName = ref('')
type Picture = { key: string; id?: string; path: string; base64?: string; mimeType?: 'image/png'|'image/jpeg'; failed?: boolean }
const images = ref<Picture[]>([]), pendingWrite = ref<CircleWriteInput|null>(null)
const locked = computed(() => busy.value || picking.value || !!pendingWrite.value || post.value?.state === 'ended')
const readyToken = ref<string|null>(null)
let version = 0, visible = false, formOwnerToken = '', formOwnerEpoch = -1
function reset() { version++; readyToken.value = null; formOwnerToken = ''; formOwnerEpoch = -1; post.value = null; images.value = []; pendingWrite.value = null; category.value = 'park'; subtype.value = 'rent'; title.value = ''; body.value = ''; location.value = ''; area.value = ''; price.value = ''; validUntil.value = ''; storeName.value = ''; busy.value = false; picking.value = false; error.value = ''; actionError.value = ''; loading.value = false }
watch(() => [session.token, session.epoch], () => { reset(); if (visible) void load() }, { flush:'sync' })
async function load() {
  const current = ++version
  loading.value = true; error.value = ''
  try {
    if (!await requireProfile(routes.circleEditor + (id.value?'?id='+encodeURIComponent(id.value):''))) return
    if (!visible || current !== version) return
    if (readyToken.value === session.token) return
    const token = session.token, epoch = session.epoch
    if (id.value) {
      const value = await api.circlePost(id.value, true)
      if (current !== version || token !== session.token || epoch !== session.epoch || !visible) return
      const pictures = await Promise.all(value.images.map(async image => ({key:image.id,id:image.id,path:await circleImagePreview(image.url,value.state==='removed')})))
      if (current !== version || token !== session.token || epoch !== session.epoch || !visible) return
      post.value = value; category.value = value.category; subtype.value = value.subtype as CircleWriteInput['subtype']; title.value = value.title; body.value = value.body; location.value = value.location || ''; area.value = value.area || ''; price.value = value.price || ''; validUntil.value = value.validUntil || ''; storeName.value = value.storeName || ''; images.value = pictures
    }
    readyToken.value = token; formOwnerToken = token; formOwnerEpoch = epoch
  } catch (e) { if (visible && current === version) error.value = errorMessage(e) }
  finally { if (visible && current === version) loading.value = false }
}
async function pick() {
  if (locked.value || images.value.length >= 6) return
  const token = session.token, epoch = session.epoch, current = version
  picking.value = true; actionError.value = ''
  try {
    const chosen = await chooseCircleImages(6-images.value.length)
    if (token !== session.token || epoch !== session.epoch || current !== version) return
    images.value.push(...chosen.slice(0,6-images.value.length).map(x => ({key:newRequestId(),...x})))
  } catch(e) { if (current===version) actionError.value=errorMessage(e) }
  finally { if(current===version) picking.value=false }
}
function remove(index:number) { if(!locked.value) images.value.splice(index,1) }
function validate() {
  if (!title.value.trim() || !body.value.trim()) return '请填写标题和正文'
  if (category.value === 'store' && !storeName.value.trim()) return '请填写门店名称'
  if (category.value === 'park' && !subtype.value) return '请选择园区资源类型'
  return ''
}
async function save() {
  if (busy.value || picking.value || post.value?.state === 'ended' || readyToken.value === null) return
  actionError.value = validate(); if(actionError.value) return
  // Guard the form owner before refreshing profile: navigation during refresh must not submit a reset form.
  const token = session.token, epoch = session.epoch, current = version
  const valid = () => token === session.token && epoch === session.epoch && current === version && visible && token === formOwnerToken && epoch === formOwnerEpoch
  busy.value=true
  try {
    if (!await requireProfile(routes.circleEditor + (id.value?'?id='+encodeURIComponent(id.value):'')) || !valid()) return
    if (!pendingWrite.value) {
      for(const picture of images.value) {
        if(picture.id) continue
        picture.failed=false
        try { const result = await api.uploadCircleImage(picture.base64!,picture.mimeType!); if(!valid()) return; picture.id=result.id; picture.base64=undefined }
        catch(e) { if(valid()) picture.failed=true; throw e }
      }
      pendingWrite.value = {requestId:newRequestId(),category:category.value,subtype:category.value==='park'?subtype.value:null,title:title.value.trim(),body:body.value.trim(),location:location.value.trim()||null,area:category.value==='park'?area.value.trim()||null:null,price:category.value==='park'?price.value.trim()||null:null,validUntil:category.value==='park'?validUntil.value||null:null,storeName:category.value==='store'?storeName.value.trim():null,imageIds:images.value.map(x=>x.id!)}
    }
    const value = await api.saveCirclePost(pendingWrite.value,id.value)
    if(!valid()) return
    pendingWrite.value=null; readyToken.value=null
    uni.showToast({title:value.state==='removed'?'修改已保存，仍为下架状态':'保存成功',icon:'none'})
    navigate(value.state==='removed'?routes.circleMine:routes.circleDetail+'?id='+encodeURIComponent(value.id),true)
  } catch(e) { if(valid()) {actionError.value=errorMessage(e);if(typeof e==='object' && e && 'status' in e && Number(e.status)>=400 && Number(e.status)<500) pendingWrite.value=null} }
  finally {if(current===version) busy.value=false}
}
onLoad(options=>{id.value=String(options?.id||'')})
onShow(()=>{visible=true;if(!picking.value)void load()})
// The native album/camera can hide this page; keep its selection alive until return.
onHide(()=>{visible=false;if(picking.value)return;version++;busy.value=false;loading.value=false})
onUnload(()=>{visible=false;reset()})
</script>
<template>
  <view class="circle-page circle-safe circle-editor">
    <RequestState
      :loading="loading"
      :error="error"
      @retry="load"
    />
    <template v-if="!loading && !error && readyToken !== null">
      <view
        v-if="post?.state==='removed'"
        class="circle-card circle-copy"
      >
        帖子已下架：{{ post.removalReason }}。修改后仍保持下架，由后台决定是否恢复。
      </view>
      <view
        v-if="post?.state==='ended'"
        class="circle-card circle-copy"
      >
        帖子已结束，暂不支持编辑。
      </view>
      <view class="circle-chips editor-category">
        <view
          v-for="item in circleCategories"
          :key="item.key"
          class="circle-chip"
          :class="{selected:category===item.key}"
          @tap="!locked && (category=item.key)"
        >
          {{ item.label }}
        </view>
      </view>
      <view
        v-if="category==='park'"
        class="editor-subtype"
      >
        <view class="circle-chips">
          <view
            v-for="item in circleSubtypes"
            :key="item.key"
            class="circle-chip"
            :class="{selected:subtype===item.key}"
            @tap="!locked && (subtype=item.key)"
          >
            {{ item.label }}
          </view>
        </view>
      </view>
      <view class="editor-form">
        <view class="circle-field">
          <view class="circle-field-label">标题 <text class="circle-required">*</text></view><input
            v-model="title"
            class="input"
            :maxlength="200"
            :disabled="locked"
            placeholder="简洁说明你想发布的资源"
          >
        </view>
        <view class="circle-field">
          <view class="circle-field-label">正文 <text class="circle-required">*</text></view><textarea
            v-model="body"
            class="input"
            :maxlength="10000"
            :disabled="locked"
            placeholder="介绍资源情况、需求和合作方式"
          />
        </view>
        <view class="circle-field">
          <view class="circle-field-label">地点 <text class="circle-muted">（选填）</text></view><input
            v-model="location"
            class="input"
            :maxlength="500"
            :disabled="locked"
            placeholder="选填，例如园区、区域或地址"
          >
        </view>
        <template v-if="category==='park'">
          <view class="circle-field">
            <view class="circle-field-label">面积 <text class="circle-muted">（选填）</text></view><input
              v-model="area"
              class="input"
              :maxlength="100"
              :disabled="locked"
              placeholder="选填，例如 200㎡"
            >
          </view><view class="circle-field">
            <view class="circle-field-label">报价或预算 <text class="circle-muted">（选填）</text></view><input
              v-model="price"
              class="input"
              :maxlength="200"
              :disabled="locked"
              placeholder="选填，例如 5000元/月、面议"
            >
          </view><view class="circle-field">
            <view class="circle-field-label">有效期 <text class="circle-muted">（选填）</text></view><picker
              mode="date"
              :value="validUntil"
              :disabled="locked"
              @change="validUntil=$event.detail.value"
            >
              <view class="input date-field">{{ validUntil || '选填，选择日期' }}</view>
            </picker><text
              v-if="validUntil && !locked"
              class="circle-muted"
              @tap="validUntil=''"
            >
              清除日期
            </text>
          </view>
        </template>
        <view
          v-if="category==='store'"
          class="circle-field"
        >
          <view class="circle-field-label">门店名称 <text class="circle-required">*</text></view><input
            v-model="storeName"
            class="input"
            :maxlength="200"
            :disabled="locked"
            placeholder="填写门店名称"
          >
        </view>
        <view class="circle-field editor-image-field">
          <view class="circle-field-label">图片 <text class="circle-muted">（选填，{{ images.length }}/6，每张不超过 2 MB）</text></view><view class="circle-images">
            <view
              v-for="(picture,index) in images"
              :key="picture.key"
              class="circle-image-tile"
            >
              <image
                :src="picture.path"
                mode="aspectFill"
              /><view
                v-if="!locked"
                class="circle-remove"
                @tap="remove(index)"
              >
                ×
              </view><view
                v-if="picture.failed"
                class="circle-upload-state"
              >
                上传失败，可重试
              </view>
            </view><view
              v-if="images.length<6 && !locked"
              class="circle-image-tile"
              @tap="pick"
            >
              <text class="image-plus">＋</text><text>添加图片</text>
            </view>
          </view>
        </view>
      </view>
      <view class="circle-muted">发布后将直接展示在学友圈。请确认内容真实，联系电话通过意向确认单独提供。</view><view
        v-if="pendingWrite"
        class="circle-muted"
      >
        上次提交结果尚未确认，请使用原内容重试，避免重复发布。
      </view><view
        v-if="actionError"
        class="circle-error"
      >
        {{ actionError }}
      </view>
      <view class="circle-footer">
        <button
          class="btn-primary"
          :disabled="busy || picking || post?.state==='ended'"
          :loading="busy"
          @tap="save"
        >
          {{ pendingWrite?'重试保存':id?'保存修改':'发布帖子' }}
        </button>
      </view>
    </template>
  </view>
</template>
<style lang="scss">@import './circle.scss';</style>
<style scoped>.date-field{display:flex;align-items:center}.image-plus{font-size:55rpx;line-height:1.2;margin-bottom:8rpx}.circle-image-tile{font-size:24rpx}</style>
<style scoped>
.editor-category,.editor-subtype{background:#fff;border-radius:22rpx;padding:20rpx;margin-bottom:18rpx}.editor-category .circle-chip{font-size:25rpx;border-radius:16rpx;padding:18rpx 0}.editor-subtype .circle-chips{margin:0}.editor-subtype .circle-chip{border-radius:16rpx}.editor-form{background:#fff;border-radius:22rpx;padding:4rpx 20rpx 24rpx;margin-bottom:20rpx}.editor-form .circle-field{display:flex;gap:14rpx;align-items:flex-start;margin:22rpx 0}.editor-form .circle-field-label{flex-shrink:0;width:150rpx;font-size:26rpx;padding-top:20rpx;margin:0;line-height:1.6}.editor-form .circle-field-label .circle-muted{font-size:21rpx;display:block}.editor-form .input{flex:1;min-width:0;font-size:26rpx;height:76rpx}.editor-form textarea.input{height:220rpx;padding:16rpx}.editor-form picker{flex:1;min-width:0}.editor-form .editor-image-field{display:block}.editor-image-field .circle-field-label{width:auto;padding:0;margin-bottom:16rpx}.editor-image-field .circle-field-label .circle-muted{display:inline}.circle-editor .circle-footer{background:#f3f9f6}.circle-editor .circle-footer button{border-radius:24rpx}
</style>
