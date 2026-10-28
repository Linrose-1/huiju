<script setup lang="ts">
/* global HTMLInputElement, Event */
import { ref } from 'vue'
import { advertisingApi, type AdvertisingImage } from '../../services/advertising'
import { errorMessage } from '../../services/admin'
import { useRequestScope } from '../../services/request-scope'
import { readImage } from './crop'
import ImageCropper from './ImageCropper.vue'
const props = defineProps<{ url?: string | null; ratio?: 2 | 3; disabled?: boolean; sourceUrl?: string | null; sourceId?: string | null }>()
const emit = defineEmits<{ uploaded: [image: AdvertisingImage]; busy: [busy: boolean] }>()
const busy = ref(false), error = ref(''), cropSource = ref(''), originalId = ref<string>(), input = ref<HTMLInputElement>()
const begin = useRequestScope()
async function select(event: Event) {
  const field = event.target as HTMLInputElement, file = field.files?.[0]; field.value = ''
  if (!file || busy.value || props.disabled) return
  const current = begin(); busy.value = true; emit('busy', true); error.value = ''
  try {
    const { dataUrl } = await readImage(file); if (!current()) return
    const result = await advertisingApi.upload({ base64: dataUrl.split(',')[1]!, mimeType: file.type as 'image/png' | 'image/jpeg', purpose: props.ratio ? 'source' : 'detail' })
    if (!current()) return
    if (props.ratio) { originalId.value = result.id; cropSource.value = dataUrl }
    else emit('uploaded', result)
  } catch (e) { if (current()) error.value = errorMessage(e) }
  finally { if (current()) { busy.value = false; emit('busy', Boolean(cropSource.value)) } }
}
function recrop() { if (!props.sourceUrl || !props.sourceId || busy.value || props.disabled) return; originalId.value = props.sourceId; cropSource.value = props.sourceUrl; emit('busy', true) }
function cancelCrop() { if (busy.value) return; cropSource.value = ''; emit('busy', false) }
async function confirm(value: { base64: string; mimeType: 'image/jpeg' }) {
  if (busy.value) return
  const current = begin(); busy.value = true; emit('busy', true); error.value = ''
  try { const result = await advertisingApi.upload({ ...value, purpose: props.ratio === 3 ? 'wide' : 'tall', sourceImageId: originalId.value }); if (current()) { emit('uploaded', result); cropSource.value = '' } }
  catch (e) { if (current()) error.value = errorMessage(e) }
  finally { if (current()) { busy.value = false; emit('busy', Boolean(cropSource.value)) } }
}
</script>
<template>
  <div class="image-field">
    <img
      v-if="url"
      :src="url"
      alt="当前图片"
      :style="ratio ? { aspectRatio: String(ratio), objectFit: 'cover' } : {}"
    >
    <div class="actions">
      <el-button
        :loading="busy"
        :disabled="disabled || busy"
        @click="input?.click()"
      >
        {{ url ? '更换图片' : '选择图片' }}
      </el-button><el-button
        v-if="sourceUrl && sourceId && ratio"
        :disabled="disabled || busy"
        @click="recrop"
      >
        重新裁剪
      </el-button>
    </div>
    <input
      ref="input"
      type="file"
      accept="image/png,image/jpeg"
      hidden
      @change="select"
    >
    <p class="muted">
      PNG/JPG，最大 5 MB{{ ratio ? `；宽高比 ${ratio}:1，上传后裁剪` : '；完整保留图片比例' }}。
    </p>
    <el-alert
      v-if="error"
      :title="error"
      type="error"
      :closable="false"
    />
    <ImageCropper
      v-if="cropSource && ratio"
      :source="cropSource"
      :ratio="ratio"
      :saving="busy"
      @cancel="cancelCrop"
      @confirm="confirm"
    />
    <p
      v-if="busy"
      role="status"
    >
      正在处理图片，请稍候…
    </p>
  </div>
</template>
<style scoped>.image-field img{display:block;max-width:100%;width:100%;max-height:320px;object-fit:contain;border-radius:8px;margin-bottom:12px}.image-field p{font-size:12px;margin:8px 0}</style>
