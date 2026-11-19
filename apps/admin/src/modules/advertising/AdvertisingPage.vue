<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { onBeforeRouteLeave } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import { advertisingApi, type AdvertisingAd, type AdvertisingIntroduction, type Placement, type AdStatus } from '../../services/advertising'
import { errorMessage, formatDate } from '../../services/admin'
import { useRequestScope } from '../../services/request-scope'
import AdEditor from './AdEditor.vue'
import IntroductionEditor from './IntroductionEditor.vue'
import BackgroundSettings from './BackgroundSettings.vue'
const tab = ref<'ads' | 'introductions' | 'background'>('ads'), q = ref(''), status = ref<'all' | AdStatus>('all'), placement = ref<'all' | Placement>('all')
const displayedOffset = ref(0)
const offset = ref(0), total = ref(0), loading = ref(false), changing = ref(false), error = ref('')
const ads = ref<AdvertisingAd[]>([]), introductions = ref<AdvertisingIntroduction[]>([])
const adEditor = ref(false), introEditor = ref(false), editAd = ref<AdvertisingAd>(), editIntro = ref<AdvertisingIntroduction>(), preview = ref<AdvertisingIntroduction>()
const backgroundRef = ref<InstanceType<typeof BackgroundSettings>>(), adEditorRef = ref<InstanceType<typeof AdEditor>>(), introEditorRef = ref<InstanceType<typeof IntroductionEditor>>()
const begin = useRequestScope(), beginAction = useRequestScope()
const applied = ref({ q: '', status: 'all' as 'all' | AdStatus, placement: 'all' as 'all' | Placement })
const labels = { draft: '草稿', published: '已上架', offline: '已下架' }, positions = { activity: '活动', circle: '学友圈', assistant: '助手' }
const statusTypes = { draft: 'info', published: 'success', offline: 'info' } as const
async function load(reset = false) {
  if (reset) { displayedOffset.value = 0; ads.value = []; introductions.value = []; total.value = 0; offset.value = 0; applied.value = { q: q.value.trim(), status: status.value, placement: placement.value } }
  if (tab.value === 'background') return
  const current = begin(); loading.value = true; error.value = ''
  try { const query = { q: applied.value.q, status: applied.value.status, offset: offset.value, limit: 20 }; if (tab.value === 'ads') { const result = await advertisingApi.ads({ ...query, placement: applied.value.placement }); if (current()) { ads.value = result.items; total.value = result.total; displayedOffset.value = query.offset } } else { const result = await advertisingApi.introductions(query); if (current()) { introductions.value = result.items; total.value = result.total; displayedOffset.value = query.offset } } }
  catch (e) { if (current()) { error.value = errorMessage(e) } }
  finally { if (current()) loading.value = false }
}
async function selectTab(value: 'ads' | 'introductions' | 'background') {
  if (changing.value || value === tab.value) return
  if (tab.value === 'background' && backgroundRef.value && !(await backgroundRef.value.leave())) return
  begin(); loading.value = false; tab.value = value; q.value = ''; status.value = 'all'; placement.value = 'all'; ads.value = []; introductions.value = []; total.value = 0; error.value = ''; void load(true)
}
function openAd(value?: AdvertisingAd) { editAd.value = value; adEditor.value = true }
function openIntro(value?: AdvertisingIntroduction) { editIntro.value = value; introEditor.value = true }
function saved() { adEditor.value = false; introEditor.value = false; void load() }
async function changeStatus(row: AdvertisingAd | AdvertisingIntroduction) {
  if (changing.value || loading.value) return
  const next = row.status === 'published' ? 'offline' : 'published'
  const current = beginAction(), selectedTab = tab.value, id = row.id, version = row.version
  changing.value = true; error.value = ''
  try {
    if (selectedTab === 'ads' && next === 'published' && 'introductionId' in row) {
      const introduction = await advertisingApi.introduction(row.introductionId)
      if (!current()) return
      if (introduction.status !== 'published') {
        error.value = '请先上架关联介绍内容，再上架广告。'
        return
      }
    }
    const message = selectedTab === 'ads'
      ? next === 'published' ? '上架后，轮播图片将在所选首页展示。' : '下架后，轮播图片将停止展示，关联介绍保留。'
      : next === 'published' ? '确认上架？内容和商务联系方式将公开展示。' : '确认下架？介绍下架后，关联广告也将停止展示。'
    try { await ElMessageBox.confirm(message, next === 'published' ? '上架内容' : '下架内容', { type: 'warning' }) } catch { return }
    if (!current()) return
    if (selectedTab === 'ads') await advertisingApi.adStatus(id, version, next); else await advertisingApi.introductionStatus(id, version, next)
    if (current()) { ElMessage.success(next === 'published' ? '已上架' : '已下架'); void load() }
  } catch (e) { if (current()) error.value = errorMessage(e) }
  finally { if (current()) changing.value = false }
}
async function openPreview(id: string) { if (changing.value) return; const current = beginAction(); changing.value = true; error.value = ''; try { const value = await advertisingApi.introduction(id); if (current()) preview.value = value } catch (e) { if (current()) error.value = errorMessage(e) } finally { if (current()) changing.value = false } }
onBeforeRouteLeave(async () => {
  if (adEditorRef.value?.locked || introEditorRef.value?.locked) return false
  if (adEditor.value || introEditor.value) { try { await ElMessageBox.confirm('编辑窗口仍打开，离开将放弃未保存的内容，确定继续？', '离开页面', { type: 'warning' }); return true } catch { return false } }
  return !changing.value
})
onMounted(() => { void load() })
</script>
<template>
  <section>
    <div class="toolbar">
      <div>
        <h1>首页广告</h1><p class="page-description">
          维护轮播图片、关联介绍与个人中心背景。
        </p>
      </div><el-button
        v-if="tab !== 'background'"
        type="primary"
        :disabled="changing"
        @click="tab === 'ads' ? openAd() : openIntro()"
      >
        {{ tab === 'ads' ? '新建广告' : '新建介绍内容' }}
      </el-button>
    </div>
    <div class="ad-tabs">
      <el-button
        text
        :class="{ 'active-tab': tab === 'ads' }"
        :aria-pressed="tab === 'ads'"
        @click="selectTab('ads')"
      >
        轮播广告
      </el-button><el-button
        text
        :class="{ 'active-tab': tab === 'introductions' }"
        :aria-pressed="tab === 'introductions'"
        @click="selectTab('introductions')"
      >
        介绍内容
      </el-button><el-button
        text
        :class="{ 'active-tab': tab === 'background' }"
        :aria-pressed="tab === 'background'"
        @click="selectTab('background')"
      >
        我的背景图
      </el-button>
    </div>
    <form
      v-if="tab === 'ads'"
      class="panel ad-filters"
      @submit.prevent="load(true)"
    >
      <div class="ad-filter">
        <label for="ad-search">搜索广告</label>
        <el-input
          id="ad-search"
          v-model="q"
          :maxlength="100"
          placeholder="搜索标题 / 项目 / 企业名称"
          clearable
        />
      </div>
      <div class="ad-filter">
        <label for="ad-placement">展示位置</label>
        <el-select
          id="ad-placement"
          v-model="placement"
        >
          <el-option
            label="全部位置"
            value="all"
          />
          <el-option
            v-for="(label, key) in positions"
            :key="key"
            :label="label"
            :value="key"
          />
        </el-select>
      </div>
      <div class="ad-filter">
        <label for="ad-status">状态</label>
        <el-select
          id="ad-status"
          v-model="status"
        >
          <el-option
            label="全部状态"
            value="all"
          />
          <el-option
            v-for="(label, key) in labels"
            :key="key"
            :label="label"
            :value="key"
          />
        </el-select>
      </div>
      <el-button
        type="primary"
        native-type="submit"
        :loading="loading"
        :disabled="changing"
      >
        查询
      </el-button>
    </form>
    <BackgroundSettings
      v-if="tab === 'background'"
      ref="backgroundRef"
    />
    <div
      v-else
      class="panel"
      :class="{ 'ad-list': tab === 'ads' }"
    >
      <h2 v-if="tab === 'ads'">
        轮播广告列表
      </h2>
      <form
        v-else
        class="filters"
        @submit.prevent="load(true)"
      >
        <el-input
          v-model="q"
          :maxlength="100"
          placeholder="搜索标题 / 项目 / 企业名称"
          style="width:260px"
        /><el-select
          v-model="status"
          style="width:150px"
          aria-label="状态"
        >
          <el-option
            label="全部状态"
            value="all"
          /><el-option
            v-for="(label, key) in labels"
            :key="key"
            :label="label"
            :value="key"
          />
        </el-select><el-button
          native-type="submit"
          :loading="loading"
          :disabled="changing"
        >
          查询
        </el-button>
      </form>
      <el-alert
        v-if="error"
        :title="error"
        type="error"
        :closable="false"
      /><el-button
        v-if="error"
        :disabled="loading || changing"
        @click="load()"
      >
        重试
      </el-button>
      <el-table
        v-if="tab === 'ads'"
        v-loading="loading"
        :data="ads"
        :empty-text="applied.q || applied.status !== 'all' || applied.placement !== 'all' ? '没有匹配的广告，请调整筛选' : '暂无广告，点击新建广告创建第一条'"
      >
        <el-table-column
          label="图片"
          width="148"
        >
          <template #default="{ row }">
            <img
              v-if="row.wideImageUrl || row.tallImageUrl"
              :src="row.wideImageUrl || row.tallImageUrl"
              class="thumbnail"
              :class="{ 'thumbnail-wide': row.wideImageUrl }"
              alt="广告图片"
            >
            <span
              v-else
              class="muted"
            >未配置图片</span>
          </template>
        </el-table-column>
        <el-table-column
          prop="title"
          label="标题"
          min-width="180"
          show-overflow-tooltip
        />
        <el-table-column
          label="展示位置"
          min-width="160"
        >
          <template #default="{ row }">
            {{ row.placements.map((p: Placement) => positions[p]).join(' / ') }}
          </template>
        </el-table-column><el-table-column
          label="状态"
          width="100"
        >
          <template #default="{ row }">
            <el-tag :type="statusTypes[row.status as AdStatus]">
              {{ labels[row.status as AdStatus] }}
            </el-tag>
          </template>
        </el-table-column><el-table-column
          prop="sortOrder"
          label="排序"
          width="90"
        /><el-table-column
          label="操作"
          width="210"
          fixed="right"
        >
          <template #default="{ row }">
            <el-button
              link
              type="primary"
              :disabled="changing || loading"
              @click="openAd(row)"
            >
              编辑
            </el-button><el-button
              link
              type="primary"
              :disabled="changing || loading"
              @click="openPreview(row.introductionId)"
            >
              预览介绍
            </el-button><el-button
              link
              :type="row.status === 'published' ? 'danger' : 'primary'"
              :disabled="changing || loading"
              @click="changeStatus(row)"
            >
              {{ row.status === 'published' ? '下架' : '上架' }}
            </el-button>
          </template>
        </el-table-column>
      </el-table>
      <el-table
        v-else
        v-loading="loading"
        :data="introductions"
        :empty-text="q || status !== 'all' ? '没有匹配的介绍内容，请调整筛选' : '暂无介绍内容，请先新建'"
      >
        <el-table-column
          prop="name"
          label="项目名称"
          min-width="150"
        /><el-table-column
          prop="companyName"
          label="企业名称"
          min-width="180"
        /><el-table-column
          prop="contactName"
          label="联系人"
          min-width="100"
        /><el-table-column
          label="状态"
          width="100"
        >
          <template #default="{ row }">
            {{ labels[row.status as AdStatus] }}
          </template>
        </el-table-column><el-table-column
          label="更新时间"
          min-width="160"
        >
          <template #default="{ row }">
            {{ formatDate(row.updatedAt) }}
          </template>
        </el-table-column><el-table-column
          label="操作"
          min-width="210"
        >
          <template #default="{ row }">
            <el-button
              text
              :disabled="changing || loading"
              @click="openIntro(row)"
            >
              编辑
            </el-button><el-button
              text
              :disabled="changing || loading"
              @click="preview = row"
            >
              预览
            </el-button><el-button
              text
              :disabled="changing || loading"
              @click="changeStatus(row)"
            >
              {{ row.status === 'published' ? '下架' : '上架' }}
            </el-button>
          </template>
        </el-table-column>
      </el-table>
      <div class="pagination">
        <span>共 {{ total }} 条 · 第 {{ Math.floor(displayedOffset / 20) + 1 }} 页</span><el-button
          :disabled="!displayedOffset || loading || changing"
          @click="offset = Math.max(0, displayedOffset - 20); load()"
        >
          上一页
        </el-button><el-button
          :disabled="displayedOffset + 20 >= total || loading || changing"
          @click="offset = displayedOffset + 20; load()"
        >
          下一页
        </el-button>
      </div>
    </div>
    <AdEditor
      v-if="adEditor"
      ref="adEditorRef"
      :initial="editAd"
      @close="adEditor = false"
      @saved="saved"
    />
    <IntroductionEditor
      v-if="introEditor"
      ref="introEditorRef"
      :initial="editIntro"
      @close="introEditor = false"
      @saved="saved"
    />
    <el-dialog
      :model-value="Boolean(preview)"
      title="介绍内容预览"
      width="440px"
      @close="preview = undefined"
    >
      <article
        v-if="preview"
        class="intro-preview"
      >
        <img
          v-if="preview.coverImageUrl"
          :src="preview.coverImageUrl"
          class="preview-cover"
          alt="封面"
        ><h2>{{ preview.name }}</h2><p class="muted">
          {{ preview.companyName }}
        </p><p>{{ preview.summary }}</p><template
          v-for="(block, index) in preview.blocks"
          :key="index"
        >
          <p v-if="block.type === 'text'">
            {{ block.text }}
          </p><img
            v-else
            :src="block.imageUrl"
            alt="介绍图片"
          >
        </template><h3>联系项目方</h3><p>{{ preview.contactName }}</p><p v-if="preview.phone">
          电话：{{ preview.phone }}
        </p><p v-if="preview.wechatId">
          微信：{{ preview.wechatId }}
        </p>
      </article>
    </el-dialog>
  </section>
</template>
<style scoped>
.ad-tabs {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  margin-bottom: 20px;
  border-bottom: 1px solid var(--el-border-color-light);
}
.ad-tabs .el-button {
  margin: 0;
  padding: 12px 16px;
  height: auto;
  border-radius: 0;
  border-bottom: 2px solid transparent;
}
.ad-tabs .active-tab { color: var(--el-color-primary); border-bottom-color: currentColor; font-weight: 600; }
.ad-filters {
  display: grid;
  grid-template-columns: minmax(220px, 1.6fr) minmax(140px, 1fr) minmax(140px, 1fr) auto;
  align-items: end;
  gap: 14px;
  margin-bottom: 16px;
}
.ad-filter { display: grid; gap: 8px; min-width: 0; }
.ad-filter label { font-size: 13px; font-weight: 600; }
.ad-list { display: grid; min-width: 0; gap: 14px; }
.ad-list h2 { margin: 0; font-size: 18px; }
.ad-list :deep(.el-table) { --el-table-header-bg-color: var(--el-fill-color-light); }
.filters { margin-bottom: 20px; }
.thumbnail { display: block; width: 120px; aspect-ratio: 2; object-fit: contain; border-radius: 5px; }
.thumbnail-wide { aspect-ratio: 3; }
.intro-preview img { width: 100%; height: auto; border-radius: 8px; }
.intro-preview .preview-cover { aspect-ratio: 2; object-fit: cover; }
.intro-preview p { white-space: pre-wrap; overflow-wrap: anywhere; font-size: 14px; line-height: 1.9; }
.intro-preview h2 { margin-top: 20px; }
@media (max-width: 900px) {
  .ad-filters { grid-template-columns: repeat(2, minmax(0, 1fr)); }
}
@media (max-width: 560px) {
  .ad-filters { grid-template-columns: minmax(0, 1fr); }
}
</style>
