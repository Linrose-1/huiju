<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { adminApi, errorMessage, formatDate, type AdminActivity } from '../../services/admin'
import { useRequestScope } from '../../services/request-scope'
import ActivityStatus from './ActivityStatus.vue'

const route = useRoute()
const router = useRouter()
const pageSize = 20
const query = route.query
const status = ref<'all' | 'normal' | 'removed'>(query.status === 'normal' || query.status === 'removed' ? query.status : 'all')
const keyword = ref(typeof query.q === 'string' ? query.q.trim().slice(0, 100) : '')
const applied = ref({ status: status.value, q: keyword.value })
const queryPage = typeof query.page === 'string' ? Number(query.page) : 1
let requestedOffset = Number.isInteger(queryPage) && queryPage >= 1 && queryPage <= 50001 ? (queryPage - 1) * pageSize : 0
const offset = ref(0)
const items = ref<AdminActivity[]>([])
const total = ref(0)
const hasMore = ref(false)
const loading = ref(false)
const error = ref('')
const begin = useRequestScope()

function listQuery() {
  return {
    q: applied.value.q || undefined,
    status: applied.value.status !== 'all' ? applied.value.status : undefined,
    page: offset.value ? String(offset.value / pageSize + 1) : undefined,
  }
}

async function load(reset = false) {
  if (reset) {
    requestedOffset = 0
    offset.value = 0
    items.value = []
    total.value = 0
    hasMore.value = false
    applied.value = { status: status.value, q: keyword.value.trim() }
  }
  const current = begin()
  const target = requestedOffset
  loading.value = true
  error.value = ''
  try {
    let result = await adminApi.activities({ ...applied.value, offset: target })
    if (!current()) return
    const last = Math.max(0, Math.ceil(result.total / pageSize) - 1) * pageSize
    if (target > last) {
      requestedOffset = last
      result = await adminApi.activities({ ...applied.value, offset: last })
      if (!current()) return
    }
    offset.value = requestedOffset
    items.value = result.items
    total.value = result.total
    hasMore.value = result.hasMore
    void router.replace({ name: 'activity-list', query: listQuery() })
  } catch (value) {
    if (current()) error.value = errorMessage(value)
  } finally {
    if (current()) loading.value = false
  }
}

function changePage(back: boolean) {
  requestedOffset = Math.max(0, offset.value + (back ? -pageSize : pageSize))
  void load()
}

function resetFilters() {
  keyword.value = ''
  status.value = 'all'
  void load(true)
}

onMounted(() => load())
</script>

<template>
  <section class="activity-admin">
    <header class="activity-page-header">
      <div>
        <h1>活动管理</h1>
        <p class="page-description">
          查看活动展示状态与报名情况。
        </p>
      </div>
    </header>
    <div class="panel activity-table-panel">
      <div class="toolbar activity-toolbar">
        <form
          class="filters"
          @submit.prevent="load(true)"
        >
          <el-input
            v-model="keyword"
            placeholder="搜索活动标题"
            aria-label="活动标题"
            :maxlength="100"
            :disabled="loading"
            class="activity-search"
          />
          <el-select
            v-model="status"
            aria-label="活动展示状态"
            class="activity-select"
            :disabled="loading"
            @change="load(true)"
          >
            <el-option
              label="全部展示状态"
              value="all"
            />
            <el-option
              label="正常展示"
              value="normal"
            />
            <el-option
              label="已下架"
              value="removed"
            />
          </el-select>
          <el-button
            type="primary"
            native-type="submit"
            :disabled="loading"
          >
            查询
          </el-button>
          <el-button
            :disabled="loading"
            @click="resetFilters"
          >
            重置
          </el-button>
        </form>
        <el-button
          :loading="loading"
          @click="load()"
        >
          刷新
        </el-button>
      </div>
      <div
        v-if="error"
        class="activity-list-error"
      >
        <el-alert
          :title="error"
          type="error"
          :closable="false"
        />
        <el-button
          :disabled="loading"
          @click="load()"
        >
          重试
        </el-button>
      </div>
      <el-table
        v-loading="loading"
        :data="items"
        row-key="id"
        :empty-text="error ? '活动列表暂未加载' : '暂无符合条件的活动'"
      >
        <el-table-column
          label="活动 / 发起人"
          min-width="208"
        >
          <template #default="{ row }">
            <strong>{{ row.title }}</strong>
            <p class="muted activity-secondary">
              {{ row.organizerName || '—' }}
            </p>
          </template>
        </el-table-column>
        <el-table-column
          label="活动时间"
          min-width="173"
        >
          <template #default="{ row }">
            {{ formatDate(row.startsAt) }}
            <p class="muted activity-secondary">
              至 {{ formatDate(row.endsAt) }}
            </p>
          </template>
        </el-table-column>
        <el-table-column
          prop="location"
          label="地点"
          min-width="160"
        />
        <el-table-column
          label="展示状态"
          min-width="210"
        >
          <template #default="{ row }">
            <ActivityStatus :activity="row" />
          </template>
        </el-table-column>
        <el-table-column
          label="操作"
          width="116"
          fixed="right"
        >
          <template #default="{ row }">
            <router-link
              class="activity-link"
              :to="{ name: 'activity-detail', params: { id: row.id }, query: listQuery() }"
              :aria-label="'查看详情：' + row.title"
            >
              查看详情 <span aria-hidden="true">›</span>
            </router-link>
          </template>
        </el-table-column>
      </el-table>
      <div class="pagination activity-pagination">
        <span>共 {{ total }} 条 · 第 {{ offset / pageSize + 1 }} 页</span>
        <div class="actions">
          <el-button
            :disabled="!offset || loading"
            @click="changePage(true)"
          >
            上一页
          </el-button>
          <el-button
            :disabled="!hasMore || loading"
            @click="changePage(false)"
          >
            下一页
          </el-button>
        </div>
      </div>
    </div>
  </section>
</template>

<style src="./activity-admin.css"></style>
