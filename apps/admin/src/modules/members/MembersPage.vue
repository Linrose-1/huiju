<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { adminApi, errorMessage, formatDate, type MemberSummary, type MemberDetail } from '../../services/admin'
import { useRequestScope } from '../../services/request-scope'
const query = ref('')
const profile = ref<'all' | 'complete' | 'incomplete'>('all')
const inviterId = ref<string>()
const inviterName = ref('')
const applied = ref({ q: '', profile: 'all' as 'all' | 'complete' | 'incomplete', inviterId: undefined as string | undefined })
const items = ref<MemberSummary[]>([])
const offset = ref(0)
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
async function load(reset = false) {
  if (reset) { offset.value = 0; applied.value = { q: query.value.trim(), profile: profile.value, inviterId: inviterId.value } }
  const current = beginList()
  loading.value = true; error.value = ''; items.value = []; total.value = 0; hasMore.value = false
  try {
    const result = await adminApi.members({ ...applied.value, offset: offset.value })
    if (!current()) return
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
  inviterId.value = detail.value.id; inviterName.value = detail.value.displayName || detail.value.memberNumber
  query.value = ''; profile.value = 'all'; detailOpen.value = false; closeDetail(); void load(true)
}
function reset() { query.value = ''; profile.value = 'all'; inviterId.value = undefined; inviterName.value = ''; void load(true) }
function page(back: boolean) { offset.value = Math.max(0, offset.value + (back ? -40 : 40)); void load() }
onMounted(() => load(true))
</script>

<template>
  <section>
    <h1>会员查询</h1>
    <p class="page-description">
      查看会员资料与邀请关系。
    </p>
    <div class="panel">
      <form
        class="filters member-search"
        @submit.prevent="load(true)"
      >
        <el-input
          v-model="query"
          aria-label="搜索会员"
          placeholder="编号、用户名称、真实姓名或手机号"
          :maxlength="100"
          clearable
        />
        <el-select
          v-model="profile"
          aria-label="资料完善情况"
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
        <el-button
          type="primary"
          native-type="submit"
          :loading="loading"
        >
          搜索
        </el-button>
        <el-button
          :disabled="loading"
          @click="reset"
        >
          重置
        </el-button>
      </form>
      <p
        v-if="inviterId"
        class="muted"
      >
        邀请来源：{{ inviterName }}（直接邀请）
      </p>
      <el-alert
        v-if="error"
        :title="error"
        type="error"
        :closable="false"
      />
      <el-table
        v-loading="loading"
        :data="items"
        empty-text="暂无符合条件的会员"
      >
        <el-table-column
          prop="memberNumber"
          label="会员编号"
          min-width="150"
        />
        <el-table-column
          label="用户名称"
          min-width="160"
        >
          <template #default="{ row }">
            {{ row.displayName || '未设置' }}
          </template>
        </el-table-column>
        <el-table-column
          label="真实姓名"
          min-width="120"
        >
          <template #default="{ row }">
            {{ row.realName || '未填写' }}
          </template>
        </el-table-column>
        <el-table-column
          label="绑定手机号"
          min-width="150"
        >
          <template #default="{ row }">
            {{ row.boundPhone || '未绑定' }}
          </template>
        </el-table-column>
        <el-table-column
          label="资料状态"
          min-width="120"
        >
          <template #default="{ row }">
            <el-tag :type="row.profileComplete ? 'success' : 'info'">
              {{ row.profileComplete ? '已完善' : '未完善' }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column
          label="入会时间"
          min-width="190"
        >
          <template #default="{ row }">
            {{ formatDate(row.createdAt) }}
          </template>
        </el-table-column>
        <el-table-column
          label="操作"
          width="110"
        >
          <template #default="{ row }">
            <el-button
              text
              type="primary"
              @click="showMember(row.id)"
            >
              查看详情
            </el-button>
          </template>
        </el-table-column>
      </el-table>
      <div class="pagination">
        <span>共 {{ total }} 位会员</span><el-button
          :disabled="loading || offset === 0"
          @click="page(true)"
        >
          上一页
        </el-button><el-button
          :disabled="loading || !hasMore"
          @click="page(false)"
        >
          下一页
        </el-button>
      </div>
    </div>
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
        <el-avatar
          v-if="detail.avatarUrl"
          :src="detail.avatarUrl"
          :size="64"
          aria-label="会员头像"
        />
        <h2>{{ detail.displayName || '未设置用户名称' }}</h2>
        <el-descriptions
          :column="1"
          border
          class="member-details"
        >
          <el-descriptions-item label="会员编号">
            {{ detail.memberNumber }}
          </el-descriptions-item>
          <el-descriptions-item label="真实姓名">
            {{ detail.realName || '未填写' }}
          </el-descriptions-item>
          <el-descriptions-item label="绑定手机号">
            {{ detail.boundPhone || '未绑定' }}
          </el-descriptions-item>
          <el-descriptions-item label="邮箱">
            {{ detail.email || '未填写' }}
          </el-descriptions-item>
          <el-descriptions-item label="家乡">
            {{ detail.hometown || '未填写' }}
          </el-descriptions-item>
          <el-descriptions-item label="个人简介">
            {{ detail.bio || '未填写' }}
          </el-descriptions-item>
          <el-descriptions-item label="资源">
            {{ detail.resources || '未填写' }}
          </el-descriptions-item>
          <el-descriptions-item label="需求">
            {{ detail.needs || '未填写' }}
          </el-descriptions-item>
          <el-descriptions-item label="资料状态">
            {{ detail.profileComplete ? '已完善' : '未完善' }}
          </el-descriptions-item>
          <el-descriptions-item label="入会时间">
            {{ formatDate(detail.createdAt) }}
          </el-descriptions-item>
          <el-descriptions-item label="邀请码">
            {{ detail.inviteCode }}
          </el-descriptions-item>
        </el-descriptions>
        <h3>邀请关系</h3>
        <p v-if="detail.inviter?.kind === 'platform_root'">
          邀请来源：平台
        </p>
        <p v-else-if="detail.inviter">
          直接邀请人：<el-button
            text
            type="primary"
            @click="showMember(detail.inviter.id)"
          >
            {{ detail.inviter.displayName || detail.inviter.memberNumber }}
          </el-button>
        </p>
        <p v-else>
          暂无邀请来源
        </p>
        <el-button
          :disabled="!detail.inviteeCount"
          @click="invitedMembers"
        >
          查看直接受邀会员（{{ detail.inviteeCount }}）
        </el-button>
      </template>
    </el-drawer>
  </section>
</template>

<style scoped>
.member-search { margin-bottom: 20px; }
.member-search .el-input { width: min(360px, 100%); }
.member-search .el-select { width: 180px; }
.member-details { white-space: pre-wrap; overflow-wrap: anywhere; }
</style>
