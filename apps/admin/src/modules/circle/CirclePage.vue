<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { ElMessage } from 'element-plus'
import { adminApi, errorMessage, formatDate, type CircleCategory, type CirclePost, type CircleOperation } from '../../services/admin'
import { useRequestScope } from '../../services/request-scope'

const categories: Record<CircleCategory, string> = { all: '全部类别', park: '园区资源', operation: '运营资源', service: '服务资源', store: '门店' }
const subtypes: Record<string, string> = { rent: '出租', sale: '出售', transfer: '转让', seek_rent: '寻租', buy: '购买' }
const states: Record<string, string> = { open: '公开中', ended: '已结束', removed: '已下架' }
const category = ref<CircleCategory>('all'), appliedCategory = ref<CircleCategory>('all')
const items = ref<CirclePost[]>([]), offset = ref(0), hasMore = ref(false), loading = ref(false), error = ref('')
const detail = ref<CirclePost | null>(null)
const history = ref<CircleOperation[]>([]), historyOffset = ref(0), historyMore = ref(false), historyLoading = ref(false), historyError = ref('')
const selected = ref<CirclePost | null>(null), reason = ref(''), dialogError = ref(''), submitting = ref(false), dialogOpen = ref(false)
const beginList = useRequestScope(), beginHistory = useRequestScope(), beginAction = useRequestScope()

async function load(reset = false, targetOffset = offset.value) {
  if (submitting.value) return
  if (reset) { appliedCategory.value = category.value; targetOffset = 0; offset.value = 0; items.value = []; hasMore.value = false }
  const current = beginList()
  loading.value = true; error.value = ''
  try {
    const result = await adminApi.circlePosts(appliedCategory.value, targetOffset)
    if (!current()) return
    items.value = result.items; hasMore.value = result.hasMore; offset.value = targetOffset
  } catch (e) { if (current()) error.value = errorMessage(e) }
  finally { if (current()) loading.value = false }
}
function changePage(back: boolean) {
  if (loading.value || submitting.value || (back ? offset.value === 0 : !hasMore.value)) return
  void load(false, Math.max(0, offset.value + (back ? -20 : 20)))
}
async function loadHistory(targetOffset = historyOffset.value) {
  if (!detail.value) return
  const current = beginHistory(), id = detail.value.id
  historyLoading.value = true; historyError.value = ''
  try {
    const result = await adminApi.circleOperations(id, targetOffset)
    if (!current()) return
    history.value = result.items; historyMore.value = result.hasMore; historyOffset.value = targetOffset
  } catch (e) { if (current()) historyError.value = errorMessage(e) }
  finally { if (current()) historyLoading.value = false }
}
function openDetail(item: CirclePost) {
  if (loading.value || submitting.value) return
  detail.value = item; history.value = []; historyOffset.value = 0; historyMore.value = false
  void loadHistory()
}
function closeDetail() { beginHistory(); detail.value = null; history.value = []; historyLoading.value = false; historyError.value = '' }
function changeHistory(back: boolean) {
  if (historyLoading.value || (back ? historyOffset.value === 0 : !historyMore.value)) return
  void loadHistory(Math.max(0, historyOffset.value + (back ? -20 : 20)))
}
function openAction(item: CirclePost) {
  if (loading.value || submitting.value) return
  selected.value = item; reason.value = ''; dialogError.value = ''; dialogOpen.value = true
}
async function applyAction() {
  if (submitting.value || !selected.value) return
  const text = reason.value.trim()
  if (!text || text.length > 1000) { dialogError.value = '请填写1–1000字操作原因。'; return }
  const current = beginAction(), item = selected.value
  submitting.value = true; dialogError.value = ''
  try {
    if (item.state === 'removed') await adminApi.restoreCirclePost(item.id, text)
    else await adminApi.removeCirclePost(item.id, text)
    if (!current()) return
    dialogOpen.value = false; selected.value = null; reason.value = ''
    ElMessage.success('帖子状态已更新，操作记录已保存。')
  } catch (e) { if (current()) dialogError.value = errorMessage(e) }
  finally { if (current()) submitting.value = false }
  if (current() && !dialogOpen.value) await load()
}
onMounted(() => load())
</script>

<template>
  <section>
    <h1>学友圈管理</h1>
    <p class="page-description">
      查看资源帖，填写原因后下架或恢复。恢复已结束的帖子仍保留结束状态。
    </p>
    <div class="panel">
      <div class="toolbar">
        <div class="filters">
          <el-select
            v-model="category"
            aria-label="帖子类别"
            style="width: 160px"
            :disabled="submitting"
            @change="load(true)"
          >
            <el-option
              v-for="(label, value) in categories"
              :key="value"
              :label="label"
              :value="value"
            />
          </el-select>
        </div>
        <el-button
          :disabled="loading || submitting"
          @click="load()"
        >
          刷新
        </el-button>
      </div>
      <el-alert
        v-if="error"
        class="form-error"
        :title="error"
        type="error"
        :closable="false"
      />
      <el-button
        v-if="error"
        :disabled="loading || submitting"
        @click="load()"
      >
        重试当前页
      </el-button>
      <el-table
        v-loading="loading"
        :data="items"
        row-key="id"
        :empty-text="error ? '帖子加载失败，请重试' : '暂无符合条件的帖子'"
      >
        <el-table-column
          label="帖子 / 发布者"
          min-width="260"
        >
          <template #default="{ row }">
            <strong class="post-title">{{ row.title }}</strong>
            <p class="muted">
              {{ row.author?.displayName || '未设置名称' }}
            </p>
          </template>
        </el-table-column>
        <el-table-column
          label="类别"
          min-width="130"
        >
          <template #default="{ row }">
            {{ categories[row.category as CircleCategory] }}<p
              v-if="row.subtype"
              class="muted"
            >
              {{ subtypes[row.subtype] }}
            </p>
          </template>
        </el-table-column>
        <el-table-column
          label="状态"
          width="110"
        >
          <template #default="{ row }">
            <el-tag :type="row.state === 'removed' ? 'danger' : row.state === 'ended' ? 'info' : 'success'">
              {{ states[row.state] }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column
          label="发布时间"
          min-width="180"
        >
          <template #default="{ row }">
            {{ formatDate(row.createdAt) }}
          </template>
        </el-table-column>
        <el-table-column
          label="操作"
          width="210"
          fixed="right"
        >
          <template #default="{ row }">
            <el-button
              text
              :disabled="loading || submitting"
              @click="openDetail(row)"
            >
              详情与记录
            </el-button>
            <el-button
              text
              :type="row.state === 'removed' ? 'primary' : 'danger'"
              :disabled="loading || submitting"
              @click="openAction(row)"
            >
              {{ row.state === 'removed' ? '恢复' : '下架' }}
            </el-button>
          </template>
        </el-table-column>
      </el-table>
      <div class="pagination">
        <span>第 {{ offset / 20 + 1 }} 页 · 本页 {{ items.length }} 条{{ !loading && !error && !hasMore ? ' · 没有更多' : '' }}</span>
        <el-button
          :disabled="loading || submitting || offset === 0"
          @click="changePage(true)"
        >
          上一页
        </el-button>
        <el-button
          :disabled="loading || submitting || !hasMore"
          @click="changePage(false)"
        >
          下一页
        </el-button>
      </div>
    </div>
    <el-dialog
      v-model="dialogOpen"
      :title="selected?.state === 'removed' ? '恢复帖子' : '下架帖子'"
      width="min(520px, 94vw)"
      :close-on-click-modal="!submitting"
      :close-on-press-escape="!submitting"
      :show-close="!submitting"
    >
      <p class="post-title">
        {{ selected?.title }}
      </p>
      <p class="muted">
        {{ selected?.state === 'removed' ? '请先核对帖子内容。恢复不会重新开放作者已结束的帖子。' : '下架后公开链接只显示下架状态，不再接受新意向；历史意向保留。' }}
      </p>
      <el-input
        v-model="reason"
        type="textarea"
        aria-label="帖子操作原因"
        placeholder="填写操作原因（必填）"
        :rows="4"
        :maxlength="1000"
        show-word-limit
        :disabled="submitting"
      />
      <el-alert
        v-if="dialogError"
        class="form-error"
        :title="dialogError"
        type="error"
        :closable="false"
      />
      <template #footer>
        <el-button
          :disabled="submitting"
          @click="dialogOpen = false"
        >
          取消
        </el-button>
        <el-button
          :type="selected?.state === 'removed' ? 'primary' : 'danger'"
          :loading="submitting"
          @click="applyAction()"
        >
          确认{{ selected?.state === 'removed' ? '恢复' : '下架' }}
        </el-button>
      </template>
    </el-dialog>
    <el-dialog
      :model-value="!!detail"
      title="帖子详情与操作记录"
      width="min(860px, 94vw)"
      @update:model-value="closeDetail()"
    >
      <template v-if="detail">
        <h2 class="post-title">
          {{ detail.title }}
        </h2>
        <el-descriptions
          :column="2"
          border
        >
          <el-descriptions-item label="发布者">
            {{ detail.author?.displayName || '未设置名称' }}
          </el-descriptions-item>
          <el-descriptions-item label="状态">
            {{ states[detail.state] }}
          </el-descriptions-item>
          <el-descriptions-item label="类别">
            {{ categories[detail.category as CircleCategory] }}{{ detail.subtype ? ' · ' + subtypes[detail.subtype] : '' }}
          </el-descriptions-item>
          <el-descriptions-item label="发布时间">
            {{ formatDate(detail.createdAt) }}
          </el-descriptions-item>
          <el-descriptions-item label="地点">
            {{ detail.location || '—' }}
          </el-descriptions-item>
          <el-descriptions-item
            v-if="detail.category === 'store'"
            label="门店名称"
          >
            {{ detail.storeName || '—' }}
          </el-descriptions-item>
          <template v-if="detail.category === 'park'">
            <el-descriptions-item label="面积">
              {{ detail.area || '—' }}
            </el-descriptions-item>
            <el-descriptions-item label="报价 / 预算">
              {{ detail.price || '—' }}
            </el-descriptions-item>
            <el-descriptions-item label="有效期">
              {{ detail.validUntil || '—' }}
            </el-descriptions-item>
          </template>
        </el-descriptions>
        <el-alert
          v-if="detail.removalReason"
          class="form-error"
          :title="'下架原因：' + detail.removalReason"
          type="warning"
          :closable="false"
        />
        <h3>正文</h3><p class="post-body">
          {{ detail.body }}
        </p>
        <div
          v-if="detail.images.length && detail.state !== 'removed'"
          class="post-images"
        >
          <el-image
            v-for="(image, index) in detail.images"
            :key="image.id"
            :src="image.url"
            :preview-src-list="detail.images.map(item => item.url)"
            :initial-index="index"
            preview-teleported
            fit="cover"
          >
            <template #error>
              <span class="muted">图片加载失败</span>
            </template>
          </el-image>
        </div>
        <p
          v-else-if="detail.images.length"
          class="muted"
        >
          下架图片受访问限制，当前不可预览。
        </p>
        <h3>操作记录</h3>
        <el-alert
          v-if="historyError"
          :title="historyError"
          type="error"
          :closable="false"
        />
        <el-button
          v-if="historyError"
          :disabled="historyLoading"
          @click="loadHistory()"
        >
          重试记录
        </el-button>
        <p
          v-if="historyLoading"
          role="status"
        >
          正在加载记录…
        </p>
        <p
          v-else-if="!historyError && !history.length"
          class="muted"
        >
          暂无操作记录
        </p>
        <article
          v-for="item in history"
          :key="item.id"
          class="operation"
        >
          <strong>{{ ({ remove: '下架', restore: '恢复' } as Record<string, string>)[item.action] || item.action }} · {{ item.actorName || '管理员' }}</strong>
          <p class="post-body">
            {{ item.reason }}
          </p><span class="muted">{{ formatDate(item.createdAt) }}</span>
        </article>
        <div class="pagination">
          <span>第 {{ historyOffset / 20 + 1 }} 页</span>
          <el-button
            :disabled="historyLoading || historyOffset === 0"
            @click="changeHistory(true)"
          >
            上一页
          </el-button>
          <el-button
            :disabled="historyLoading || !historyMore"
            @click="changeHistory(false)"
          >
            下一页
          </el-button>
        </div>
      </template>
    </el-dialog>
  </section>
</template>

<style scoped>
.post-title, .post-body { overflow-wrap: anywhere; }
.post-body { white-space: pre-wrap; }
.post-images { display: flex; flex-wrap: wrap; gap: 12px; }
.post-images .el-image { width: 130px; height: 100px; border-radius: 8px; }
.operation { padding: 12px 0; border-bottom: 1px solid var(--huiju-border); }
</style>
