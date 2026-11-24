<script setup lang="ts">
import { onMounted, ref } from 'vue'
import CommunityPermissions from './CommunityPermissions.vue'
import { adminApi, errorMessage, formatDate, isSuperAdmin, type MemberSummary, type MemberDetail } from '../../services/admin'
import { useRequestScope } from '../../services/request-scope'
const pageSize = 40
const query = ref('')
const profile = ref<'all' | 'complete' | 'incomplete'>('all')
const inviterId = ref<string>()
const inviterName = ref('')
const applied = ref({ q: '', profile: 'all' as 'all' | 'complete' | 'incomplete', inviterId: undefined as string | undefined })
const items = ref<MemberSummary[]>([])
const offset = ref(0)
let requestedOffset = 0
let previousSearch: { q: string; profile: typeof profile.value; offset: number } | undefined
const total = ref(0)
const hasMore = ref(false)
const loading = ref(false)
const error = ref('')
const detail = ref<MemberDetail | null>(null)
const detailOpen = ref(false)
const detailLoading = ref(false)
const detailError = ref('')
const selectedId = ref('')
const beginList = useRequestScope()
const beginDetail = useRequestScope()
async function load(reset = false, startOffset = 0) {
  if (reset) {
    requestedOffset = startOffset
    offset.value = startOffset
    applied.value = { q: query.value.trim(), profile: profile.value, inviterId: inviterId.value }
    items.value = []; total.value = 0; hasMore.value = false
  }
  const targetOffset = requestedOffset
  const current = beginList()
  loading.value = true; error.value = ''
  try {
    const result = await adminApi.members({ ...applied.value, offset: targetOffset })
    if (!current()) return
    offset.value = targetOffset
    items.value = result.items; total.value = result.total; hasMore.value = result.hasMore
  } catch (value) { if (current()) error.value = errorMessage(value) }
  finally { if (current()) loading.value = false }
}
async function showMember(id: string) {
  selectedId.value = id; detailOpen.value = true; detail.value = null; detailError.value = ''; detailLoading.value = true
  const current = beginDetail()
  try { const result = await adminApi.member(id); if (current()) detail.value = result }
  catch (value) { if (current()) detailError.value = errorMessage(value) }
  finally { if (current()) detailLoading.value = false }
}
function closeDetail() { beginDetail(); detail.value = null; detailLoading.value = false }
function invitedMembers() {
  if (!detail.value) return
  previousSearch ??= { q: applied.value.q, profile: applied.value.profile, offset: offset.value }
  inviterId.value = detail.value.id; inviterName.value = detail.value.displayName || detail.value.memberNumber
  query.value = ''; profile.value = 'all'; detailOpen.value = false; closeDetail(); void load(true)
}
function reset() { query.value = ''; profile.value = 'all'; inviterId.value = undefined; inviterName.value = ''; previousSearch = undefined; void load(true) }
function returnToMemberQuery() {
  const search = previousSearch
  if (!search) return
  previousSearch = undefined
  inviterId.value = undefined
  inviterName.value = ''
  query.value = search.q
  profile.value = search.profile
  void load(true, search.offset)
}
function page(back: boolean) {
  requestedOffset = Math.max(0, offset.value + (back ? -pageSize : pageSize))
  void load()
}
onMounted(() => load(true))
</script>

<template>
  <section>
    <h1>会员查询</h1>
    <p class="page-description">
      查看会员资料与邀请关系。
    </p>
    <el-button
      v-if="inviterId"
      class="member-return"
      link
      type="primary"
      @click="returnToMemberQuery"
    >
      ‹ 返回会员查询
    </el-button>
    <form
      class="panel member-search"
      @submit.prevent="load(true)"
    >
      <div class="member-filter">
        <label for="member-keyword">搜索会员</label>
        <el-input
          id="member-keyword"
          v-model="query"
          placeholder="用户编号、用户名称、真实姓名或手机号"
          :maxlength="100"
          clearable
        />
      </div>
      <div class="member-filter">
        <label for="member-profile">资料状态</label>
        <el-select
          id="member-profile"
          v-model="profile"
        >
          <el-option
            label="全部资料状态"
            value="all"
          />
          <el-option
            label="资料已完善"
            value="complete"
          />
          <el-option
            label="资料未完善"
            value="incomplete"
          />
        </el-select>
      </div>
      <div class="member-search-actions">
        <el-button
          type="primary"
          native-type="submit"
          :loading="loading"
        >
          查询
        </el-button>
        <el-button
          :disabled="loading"
          @click="reset"
        >
          重置
        </el-button>
      </div>
    </form>
    <section class="panel member-results">
      <header class="member-results-header">
        <div class="member-results-title">
          <h2>{{ inviterId ? '直接受邀会员' : '会员列表' }}</h2>
          <span class="muted">共 {{ total }} 位会员</span>
        </div>
        <el-button
          :disabled="loading"
          @click="load()"
        >
          刷新
        </el-button>
      </header>
      <div
        v-if="inviterId"
        class="member-inviter-filter"
      >
        <el-tag type="success">
          邀请来源：{{ inviterName }}（直接邀请）
        </el-tag>
      </div>
      <el-alert
        v-if="error"
        :title="error"
        type="error"
        :closable="false"
      />
      <el-button
        v-if="error"
        :disabled="loading"
        @click="load()"
      >
        重试
      </el-button>
      <el-table
        v-loading="loading"
        :data="items"
        empty-text="暂无符合条件的会员"
      >
        <el-table-column
          prop="memberNumber"
          label="用户编号"
          min-width="150"
        />
        <el-table-column
          label="用户名称"
          min-width="140"
        >
          <template #default="{ row }">
            {{ row.displayName || '—' }}
          </template>
        </el-table-column>
        <el-table-column
          label="真实姓名"
          min-width="110"
        >
          <template #default="{ row }">
            {{ row.realName || '—' }}
          </template>
        </el-table-column>
        <el-table-column
          label="绑定手机号"
          min-width="130"
        >
          <template #default="{ row }">
            {{ row.boundPhone || '—' }}
          </template>
        </el-table-column>
        <el-table-column
          label="资料状态"
          width="100"
        >
          <template #default="{ row }">
            <el-tag :type="row.profileComplete ? 'success' : 'info'">
              {{ row.profileComplete ? '已完善' : '未完善' }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column
          label="入会时间"
          min-width="170"
        >
          <template #default="{ row }">
            {{ formatDate(row.createdAt) }}
          </template>
        </el-table-column>
        <el-table-column
          label="操作"
          width="110"
          fixed="right"
        >
          <template #default="{ row }">
            <el-button
              link
              type="primary"
              @click="showMember(row.id)"
            >
              查看详情
            </el-button>
          </template>
        </el-table-column>
      </el-table>
      <footer class="member-pagination">
        <span class="muted">每页 {{ pageSize }} 条</span>
        <div class="member-page-controls">
          <el-button
            :disabled="loading || offset === 0"
            @click="page(true)"
          >
            上一页
          </el-button>
          <span class="muted">第 {{ Math.floor(offset / pageSize) + 1 }} / {{ Math.max(1, Math.ceil(total / pageSize)) }} 页</span>
          <el-button
            :disabled="loading || !hasMore"
            @click="page(false)"
          >
            下一页
          </el-button>
        </div>
      </footer>
    </section>
    <el-drawer
      v-model="detailOpen"
      title="会员详情"
      size="min(640px, 100%)"
      @close="closeDetail"
    >
      <p
        v-if="detailLoading"
        role="status"
      >
        正在加载会员资料…
      </p>
      <template v-else-if="detailError">
        <el-alert
          :title="detailError"
          type="error"
          :closable="false"
        /><el-button @click="showMember(selectedId)">
          重试
        </el-button>
      </template>
      <template v-else-if="detail">
        <div class="member-identity">
          <el-avatar
            :src="detail.avatarUrl || undefined"
            :size="52"
            aria-label="会员头像"
          >
            {{ Array.from(detail.displayName || '会')[0] }}
          </el-avatar>
          <div>
            <div class="member-results-title">
              <h2>{{ detail.displayName || '未设置名称' }}</h2>
              <el-tag :type="detail.profileComplete ? 'success' : 'info'">
                {{ detail.profileComplete ? '已完善' : '未完善' }}
              </el-tag>
            </div>
            <p class="muted">
              用户编号 {{ detail.memberNumber }}
            </p>
          </div>
        </div>
        <CommunityPermissions
          v-if="isSuperAdmin && detailOpen"
          :key="detail.id"
          :member-id="detail.id"
          :member-label="detail.displayName || detail.memberNumber"
        />
        <section class="member-detail-section">
          <h3>邀请关系</h3>
          <div class="member-invitations">
            <div class="member-relation-row">
              <span>直接邀请人</span>
              <span v-if="detail.inviter?.kind === 'platform_root'">邀请来源：平台</span>
              <el-button
                v-else-if="detail.inviter"
                link
                type="primary"
                class="member-relation-link"
                @click="showMember(detail.inviter.id)"
              >
                {{ detail.inviter.displayName ? detail.inviter.displayName + ' · ' + detail.inviter.memberNumber : detail.inviter.memberNumber }} ›
              </el-button>
              <span
                v-else
                class="muted"
              >暂无邀请来源</span>
            </div>
            <div class="member-relation-row">
              <span>直接受邀会员</span>
              <el-button
                plain
                type="primary"
                :disabled="!detail.inviteeCount"
                @click="invitedMembers"
              >
                查看直接受邀会员（{{ detail.inviteeCount }}）
              </el-button>
            </div>
          </div>
        </section>
        <section class="member-detail-section">
          <h3>会员资料</h3>
          <el-descriptions
            :column="1"
            border
            class="member-details"
          >
            <el-descriptions-item label="真实姓名">
              {{ detail.realName || '—' }}
            </el-descriptions-item>
            <el-descriptions-item label="绑定手机号">
              {{ detail.boundPhone || '—' }}
            </el-descriptions-item>
            <el-descriptions-item label="邮箱">
              {{ detail.email || '—' }}
            </el-descriptions-item>
            <el-descriptions-item label="家乡">
              {{ detail.hometown || '—' }}
            </el-descriptions-item>
            <el-descriptions-item label="入会时间">
              {{ formatDate(detail.createdAt) }}
            </el-descriptions-item>
            <el-descriptions-item label="邀请码">
              {{ detail.inviteCode }}
            </el-descriptions-item>
          </el-descriptions>
          <el-descriptions
            :column="1"
            border
            class="member-details"
          >
            <el-descriptions-item label="个人简介">
              {{ detail.bio || '—' }}
            </el-descriptions-item>
            <el-descriptions-item label="资源">
              {{ detail.resources || '—' }}
            </el-descriptions-item>
            <el-descriptions-item label="需求">
              {{ detail.needs || '—' }}
            </el-descriptions-item>
          </el-descriptions>
        </section>
      </template>
    </el-drawer>
  </section>
</template>

<style scoped>
.member-return { margin-bottom: 14px; }
.member-search {
  display: grid;
  grid-template-columns: minmax(240px, 1.7fr) minmax(152px, 1fr) auto;
  align-items: end;
  gap: 14px;
  margin-bottom: 16px;
}
.member-filter { display: grid; gap: 8px; min-width: 0; }
.member-filter label { font-size: 13px; font-weight: 600; }
.member-search-actions,
.member-results-header,
.member-results-title,
.member-inviter-filter,
.member-pagination,
.member-page-controls,
.member-identity {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 12px;
}
.member-search-actions .el-button + .el-button { margin-left: 0; }
.member-results { display: grid; min-width: 0; gap: 14px; }
.member-results-header,
.member-pagination { justify-content: space-between; }
.member-results-title h2 { margin: 0; font-size: 18px; }
.member-results :deep(.el-table) { --el-table-header-bg-color: var(--el-fill-color-light); }
.member-identity h2 { font-size: 22px; }
.member-identity p { margin: 5px 0 0; }
.member-identity .el-avatar {
  background: var(--el-color-primary-light-9);
  color: var(--el-color-primary);
  font-weight: 600;
}
.member-detail-section { display: grid; gap: 12px; margin-top: 22px; }
.member-detail-section h3 { margin: 0; }
.member-invitations { border: 1px solid var(--el-border-color-light); border-radius: 8px; padding: 0 12px; }
.member-relation-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 6px 12px;
  padding: 10px 0;
}
.member-relation-row + .member-relation-row { border-top: 1px solid var(--el-border-color-light); }
.member-relation-link { max-width: 100%; white-space: normal; overflow-wrap: anywhere; text-align: left; }
.member-details { white-space: pre-wrap; overflow-wrap: anywhere; }
.member-details :deep(.el-descriptions__label) { width: 108px; }

@media (max-width: 900px) {
  .member-search { grid-template-columns: repeat(2, minmax(0, 1fr)); }
}
@media (max-width: 560px) {
  .member-search { grid-template-columns: minmax(0, 1fr); }
}
</style>
