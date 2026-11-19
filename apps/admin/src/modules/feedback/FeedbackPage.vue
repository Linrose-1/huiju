<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { ElMessage } from 'element-plus'
import { adminApi, errorMessage, formatDate, type FeedbackItem } from '../../services/admin'
import { useRequestScope } from '../../services/request-scope'

const kind = ref<'comment' | 'review'>('comment')
const status = ref<'visible' | 'hidden' | 'all'>('visible')
const pageSize = 40
const reasonLimit = 500
const labels = { comment: '评论', review: '点评' } as const
let requestedOffset = 0
const offset = ref(0)
const items = ref<FeedbackItem[]>([])
const total = ref(0)
const hasMore = ref(false)
const loading = ref(false)
const error = ref('')
const selected = ref<FeedbackItem | null>(null)
const detail = ref<FeedbackItem | null>(null)
const reason = ref('')
const dialogError = ref('')
const submitting = ref(false)
const dialogOpen = ref(false)
const begin = useRequestScope()
async function load(reset = false) {
  if (submitting.value) return
  if (reset) { requestedOffset = 0; offset.value = 0; items.value = []; total.value = 0; hasMore.value = false }
  const targetOffset = requestedOffset
  const current = begin()
  loading.value = true
  error.value = ''
  try {
    const result = await adminApi.feedback(kind.value, status.value, targetOffset)
    if (!current()) return
    offset.value = targetOffset
    items.value = result.items
    total.value = result.total
    hasMore.value = result.hasMore
  } catch (value) { if (current()) error.value = errorMessage(value) }
  finally { if (current()) loading.value = false }
}
function openHide(item: FeedbackItem) {
  if (submitting.value || loading.value || item.hiddenAt) return
  selected.value = item
  reason.value = ''
  dialogError.value = ''
  dialogOpen.value = true
}
async function hide() {
  if (submitting.value || !selected.value) return
  const text = reason.value.trim()
  if (!text) { dialogError.value = '请填写隐藏原因。'; return }
  if (text.length > reasonLimit) { dialogError.value = '隐藏原因最多 500 字。'; return }
  const current = begin()
  submitting.value = true
  dialogError.value = ''
  try {
    await adminApi.hide(selected.value.kind, selected.value.id, text)
    if (!current()) return
    dialogOpen.value = false
    selected.value = null
    reason.value = ''
    ElMessage.success('内容已隐藏，操作记录已保留。')
  } catch (value) { if (current()) dialogError.value = errorMessage(value) }
  finally { if (current()) submitting.value = false }
  if (current() && !dialogOpen.value) await load(true)
}
function changePage(back: boolean) { requestedOffset = Math.max(0, offset.value + (back ? -pageSize : pageSize)); void load() }
onMounted(() => load())
</script>

<template>
  <section>
    <h1>评论与点评</h1>
    <p class="page-description">
      核查活动交流内容与隐藏记录。
    </p>
    <div class="panel feedback-toolbar">
      <div class="feedback-filters">
        <span class="feedback-label">内容类型</span>
        <el-radio-group
          v-model="kind"
          aria-label="内容类型"
          :disabled="submitting"
          @change="load(true)"
        >
          <el-radio-button value="comment">
            评论
          </el-radio-button><el-radio-button value="review">
            点评
          </el-radio-button>
        </el-radio-group>
        <label
          class="feedback-label"
          for="feedback-status"
        >显示状态</label>
        <el-select
          id="feedback-status"
          v-model="status"
          style="width: 140px"
          :disabled="submitting"
          @change="load(true)"
        >
          <el-option
            label="公开中"
            value="visible"
          /><el-option
            label="已隐藏"
            value="hidden"
          /><el-option
            label="全部状态"
            value="all"
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
    <section class="panel feedback-list">
      <header class="feedback-heading">
        <h2>{{ labels[kind] }}列表</h2>
        <span class="muted">共 {{ total }} 条</span>
      </header>
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
        重试
      </el-button>
      <el-table
        v-loading="loading"
        :data="items"
        empty-text="暂无符合条件的内容"
        row-key="id"
      >
        <el-table-column
          label="活动与内容"
          min-width="340"
        >
          <template #default="{ row }">
            <strong>{{ row.activityTitle }}</strong>
            <p
              class="feedback-content clamp"
            >
              {{ row.content }}
            </p>
          </template>
        </el-table-column>
        <el-table-column
          v-if="kind === 'review'"
          label="评分"
          width="82"
        >
          <template #default="{ row }">
            {{ row.score === null ? '—' : row.score + ' / 5' }}
          </template>
        </el-table-column>
        <el-table-column
          label="发布者 / 时间"
          min-width="180"
        >
          <template #default="{ row }">
            {{ row.memberName }}<p class="muted feedback-time">
              {{ formatDate(row.createdAt) }}
            </p>
          </template>
        </el-table-column>
        <el-table-column
          label="处理状态"
          width="108"
        >
          <template #default="{ row }">
            <el-tag :type="row.hiddenAt ? 'info' : 'success'">
              {{ row.hiddenAt ? '已隐藏' : '公开中' }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column
          label="操作"
          width="160"
          fixed="right"
        >
          <template #default="{ row }">
            <el-button
              link
              type="primary"
              :disabled="submitting || loading"
              @click="detail = row"
            >
              查看内容
            </el-button>
            <el-button
              v-if="!row.hiddenAt"
              link
              type="danger"
              :disabled="submitting || loading"
              @click="openHide(row)"
            >
              隐藏
            </el-button>
          </template>
        </el-table-column>
      </el-table>
      <footer class="feedback-pagination">
        <span class="muted">每页 {{ pageSize }} 条</span>
        <div class="feedback-pager">
          <el-button
            :disabled="offset === 0 || loading || submitting"
            @click="changePage(true)"
          >
            上一页
          </el-button>
          <span class="muted">第 {{ Math.floor(offset / pageSize) + 1 }} / {{ Math.max(1, Math.ceil(total / pageSize)) }} 页</span>
          <el-button
            :disabled="!hasMore || loading || submitting"
            @click="changePage(false)"
          >
            下一页
          </el-button>
        </div>
      </footer>
    </section>
    <el-drawer
      :model-value="!!detail"
      :title="detail ? labels[detail.kind] + '详情' : '内容详情'"
      size="min(640px, 100%)"
      @update:model-value="detail = null"
    >
      <template v-if="detail">
        <div class="feedback-heading">
          <h2>{{ detail.activityTitle }}</h2>
          <el-tag :type="detail.hiddenAt ? 'info' : 'success'">
            {{ detail.hiddenAt ? '已隐藏' : '公开中' }}
          </el-tag>
        </div>
        <el-descriptions
          :column="1"
          border
          class="feedback-details"
        >
          <el-descriptions-item label="发布者">
            {{ detail.memberName }}
          </el-descriptions-item>
          <el-descriptions-item label="发布时间">
            {{ formatDate(detail.createdAt) }}
          </el-descriptions-item>
          <el-descriptions-item
            v-if="detail.score !== null"
            label="评分"
          >
            {{ detail.score }} / 5
          </el-descriptions-item>
        </el-descriptions>
        <section class="feedback-detail-section">
          <h3>原文</h3>
          <p class="feedback-content">
            {{ detail.content }}
          </p>
        </section>
        <section
          v-if="detail.hiddenAt"
          class="feedback-detail-section feedback-history"
        >
          <h3>隐藏记录</h3>
          <el-descriptions
            :column="1"
            border
            class="feedback-details"
          >
            <el-descriptions-item label="处理人">
              {{ detail.hiddenBy || '—' }}
            </el-descriptions-item>
            <el-descriptions-item label="隐藏时间">
              {{ formatDate(detail.hiddenAt) }}
            </el-descriptions-item>
            <el-descriptions-item label="隐藏原因">
              {{ detail.hiddenReason || '—' }}
            </el-descriptions-item>
          </el-descriptions>
        </section>
      </template>
    </el-drawer>
    <el-dialog
      v-model="dialogOpen"
      :title="'隐藏这条' + (selected ? labels[selected.kind] : '内容')"
      width="min(560px, 94vw)"
      :close-on-click-modal="false"
      :close-on-press-escape="!submitting"
      :show-close="!submitting"
      destroy-on-close
      @closed="selected = null; reason = ''"
    >
      <h3 class="feedback-target">
        {{ selected?.activityTitle }}
      </h3>
      <p class="feedback-content feedback-original">
        {{ selected?.content }}
      </p>
      <el-alert
        class="feedback-impact"
        type="warning"
        :title="'隐藏后，这条' + (selected ? labels[selected.kind] : '内容') + '将从公开页面移除。后台保留原文、处理人、时间和原因。'"
        :closable="false"
      />
      <el-alert
        v-if="dialogError"
        class="form-error"
        :title="dialogError"
        type="error"
        :closable="false"
      />
      <el-form
        label-position="top"
        @submit.prevent="hide"
      >
        <el-form-item label="隐藏原因（必填）">
          <el-input
            v-model="reason"
            type="textarea"
            :rows="4"
            :maxlength="reasonLimit"
            placeholder="填写隐藏原因"
            aria-required="true"
            show-word-limit
            :disabled="submitting"
          />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button
          :disabled="submitting"
          @click="dialogOpen = false"
        >
          取消
        </el-button><el-button
          type="danger"
          :loading="submitting"
          @click="hide"
        >
          确认隐藏
        </el-button>
      </template>
    </el-dialog>
  </section>
</template>

<style scoped>
.feedback-toolbar,
.feedback-filters,
.feedback-heading,
.feedback-pagination,
.feedback-pager {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 12px;
}
.feedback-toolbar,
.feedback-pagination { justify-content: space-between; }
.feedback-toolbar { margin-bottom: 16px; }
.feedback-label { font-size: 13px; font-weight: 600; }
.feedback-list { display: grid; min-width: 0; gap: 14px; }
.feedback-heading h2 { margin: 0; overflow-wrap: anywhere; }
.feedback-list h2 { font-size: 18px; }
.feedback-list :deep(.el-table) { --el-table-header-bg-color: var(--el-fill-color-light); }
.feedback-list p { margin: 4px 0 0; }
.feedback-content { white-space: pre-wrap; overflow-wrap: anywhere; }
.feedback-details :deep(.el-descriptions__label) { width: 108px; }
.feedback-details :deep(.el-descriptions__content) { white-space: pre-wrap; overflow-wrap: anywhere; }
.feedback-heading + .feedback-details { margin-top: 16px; }
.feedback-detail-section { margin-top: 22px; }
.feedback-detail-section p { margin-bottom: 0; }
.feedback-history { padding-top: 18px; border-top: 1px solid var(--huiju-border); }
.feedback-target { margin: 0 0 8px; overflow-wrap: anywhere; }
.feedback-original { max-height: 28vh; overflow: auto; margin: 0 0 16px; }
.feedback-impact { margin-bottom: 16px; }
</style>
