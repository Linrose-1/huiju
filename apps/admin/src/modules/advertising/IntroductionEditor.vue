<script setup lang="ts">
/* global BeforeUnloadEvent, window */
import { computed, onBeforeUnmount, ref } from 'vue'
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
const begin = useRequestScope()
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
  if (saving.value || uploading.value) return
  error.value = ''
  if (![form.value.name, form.value.companyName, form.value.contactName].every(v => v.trim()) || (!form.value.phone.trim() && !form.value.wechatId.trim())) { error.value = '请填写项目名称、企业名称、联系人，以及电话或微信号。'; return }
  if (!form.value.coverImageId || !form.value.blocks.length || form.value.blocks.some(b => b.type === 'text' ? !b.text?.trim() : !b.imageId)) { error.value = '请设置封面，并完成每一段介绍文字或图片。'; return }
  if (initial?.status === 'published') { try { await ElMessageBox.confirm('保存将立即更新所有关联广告展示的介绍内容，是否继续？', '更新已公开内容', { type: 'warning' }) } catch { return } }
  const current = begin(); saving.value = true
  try { const result = initial ? await advertisingApi.updateIntroduction(initial.id, { ...form.value, version: version.value }) : await advertisingApi.createIntroduction(form.value); if (current()) { baseline.value = JSON.stringify(form.value); version.value = result.version; ElMessage.success('介绍内容已保存'); emit('saved', result) } }
  catch (e) { if (current()) error.value = errorMessage(e) }
  finally { if (current()) saving.value = false }
}
function beforeUnload(event: BeforeUnloadEvent) { if (dirty.value || saving.value || uploading.value) { event.preventDefault(); event.returnValue = '' } }
window.addEventListener('beforeunload', beforeUnload)
onBeforeUnmount(() => window.removeEventListener('beforeunload', beforeUnload))
defineExpose({ dirty, close, locked: computed(() => saving.value || uploading.value) })
</script>
<template>
  <el-dialog
    :model-value="true"
    :title="initial ? '编辑介绍内容' : '新建介绍内容'"
    width="1000px"
    :close-on-click-modal="false"
    :before-close="close"
  >
    <el-alert
      v-if="error"
      :title="error"
      type="error"
      :closable="false"
      class="form-error"
    />
    <el-form
      label-position="top"
      :disabled="saving || uploading"
      @submit.prevent="save"
    >
      <div class="intro-grid">
        <div>
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
          <el-form-item label="联系人 *">
            <el-input
              v-model="form.contactName"
              :maxlength="100"
            />
          </el-form-item>
          <div class="contact-grid">
            <el-form-item label="联系电话（与微信至少填写一项）">
              <el-input
                v-model="form.phone"
                :maxlength="40"
              />
            </el-form-item><el-form-item label="微信号">
              <el-input
                v-model="form.wechatId"
                :maxlength="100"
              />
            </el-form-item>
          </div>
          <el-form-item label="简介">
            <el-input
              v-model="form.summary"
              type="textarea"
              :rows="2"
              :maxlength="500"
              show-word-limit
            />
          </el-form-item>
          <h3>介绍详情 *</h3><p class="muted">
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
          <h3>介绍封面 · 2:1</h3><AdImageField
            :url="coverUrl"
            :ratio="2"
            :source-url="coverSourceUrl"
            :source-id="coverSourceId"
            :disabled="saving || uploading"
            @busy="uploading = $event"
            @uploaded="cover"
          /><p class="muted">
            联系方式将公开展示，请填写可公开的商务联系方式。
          </p>
        </aside>
      </div>
    </el-form>
    <template #footer>
      <el-button
        :disabled="saving || uploading"
        @click="close"
      >
        取消
      </el-button><el-button
        type="primary"
        :loading="saving"
        :disabled="uploading"
        @click="save"
      >
        {{ initial ? '保存介绍内容' : '保存草稿' }}
      </el-button>
    </template>
  </el-dialog>
</template>
<style scoped>.intro-grid{display:grid;grid-template-columns:minmax(0,1fr) 260px;gap:24px}.contact-grid{display:grid;grid-template-columns:1fr 1fr;gap:16px}.cover{padding:16px;background:#f2f7f3;border-radius:8px;height:max-content}.cover h3{margin-top:0}.block{padding:14px;border:1px solid var(--huiju-border);border-radius:8px;margin-bottom:14px}.block .toolbar{margin-bottom:8px}.muted{font-size:12px}@media(max-width:760px){.intro-grid,.contact-grid{grid-template-columns:1fr}}</style>
