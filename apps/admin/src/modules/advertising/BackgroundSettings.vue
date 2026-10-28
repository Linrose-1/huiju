<script setup lang="ts">
/* global BeforeUnloadEvent, window */
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { onBeforeRouteLeave } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import { advertisingApi, type AdvertisingImage } from '../../services/advertising'
import { errorMessage } from '../../services/admin'
import { useRequestScope } from '../../services/request-scope'
import AdImageField from './AdImageField.vue'
const imageId = ref<string | null>(null), url = ref(''), sourceId = ref(''), sourceUrl = ref(''), version = ref(0)
const original = ref<string | null>(null), dirty = computed(() => original.value !== imageId.value)
const loaded = ref(false), loading = ref(false), saving = ref(false), uploading = ref(false), error = ref('')
const begin = useRequestScope()
function uploaded(image: AdvertisingImage) { imageId.value = image.id; url.value = image.url; sourceId.value = image.sourceImageId || ''; sourceUrl.value = image.sourceImageUrl || '' }
async function load() { const current = begin(); loading.value = true; error.value = ''; try { const value = await advertisingApi.background(); if (current()) { imageId.value = value.imageId; original.value = value.imageId; url.value = value.imageUrl || ''; sourceId.value = value.sourceImageId || ''; sourceUrl.value = value.sourceImageUrl || ''; version.value = value.version; loaded.value = true } } catch (e) { if (current()) error.value = errorMessage(e) } finally { if (current()) loading.value = false } }
async function save() {
  if (!loaded.value || loading.value || saving.value || uploading.value) return
  try { await ElMessageBox.confirm('确认替换小程序“我的”背景图？', '保存背景', { type: 'warning' }) } catch { return }
  const current = begin(); saving.value = true; error.value = ''
  try { const value = await advertisingApi.saveBackground(imageId.value, version.value); if (current()) { version.value = value.version; original.value = imageId.value; ElMessage.success('背景图已保存') } } catch (e) { if (current()) error.value = errorMessage(e) } finally { if (current()) saving.value = false }
}
async function leave() { if (saving.value || uploading.value) return false; if (!dirty.value) return true; try { await ElMessageBox.confirm('背景图尚未保存，确定放弃修改？', '离开编辑', { type: 'warning' }); return true } catch { return false } }
onBeforeRouteLeave(leave)
function beforeUnload(event: BeforeUnloadEvent) { if (dirty.value || saving.value || uploading.value) { event.preventDefault(); event.returnValue = '' } }
window.addEventListener('beforeunload', beforeUnload); onBeforeUnmount(() => window.removeEventListener('beforeunload', beforeUnload)); onMounted(load)
defineExpose({ leave })
</script>
<template>
  <div
    v-loading="loading"
    class="panel"
  >
    <h2>我的背景图</h2><p class="page-description">
      单张 3:1 背景，不设置广告跳转，不影响头像与资料入口。
    </p>
    <el-alert
      v-if="error"
      :title="error"
      type="error"
      :closable="false"
    /><el-button
      v-if="error && !loaded"
      @click="load"
    >
      重新加载
    </el-button>
    <div
      v-if="loaded"
      class="background-grid"
    >
      <div>
        <AdImageField
          :url="url"
          :ratio="3"
          :source-url="sourceUrl"
          :source-id="sourceId"
          :disabled="loading || saving || uploading"
          @busy="uploading = $event"
          @uploaded="uploaded"
        /><el-button
          type="primary"
          :disabled="!dirty || uploading"
          :loading="saving"
          @click="save"
        >
          保存背景图
        </el-button>
      </div><aside>
        <h3>个人资料叠加示意</h3><div
          class="mine-preview"
          :style="{ backgroundImage: url ? `url(${url})` : undefined }"
        >
          <div class="identity">
            用户名称<p>资料已完善  编辑资料 ›</p>
          </div>
        </div><p class="muted">
          当前图片将作为所有用户“我的”页背景。
        </p>
      </aside>
    </div>
  </div>
</template>
<style scoped>.background-grid{display:grid;grid-template-columns:minmax(0,640px) 300px;gap:24px}.background-grid aside{background:#f2f7f3;border-radius:8px;padding:16px;height:max-content}.background-grid h3{margin-top:0}.mine-preview{aspect-ratio:3;background-size:cover;background-position:center;background-color:#dbe9df;border-radius:8px}.identity{padding:20px;background:linear-gradient(#ffffffed,#ffffff20);height:100%;font-size:15px}.identity p,.muted{font-size:12px}@media(max-width:1000px){.background-grid{grid-template-columns:1fr}}</style>
