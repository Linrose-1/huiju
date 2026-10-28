<script setup lang="ts">
/* global BeforeUnloadEvent, window */
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { advertisingApi, type AdvertisingAd, type AdvertisingIntroduction, type AdvertisingImage, type AdInput } from '../../services/advertising'
import { errorMessage } from '../../services/admin'
import { useRequestScope } from '../../services/request-scope'
import AdImageField from './AdImageField.vue'
import IntroductionEditor from './IntroductionEditor.vue'
const props = defineProps<{ initial?: AdvertisingAd }>()
const emit = defineEmits<{ saved: []; close: [] }>()
const initial = props.initial
const form = ref<AdInput>({ title: initial?.title || '', introductionId: initial?.introductionId || '', placements: [...initial?.placements || ['activity']], wideImageId: initial?.wideImageId || null, tallImageId: initial?.tallImageId || null, sortOrder: initial?.sortOrder || 0 })
const wide = ref({ url: initial?.wideImageUrl || '', sourceUrl: initial?.wideSourceImageUrl || '', sourceId: initial?.wideSourceImageId || '' })
const tall = ref({ url: initial?.tallImageUrl || '', sourceUrl: initial?.tallSourceImageUrl || '', sourceId: initial?.tallSourceImageId || '' })
const baseline = ref(JSON.stringify(form.value)), dirty = computed(() => baseline.value !== JSON.stringify(form.value))
const saving = ref(false), uploading = ref(false), error = ref(''), query = ref(''), offset = ref(0), total = ref(0), loading = ref(false), searchError = ref('')
const introductions = ref<AdvertisingIntroduction[]>([]), selected = ref<AdvertisingIntroduction>(), newIntroduction = ref(false)
const begin = useRequestScope(), beginSearch = useRequestScope()
const appliedQuery = ref('')
const needsWide = computed(() => form.value.placements.includes('circle'))
const needsTall = computed(() => form.value.placements.some(p => p === 'activity' || p === 'assistant'))
const previewImage = computed(() => needsTall.value && tall.value.url ? { url: tall.value.url, ratio: '2' } : needsWide.value && wide.value.url ? { url: wide.value.url, ratio: '3' } : null)
function image(kind: 'wide' | 'tall', value: AdvertisingImage) { form.value[kind === 'wide' ? 'wideImageId' : 'tallImageId'] = value.id; (kind === 'wide' ? wide : tall).value = { url: value.url, sourceUrl: value.sourceImageUrl || '', sourceId: value.sourceImageId || '' } }
async function search(reset = false) {
  if (reset) { offset.value = 0; appliedQuery.value = query.value.trim() }
  const current = beginSearch(); loading.value = true; searchError.value = ''
  try { const result = await advertisingApi.introductions({ q: appliedQuery.value, offset: offset.value, limit: 10, status: 'all' }); if (current()) { introductions.value = result.items; total.value = result.total } }
  catch (e) { if (current()) searchError.value = errorMessage(e) }
  finally { if (current()) loading.value = false }
}
function choose(value: AdvertisingIntroduction) { selected.value = value; form.value.introductionId = value.id }
function created(value: AdvertisingIntroduction) { choose(value); newIntroduction.value = false; void search(true) }
async function close() { if (saving.value || uploading.value || newIntroduction.value) return; if (dirty.value) { try { await ElMessageBox.confirm('广告尚未保存，确定放弃修改？', '离开编辑', { type: 'warning' }) } catch { return } } emit('close') }
async function save() {
  if (saving.value || uploading.value) return
  error.value = ''
  if (!form.value.title.trim() || !form.value.placements.length || !form.value.introductionId) { error.value = '请填写广告标题、展示位置并选择介绍内容。'; return }
  if (initial?.status === 'published') { try { await ElMessageBox.confirm('保存后立即更新已上架广告，是否继续？', '更新广告', { type: 'warning' }) } catch { return } }
  const current = begin(); saving.value = true
  try { if (initial) await advertisingApi.updateAd(initial.id, { ...form.value, version: initial.version }); else await advertisingApi.createAd(form.value); if (current()) { baseline.value = JSON.stringify(form.value); ElMessage.success('广告已保存'); emit('saved') } }
  catch (e) { if (current()) error.value = errorMessage(e) }
  finally { if (current()) saving.value = false }
}
function beforeUnload(event: BeforeUnloadEvent) { if (dirty.value || saving.value || uploading.value) { event.preventDefault(); event.returnValue = '' } }
window.addEventListener('beforeunload', beforeUnload); onBeforeUnmount(() => window.removeEventListener('beforeunload', beforeUnload))
onMounted(async () => { void search(); if (!form.value.introductionId) return; const current = begin(); try { const value = await advertisingApi.introduction(form.value.introductionId); if (current()) selected.value = value } catch (e) { if (current()) error.value = errorMessage(e) } })
defineExpose({ dirty, close, locked: computed(() => saving.value || uploading.value || newIntroduction.value) })
</script>
<template>
  <el-dialog
    :model-value="true"
    :title="initial ? '编辑广告' : '新建广告'"
    width="1050px"
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
      <div class="ad-grid">
        <div>
          <el-form-item label="广告标题 *">
            <el-input
              v-model="form.title"
              :maxlength="100"
              show-word-limit
            />
          </el-form-item>
          <el-form-item label="展示位置 *">
            <el-checkbox-group v-model="form.placements">
              <el-checkbox value="activity">
                活动 2:1
              </el-checkbox><el-checkbox value="circle">
                学友圈 3:1
              </el-checkbox><el-checkbox value="assistant">
                助手 2:1
              </el-checkbox>
            </el-checkbox-group>
          </el-form-item>
          <el-form-item
            v-if="needsWide"
            label="学友圈图片 · 3:1"
          >
            <AdImageField
              :url="wide.url"
              :ratio="3"
              :source-url="wide.sourceUrl"
              :source-id="wide.sourceId"
              :disabled="saving || uploading"
              @busy="uploading = $event"
              @uploaded="image('wide', $event)"
            />
          </el-form-item>
          <el-form-item
            v-if="needsTall"
            label="活动 / 助手图片 · 2:1"
          >
            <AdImageField
              :url="tall.url"
              :ratio="2"
              :source-url="tall.sourceUrl"
              :source-id="tall.sourceId"
              :disabled="saving || uploading"
              @busy="uploading = $event"
              @uploaded="image('tall', $event)"
            />
          </el-form-item>
          <el-form-item label="排序值（越小越靠前）">
            <el-input-number
              v-model="form.sortOrder"
              :min="-1000000"
              :max="1000000"
              :precision="0"
            />
          </el-form-item>
          <h3>关联介绍内容 *</h3><p
            v-if="selected"
            class="selected"
          >
            已选择：{{ selected.name }} · {{ selected.companyName }}
          </p>
          <div class="filters">
            <el-input
              v-model="query"
              placeholder="搜索项目或公司"
              :maxlength="100"
              style="width:240px"
              @keyup.enter="search(true)"
            /><el-button
              :loading="loading"
              @click="search(true)"
            >
              搜索
            </el-button><el-button @click="newIntroduction = true">
              新建介绍
            </el-button>
          </div>
          <el-alert
            v-if="searchError"
            :title="searchError"
            type="error"
            :closable="false"
          /><el-button
            v-if="searchError"
            @click="search()"
          >
            重试
          </el-button>
          <el-table
            v-loading="loading"
            :data="introductions"
            empty-text="没有匹配的介绍内容"
          >
            <el-table-column
              prop="name"
              label="项目名称"
            /><el-table-column
              prop="companyName"
              label="企业名称"
            /><el-table-column
              label="状态"
              width="100"
            >
              <template #default="{ row }">
                {{ row.status === 'published' ? '已上架' : row.status === 'draft' ? '草稿' : '已下架' }}
              </template>
            </el-table-column><el-table-column width="80">
              <template #default="{ row }">
                <el-button
                  text
                  :disabled="loading"
                  @click="choose(row)"
                >
                  {{ row.id === form.introductionId ? '已选择' : '选择' }}
                </el-button>
              </template>
            </el-table-column>
          </el-table>
          <div class="pagination">
            <span>共 {{ total }} 条</span><el-button
              :disabled="!offset || loading"
              @click="offset -= 10; search()"
            >
              上一页
            </el-button><el-button
              :disabled="offset + 10 >= total || loading"
              @click="offset += 10; search()"
            >
              下一页
            </el-button>
          </div>
        </div><aside class="preview">
          <h3>展示预览</h3><img
            v-if="previewImage"
            :src="previewImage.url"
            alt="广告图片预览"
            :style="{ aspectRatio: previewImage.ratio }"
          ><p class="muted">
            点击广告后进入：
          </p><h3>{{ selected?.name || '请先选择介绍内容' }}</h3><p>{{ selected?.companyName }}</p><p class="muted">
            {{ selected?.summary }}
          </p><p
            v-if="selected && selected.status !== 'published'"
            class="muted"
          >
            关联介绍尚未上架，须先在“介绍内容”列表上架，再上架广告。
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
        {{ initial ? '保存广告' : '保存草稿' }}
      </el-button>
    </template>
  </el-dialog>
  <IntroductionEditor
    v-if="newIntroduction"
    @close="newIntroduction = false"
    @saved="created"
  />
</template>
<style scoped>.ad-grid{display:grid;grid-template-columns:minmax(0,1fr) 250px;gap:24px}.preview{padding:16px;background:#f2f7f3;border-radius:8px;height:max-content}.preview h3{margin-top:0}.preview img{width:100%;object-fit:cover;border-radius:8px}.preview p{font-size:13px;overflow-wrap:anywhere}.selected{padding:12px;background:#eaf3ee;border-radius:8px;font-size:13px}.filters{margin-bottom:12px}@media(max-width:760px){.ad-grid{grid-template-columns:1fr}}</style>
