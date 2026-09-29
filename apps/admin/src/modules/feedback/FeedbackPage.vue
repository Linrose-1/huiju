<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { ElMessage } from 'element-plus'
import { adminApi, errorMessage, formatDate, type FeedbackItem } from '../../services/admin'
import { useRequestScope } from '../../services/request-scope'

const kind = ref<'comment' | 'review'>('comment')
const status = ref<'visible' | 'hidden' | 'all'>('visible')
const offset = ref(0)
const items = ref<FeedbackItem[]>([])
const total = ref(0)
const hasMore = ref(false)
const loading = ref(false)
const error = ref('')
const selected = ref<FeedbackItem | null>(null)
const reason = ref('')
const dialogError = ref('')
const submitting = ref(false)
const dialogOpen = ref(false)
const begin = useRequestScope()
async function load(reset = false) {
  if (submitting.value) return
  if (reset) offset.value = 0
  const current = begin()
  loading.value = true
  error.value = ''
  items.value = []
  try {
    const result = await adminApi.feedback(kind.value, status.value, offset.value)
    if (!current()) return
    items.value = result.items
    total.value = result.total
    hasMore.value = result.hasMore
  } catch (value) { if (current()) error.value = errorMessage(value) }
  finally { if (current()) loading.value = false }
}
function openHide(item: FeedbackItem) {
  if (submitting.value || loading.value) return
  selected.value = item
  reason.value = ''
  dialogError.value = ''
  dialogOpen.value = true
}
async function hide() {
  if (submitting.value || !selected.value) return
  if (!reason.value.trim()) { dialogError.value = '请填写隐藏原因。'; return }
  const current = begin()
  submitting.value = true
  dialogError.value = ''
  try {
    await adminApi.hide(selected.value.kind, selected.value.id, reason.value.trim())
    if (!current()) return
    dialogOpen.value = false
    selected.value = null
    reason.value = ''
    ElMessage.success('内容已隐藏，操作记录已保留。')
  } catch (value) { if (current()) dialogError.value = errorMessage(value) }
  finally { if (current()) submitting.value = false }
  if (current() && !dialogOpen.value) await load(true)
}
function changePage(back: boolean) { offset.value = Math.max(0, offset.value + (back ? -40 : 40)); void load() }
onMounted(() => load())
</script>

<template>
  <section>
    <h1>评论与点评</h1>
    <p class="page-description">
      核查活动交流内容。隐藏后不再公开展示，原文与操作原因仍保留。
    </p>
    <div class="panel">
      <div class="toolbar">
        <div class="filters">
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
          <el-select
            v-model="status"
            aria-label="显示状态"
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
      <el-alert
        v-if="error"
        class="form-error"
        :title="error"
        type="error"
        :closable="false"
      />
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
            <p class="feedback-content">
              {{ row.content }}
            </p>
            <span
              v-if="row.score !== null"
              class="muted"
            >评分 {{ row.score }} / 5</span>
          </template>
        </el-table-column>
        <el-table-column
          label="发布者 / 时间"
          min-width="180"
        >
          <template #default="{ row }">
            {{ row.memberName }}<p class="muted">
              {{ formatDate(row.createdAt) }}
            </p>
          </template>
        </el-table-column>
        <el-table-column
          label="处理状态"
          min-width="220"
        >
          <template #default="{ row }">
            <el-tag :type="row.hiddenAt ? 'info' : 'success'">
              {{ row.hiddenAt ? '已隐藏' : '公开中' }}
            </el-tag>
            <template v-if="row.hiddenAt">
              <p class="feedback-content">
                原因：{{ row.hiddenReason }}
              </p>
              <p class="muted">
                {{ row.hiddenBy }} · {{ formatDate(row.hiddenAt) }}
              </p>
            </template>
          </template>
        </el-table-column>
        <el-table-column
          label="操作"
          width="100"
          fixed="right"
        >
          <template #default="{ row }">
            <el-button
              v-if="!row.hiddenAt"
              text
              type="danger"
              :disabled="submitting || loading"
              @click="openHide(row)"
            >
              隐藏
            </el-button><span
              v-else
              class="muted"
            >已处理</span>
          </template>
        </el-table-column>
      </el-table>
      <div class="pagination">
        <span>共 {{ total }} 条</span>
        <el-button
          :disabled="offset === 0 || loading || submitting"
          @click="changePage(true)"
        >
          上一页
        </el-button>
        <el-button
          :disabled="!hasMore || loading || submitting"
          @click="changePage(false)"
        >
          下一页
        </el-button>
      </div>
    </div>
    <el-dialog
      v-model="dialogOpen"
      title="隐藏这条内容"
      width="520px"
      :close-on-click-modal="false"
      :close-on-press-escape="!submitting"
      :show-close="!submitting"
      destroy-on-close
      @closed="selected = null; reason = ''"
    >
      <p class="feedback-content">
        {{ selected?.content }}
      </p>
      <p class="muted">
        隐藏后不再公开展示。本操作会记录你的身份和原因。
      </p>
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
            :maxlength="500"
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
