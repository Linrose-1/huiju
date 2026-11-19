<script setup lang="ts">
/* global BeforeUnloadEvent, window */
import { computed, nextTick, onBeforeUnmount, ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { advertisingApi, type AdvertisingIntroduction, type AdvertisingImage, type IntroductionInput } from '../../services/advertising'
import { errorMessage } from '../../services/admin'
import { useRequestScope } from '../../services/request-scope'
import AdImageField from './AdImageField.vue'
const props = defineProps<{ initial?: AdvertisingIntroduction }>()
const emit = defineEmits<{ saved: [value: AdvertisingIntroduction]; close: [] }>()
const initial = props.initial
const form = ref<IntroductionInput>({ name: initial?.name || '', companyName: initial?.companyName || '', contactName: initial?.contactName || '', phone: initial?.phone || '', wechatId: initial?.wechatId || '', summary: initial?.summary || '', coverImageId: initial?.coverImageId || null, blocks: initial?.blocks.map(b => ({ type: b.type, text: b.text, imageId: b.imageId })) || [{ type: 'text', text: '' }] })
const coverUrl = ref(initial?.coverImageUrl || ''), coverSourceUrl = ref(initial?.coverSourceImageUrl || ''), coverSourceId = ref(initial?.coverSourceImageId || '')
const imageUrls = ref<Record<string, string>>(Object.fromEntries((initial?.blocks || []).filter(b => b.imageId).map(b => [b.imageId!, b.imageUrl || ''])))
const baseline = ref(JSON.stringify(form.value)), dirty = computed(() => JSON.stringify(form.value) !== baseline.value)
const saving = ref(false), uploading = ref(false), error = ref(''), version = ref(initial?.version || 0)
const phoneError = ref('')
const phoneInput = ref<{ focus: () => void }>()
const uncertain = ref<IntroductionInput>()
const statusNames = { draft: '草稿', published: '已上架', offline: '已下架' }
const textFields = ['name', 'companyName', 'contactName', 'phone', 'wechatId', 'summary'] as const
const begin = useRequestScope()
function normalized(value: IntroductionInput) {
  return [
    ...textFields.map(key => value[key].trim()),
    value.coverImageId,
    value.blocks.map(block => block.type === 'text' ? ['text', block.text?.trim()] : ['image', block.imageId]),
  ]
}
function finishSave(result: AdvertisingIntroduction) {
  baseline.value = JSON.stringify(form.value)
  version.value = result.version
  ElMessage.success('介绍内容已保存')
  emit('saved', result)
}
async function reconcile() {
  if (!initial || !uncertain.value || saving.value) return
  const current = begin(), submitted = uncertain.value
  saving.value = true
  try {
    const latest = await advertisingApi.introduction(initial.id)
    if (!current()) return
    if (latest.version === version.value) {
      uncertain.value = undefined
      error.value = '服务器未保存这次修改，可以重新保存。'
    } else if (JSON.stringify(normalized(latest)) === JSON.stringify(normalized(submitted))) {
      if (JSON.stringify(form.value) === JSON.stringify(submitted)) {
        finishSave(latest)
      } else {
        baseline.value = JSON.stringify(submitted)
        version.value = latest.version
        uncertain.value = undefined
        error.value = '上一次修改已保存。随后填写的内容仍保留，可以继续保存。'
      }
    } else {
      error.value = '服务器已有不同版本。当前内容仍保留，请复制需要的修改后重新打开介绍。'
    }
  } catch {
    if (current()) error.value = '暂时无法核对保存结果。当前内容仍保留，请稍后再核对。'
  } finally { if (current()) saving.value = false }
}
function cover(image: AdvertisingImage) { form.value.coverImageId = image.id; coverUrl.value = image.url; coverSourceUrl.value = image.sourceImageUrl || ''; coverSourceId.value = image.sourceImageId || '' }
function blockImage(index: number, image: AdvertisingImage) { const block = form.value.blocks[index]; if (block) { block.imageId = image.id; imageUrls.value[image.id] = image.url } }
function add(type: 'text' | 'image') { if (form.value.blocks.length < 50) form.value.blocks.push(type === 'text' ? { type, text: '' } : { type }) }
function move(index: number, direction: number) { const target = index + direction; if (target < 0 || target >= form.value.blocks.length) return; const blocks = form.value.blocks; [blocks[index], blocks[target]] = [blocks[target]!, blocks[index]!] }
async function close() {
  if (saving.value || uploading.value) return
  if (dirty.value) { try { await ElMessageBox.confirm('介绍内容尚未保存，确定放弃修改？', '离开编辑', { type: 'warning' }) } catch { return } }
  emit('close')
}
async function save() {
  if (saving.value || uploading.value || uncertain.value) return
  error.value = ''
  phoneError.value = ''
  if (![form.value.name, form.value.companyName, form.value.contactName].every(v => v.trim()) || (!form.value.phone.trim() && !form.value.wechatId.trim())) { error.value = '请填写项目名称、企业名称、联系人，以及电话或微信号。'; return }
  if (!form.value.coverImageId || !form.value.blocks.length || form.value.blocks.some(b => b.type === 'text' ? !b.text?.trim() : !b.imageId)) { error.value = '请设置封面，并完成每一段介绍文字或图片。'; return }
  const current = begin(); saving.value = true
  const submitted = JSON.parse(JSON.stringify(form.value)) as IntroductionInput
  try {
    if (initial?.status === 'published') { try { await ElMessageBox.confirm('保存将立即更新所有关联广告展示的介绍内容，是否继续？', '更新已公开内容', { type: 'warning' }) } catch { return } }
    if (!current()) return
    const result = initial ? await advertisingApi.updateIntroduction(initial.id, { ...submitted, version: version.value }) : await advertisingApi.createIntroduction(submitted)
    if (current()) finishSave(result)
  } catch (e) {
    if (!current()) return
    const phone = submitted.phone.trim()
    if (e && typeof e === 'object' && 'code' in e && e.code === 'ADVERTISING_INVALID' && phone && !/^[+\d][\d ()-]{4,39}$/.test(phone)) {
      phoneError.value = '联系电话格式不正确。可填写数字、空格、括号、连字符或开头的 +。'
    } else if (errorMessage(e) === '网络连接失败，请检查网络后重试。' || (e && typeof e === 'object' && 'status' in e && Number(e.status) >= 500)) {
      uncertain.value = submitted
      error.value = initial ? '未能确认保存结果。当前内容仍保留，请先核对服务器记录。' : '未能确认草稿是否已保存。请先到列表按项目名称核对，避免重复创建。'
    } else error.value = errorMessage(e)
  }
  finally { if (current()) saving.value = false }
  if (current() && phoneError.value) {
    await nextTick()
    if (current()) phoneInput.value?.focus()
  }
}
function beforeUnload(event: BeforeUnloadEvent) { if (dirty.value || saving.value || uploading.value) { event.preventDefault(); event.returnValue = '' } }
window.addEventListener('beforeunload', beforeUnload)
onBeforeUnmount(() => window.removeEventListener('beforeunload', beforeUnload))
defineExpose({ dirty, close, locked: computed(() => saving.value || uploading.value) })
</script>
<template>
  <el-dialog
    :model-value="true"
    width="min(1080px, 94vw)"
    :close-on-click-modal="false"
    :before-close="close"
  >
    <template #header="{ titleId }">
      <div class="intro-editor-heading">
        <h2 :id="titleId">
          {{ initial ? '编辑介绍内容' : '新建介绍内容' }}
        </h2>
        <el-tag :type="initial?.status === 'published' ? 'success' : 'info'">
          {{ statusNames[initial?.status ?? 'draft'] }}
        </el-tag>
      </div>
    </template>
    <el-alert
      v-if="error"
      :title="error"
      type="error"
      :closable="false"
      class="form-error"
    />
    <el-button
      v-if="uncertain && initial"
      class="reconcile"
      :loading="saving"
      @click="reconcile"
    >
      核对保存结果
    </el-button>
    <el-form
      label-position="top"
      :disabled="saving || uploading"
      @submit.prevent="save"
    >
      <div class="intro-grid">
        <div>
          <h3>基本信息</h3>
          <div class="contact-grid">
            <el-form-item label="项目名称 *">
              <el-input
                v-model="form.name"
                :maxlength="100"
                show-word-limit
              />
            </el-form-item>
            <el-form-item label="企业名称 *">
              <el-input
                v-model="form.companyName"
                :maxlength="200"
              />
            </el-form-item>
          </div>
          <el-form-item label="联系人 *">
            <el-input
              v-model="form.contactName"
              :maxlength="100"
            />
          </el-form-item>
          <div class="contact-grid">
            <el-form-item
              label="联系电话"
              :error="phoneError"
            >
              <el-input
                ref="phoneInput"
                v-model="form.phone"
                :maxlength="40"
                @input="phoneError = ''"
              />
            </el-form-item><el-form-item label="微信号">
              <el-input
                v-model="form.wechatId"
                :maxlength="100"
              />
            </el-form-item>
          </div>
          <p class="muted contact-hint">
            电话与微信至少填写一项。上架后将公开展示商务联系方式。
          </p>
          <el-form-item label="简介">
            <el-input
              v-model="form.summary"
              type="textarea"
              :rows="2"
              :maxlength="500"
              show-word-limit
            />
          </el-form-item>
          <h3 class="intro-section">
            介绍详情 *
          </h3><p class="muted">
            文字和图片按顺序展示，图片保持完整比例。
          </p>
          <div
            v-for="(block, index) in form.blocks"
            :key="index"
            class="block"
          >
            <div class="toolbar">
              <strong>{{ index + 1 }} · {{ block.type === 'text' ? '文字' : '图片' }}</strong><div>
                <el-button
                  :disabled="index === 0 || uploading"
                  text
                  @click="move(index, -1)"
                >
                  上移
                </el-button><el-button
                  :disabled="index === form.blocks.length - 1 || uploading"
                  text
                  @click="move(index, 1)"
                >
                  下移
                </el-button><el-button
                  text
                  :disabled="uploading"
                  @click="form.blocks.splice(index, 1)"
                >
                  移除
                </el-button>
              </div>
            </div>
            <el-input
              v-if="block.type === 'text'"
              v-model="block.text"
              type="textarea"
              :rows="4"
              :maxlength="5000"
              show-word-limit
            />
            <AdImageField
              v-else
              :url="block.imageId ? imageUrls[block.imageId] : ''"
              :disabled="saving || uploading"
              @busy="uploading = $event"
              @uploaded="blockImage(index, $event)"
            />
          </div><div class="actions">
            <el-button
              :disabled="form.blocks.length >= 50"
              @click="add('text')"
            >
              添加文字
            </el-button><el-button
              :disabled="form.blocks.length >= 50"
              @click="add('image')"
            >
              添加图片
            </el-button>
          </div>
        </div><aside class="cover">
          <h3>展示预览</h3>
          <article class="editor-preview">
            <img
              v-if="coverUrl"
              :src="coverUrl"
              class="editor-preview-cover"
              alt="介绍封面预览"
            >
            <div
              v-else
              class="editor-preview-empty"
            >
              尚未选择封面
            </div>
            <div class="editor-preview-copy">
              <h4>{{ form.name || '项目名称' }}</h4>
              <p
                v-if="form.companyName"
                class="muted"
              >
                {{ form.companyName }}
              </p>
              <p v-if="form.summary">
                {{ form.summary }}
              </p>
              <template
                v-for="(block, index) in form.blocks"
                :key="index"
              >
                <p v-if="block.type === 'text' && block.text">
                  {{ block.text }}
                </p>
                <img
                  v-else-if="block.imageId && imageUrls[block.imageId]"
                  :src="imageUrls[block.imageId]"
                  alt="介绍图片预览"
                >
              </template>
              <h4 v-if="form.contactName">
                联系项目方
              </h4>
              <p v-if="form.contactName">
                {{ form.contactName }}
              </p>
              <p v-if="form.phone">
                电话 {{ form.phone }}
              </p>
              <p v-if="form.wechatId">
                微信 {{ form.wechatId }}
              </p>
            </div>
          </article>
          <h4>介绍封面 · 2:1</h4><AdImageField
            :url="coverUrl"
            :ratio="2"
            :source-url="coverSourceUrl"
            :source-id="coverSourceId"
            :disabled="saving || uploading"
            @busy="uploading = $event"
            @uploaded="cover"
          />
        </aside>
      </div>
    </el-form>
    <template #footer>
      <div class="intro-editor-footer">
        <span
          class="muted"
          role="status"
        >{{ phoneError ? '保存失败，当前修改仍保留。' : dirty ? '修改尚未保存' : '' }}</span>
        <div>
          <el-button
            :disabled="saving || uploading"
            @click="close"
          >
            取消
          </el-button><el-button
            type="primary"
            :loading="saving"
            :disabled="uploading || !!uncertain"
            @click="save"
          >
            {{ initial ? '保存介绍内容' : '保存草稿' }}
          </el-button>
        </div>
      </div>
    </template>
  </el-dialog>
</template>
<style scoped>
.intro-editor-heading, .intro-editor-footer { display: flex; align-items: center; flex-wrap: wrap; gap: 10px; }
.intro-editor-heading h2 { margin: 0; font-size: 18px; }
.intro-editor-footer { justify-content: space-between; border-top: 1px solid var(--el-border-color-light); padding-top: 12px; }
.intro-editor-footer > div { margin-left: auto; }
.intro-grid { display: grid; grid-template-columns: minmax(0, 1.2fr) minmax(0, 1fr); gap: 22px; max-height: min(70vh, 760px); overflow: auto; padding: 2px 4px 4px 0; }
.intro-grid h3 { margin: 0 0 12px; }
.contact-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; align-items: start; }
.contact-hint { margin: 0 0 12px; }
.intro-grid .intro-section { border-top: 1px solid var(--el-border-color-light); padding-top: 14px; }
.cover { min-width: 0; border-left: 1px solid var(--el-border-color-light); padding-left: 20px; }
.editor-preview { border: 1px solid var(--el-border-color-light); border-radius: 8px; overflow: hidden; }
.editor-preview img { display: block; width: 100%; height: auto; }
.editor-preview-cover, .editor-preview-empty { aspect-ratio: 2; object-fit: cover; }
.editor-preview-empty { display: grid; place-items: center; background: var(--el-fill-color-light); }
.editor-preview-copy { padding: 12px; overflow-wrap: anywhere; white-space: pre-wrap; }
.editor-preview-copy h4, .editor-preview-copy p { margin: 0 0 8px; }
.block { padding: 12px; border: 1px solid var(--huiju-border); border-radius: 8px; margin-bottom: 12px; }
.block .toolbar { margin-bottom: 8px; }
.muted { font-size: 12px; }
.reconcile { margin-bottom: 12px; }
@media (max-width: 760px) {
  .intro-grid, .contact-grid { grid-template-columns: minmax(0, 1fr); }
  .cover { border-left: 0; padding-left: 0; }
}
</style>
