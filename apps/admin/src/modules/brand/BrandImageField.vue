<script setup lang="ts">
/* global Event, HTMLInputElement */
import { ref } from 'vue'
import { errorMessage } from '../../services/admin'
import { brandApi, type BrandImageInput } from '../../services/brand'
import { useRequestScope } from '../../services/request-scope'
import { readImage } from '../advertising/crop'

const props = defineProps<{ label: string; purpose: BrandImageInput['purpose']; disabled?: boolean }>()
const imageId = defineModel<string | null>({ required: true })
const emit = defineEmits<{ busy: [boolean] }>()
const input = ref<HTMLInputElement>()
const busy = ref(false), error = ref('')
const begin = useRequestScope()

async function select(event: Event) {
  const field = event.target as HTMLInputElement
  const file = field.files?.[0]
  field.value = ''
  if (!file || busy.value || props.disabled) return
  const current = begin()
  busy.value = true; emit('busy', true); error.value = ''
  try {
    if (file.size > 2 * 1024 * 1024) throw new Error('单张图片不能超过 2 MB。')
    const { dataUrl } = await readImage(file)
    if (!current()) return
    const result = await brandApi.uploadImage({
      base64: dataUrl.slice(dataUrl.indexOf(',') + 1),
      mimeType: file.type as BrandImageInput['mimeType'], purpose: props.purpose,
    })
    if (current()) imageId.value = result.id
  } catch (failure) {
    if (current()) error.value = errorMessage(failure)
  } finally {
    if (current()) { busy.value = false; emit('busy', false) }
  }
}
function remove() {
  if (props.disabled || busy.value) return
  imageId.value = null; error.value = ''
}
</script>

<template>
  <div class="brand-image-field">
    <span class="image-label">{{ label }}</span>
    <div class="image-row">
      <img
        v-if="imageId"
        :src="brandApi.imagePreview(imageId)"
        :alt="label"
        class="image-preview"
      >
      <div
        v-else
        class="image-preview empty-image"
      >
        未上传
      </div>
      <div>
        <el-button
          :loading="busy"
          :disabled="disabled || busy"
          :aria-label="(imageId ? '更换' : '上传') + label"
          @click="input?.click()"
        >
          {{ imageId ? '更换' : '上传图片' }}
        </el-button>
        <el-button
          v-if="imageId"
          link
          :disabled="disabled || busy"
          :aria-label="'移除' + label"
          @click="remove"
        >
          移除
        </el-button>
        <p class="muted image-help">
          PNG/JPG，最大 2 MB{{ purpose === 'code' ? '，保留原比例' : '' }}。
        </p>
      </div>
    </div>
    <input
      ref="input"
      type="file"
      accept="image/png,image/jpeg"
      hidden
      @change="select"
    >
    <p
      v-if="error"
      class="image-error"
      role="alert"
    >
      {{ error }}
    </p>
  </div>
</template>

<style scoped>
.image-label { display:block; margin-bottom:8px; font-size:14px; }
.image-row { display:flex; align-items:center; flex-wrap:wrap; gap:10px; }
.image-preview { width:64px; height:64px; border:1px solid var(--huiju-border); border-radius:8px; object-fit:contain; background:white; }
.empty-image { display:grid; place-items:center; border-style:dashed; color:var(--huiju-muted); font-size:12px; }
.image-help,.image-error { margin:6px 0 0; font-size:12px; }
.image-error { color:#a02c26; }
</style>
