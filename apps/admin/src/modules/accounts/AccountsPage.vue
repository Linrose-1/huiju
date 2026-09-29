<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { ElMessage } from 'element-plus'
import { adminApi, errorMessage, formatDate, isSuperAdmin, type AdminAccount } from '../../services/admin'
import { useRequestScope } from '../../services/request-scope'

const items = ref<AdminAccount[]>([])
const loading = ref(false)
const error = ref('')
const dialogOpen = ref(false)
const action = ref<'create' | 'password' | 'status'>('create')
const target = ref<AdminAccount | null>(null)
const username = ref('')
const displayName = ref('')
const password = ref('')
const dialogError = ref('')
const submitting = ref(false)
const begin = useRequestScope()
async function load() {
  if (!isSuperAdmin.value || submitting.value) return
  const current = begin()
  loading.value = true
  error.value = ''
  items.value = []
  try { const result = await adminApi.accounts(); if (current()) items.value = result.items }
  catch (value) { if (current()) error.value = errorMessage(value) }
  finally { if (current()) loading.value = false }
}
function open(next: typeof action.value, account: AdminAccount | null = null) {
  if (!isSuperAdmin.value || submitting.value || loading.value) return
  action.value = next
  target.value = account
  username.value = ''
  displayName.value = ''
  password.value = ''
  dialogError.value = ''
  dialogOpen.value = true
}
async function submit() {
  if (!isSuperAdmin.value || submitting.value) return
  if (action.value === 'create' && (!/^[a-z0-9][a-z0-9_.-]{2,63}$/.test(username.value) || !displayName.value.trim())) {
    dialogError.value = '请填写显示名称；账号需为 3–64 位小写字母、数字、点、下划线或短横线，以字母或数字开头。'; return
  }
  if (action.value !== 'status' && (password.value.length < 12 || password.value.length > 128 || !/[a-zA-Z]/.test(password.value) || !/[0-9]/.test(password.value))) {
    dialogError.value = '密码需为 12–128 位，包含字母和数字。'; return
  }
  if (action.value !== 'create' && (!target.value || target.value.role !== 'operator')) return
  const current = begin()
  submitting.value = true
  dialogError.value = ''
  try {
    if (action.value === 'create') await adminApi.createAccount(username.value, displayName.value.trim(), password.value)
    else if (action.value === 'password' && target.value) await adminApi.resetPassword(target.value.id, password.value)
    else if (target.value) await adminApi.accountStatus(target.value.id, !target.value.active)
    if (!current()) return
    ElMessage.success(action.value === 'create' ? '运营账号已开通，请安全告知本人密码。' : action.value === 'password' ? '密码已重置，该账号可使用新密码重新登录。' : '账号状态已更新。')
    dialogOpen.value = false
    password.value = ''
  } catch (value) { if (current()) dialogError.value = errorMessage(value) }
  finally { if (current()) submitting.value = false }
  if (current() && !dialogOpen.value) await load()
}
onMounted(load)
</script>

<template>
  <section v-if="isSuperAdmin">
    <h1>运营账号</h1>
    <p class="page-description">
      为受信任的内部工作人员开通账号，管理密码和使用状态。
    </p>
    <div class="panel">
      <div class="toolbar">
        <span class="muted">后台账号与小程序会员身份独立</span><div class="actions">
          <el-button
            :disabled="loading || submitting"
            @click="load"
          >
            刷新
          </el-button><el-button
            type="primary"
            :disabled="loading || submitting"
            @click="open('create')"
          >
            开通运营账号
          </el-button>
        </div>
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
        row-key="id"
        empty-text="暂无后台账号"
      >
        <el-table-column
          prop="displayName"
          label="名称"
          min-width="140"
        />
        <el-table-column
          prop="username"
          label="账号"
          min-width="150"
        />
        <el-table-column
          label="角色"
          width="140"
        >
          <template #default="{ row }">
            {{ row.role === 'super_admin' ? '超级管理员' : '普通运营' }}
          </template>
        </el-table-column>
        <el-table-column
          label="状态"
          min-width="160"
        >
          <template #default="{ row }">
            <el-tag :type="row.active ? 'success' : 'info'">
              {{ row.active ? '启用中' : '已停用' }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column
          label="开通时间"
          min-width="180"
        >
          <template #default="{ row }">
            {{ formatDate(row.createdAt) }}
          </template>
        </el-table-column>
        <el-table-column
          label="操作"
          width="200"
          fixed="right"
        >
          <template #default="{ row }">
            <template v-if="row.role === 'operator'">
              <el-button
                text
                :disabled="submitting || loading"
                @click="open('password', row)"
              >
                重置密码
              </el-button><el-button
                text
                :type="row.active ? 'danger' : 'primary'"
                :disabled="submitting || loading"
                @click="open('status', row)"
              >
                {{ row.active ? '停用' : '启用' }}
              </el-button>
            </template><span
              v-else
              class="muted"
            >由部署维护人员管理</span>
          </template>
        </el-table-column>
      </el-table>
    </div>
    <el-dialog
      v-model="dialogOpen"
      :title="action === 'create' ? '开通运营账号' : action === 'password' ? '重置运营密码' : target?.active ? '停用运营账号' : '启用运营账号'"
      width="520px"
      :close-on-click-modal="false"
      :close-on-press-escape="!submitting"
      :show-close="!submitting"
      destroy-on-close
      @closed="password = ''; target = null"
    >
      <p v-if="target">
        <strong>{{ target.displayName }}</strong> · {{ target.username }}
      </p>
      <p
        v-if="action === 'status'"
        class="muted"
      >
        {{ target?.active ? '停用后，该账号将立即退出所有设备，无法继续登录。历史操作记录会保留。' : '启用后，该工作人员可再次使用后台。' }}
      </p>
      <p
        v-else
        class="muted"
      >
        密码请通过安全渠道告知本人。可直接登录，也可自行修改；重置密码会使已有登录失效。
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
        @submit.prevent="submit"
      >
        <template v-if="action === 'create'">
          <el-form-item label="账号（3–64 位小写字母、数字或 _ . -）">
            <el-input
              v-model="username"
              autocomplete="off"
              :maxlength="64"
              :disabled="submitting"
            />
          </el-form-item>
          <el-form-item label="显示名称">
            <el-input
              v-model="displayName"
              autocomplete="off"
              :maxlength="80"
              :disabled="submitting"
            />
          </el-form-item>
        </template>
        <el-form-item
          v-if="action !== 'status'"
          label="密码（12–128 位，包含字母和数字）"
        >
          <el-input
            v-model="password"
            type="password"
            autocomplete="new-password"
            show-password
            :maxlength="128"
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
          :type="action === 'status' && target?.active ? 'danger' : 'primary'"
          :loading="submitting"
          @click="submit"
        >
          确认{{ action === 'create' ? '开通' : action === 'password' ? '重置' : target?.active ? '停用' : '启用' }}
        </el-button>
      </template>
    </el-dialog>
  </section>
  <el-result
    v-else
    icon="warning"
    title="仅超级管理员可以管理运营账号"
  />
</template>
