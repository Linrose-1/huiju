<script setup lang="ts">
import { onMounted, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import { ElMessage } from 'element-plus'
import { adminApi, AdminRequestError, errorMessage, isSuperAdmin, session } from './services/admin'
import { allowedRoute, router } from './router'

const route = useRoute()
const ready = ref(false)
const startupError = ref('')
const loggingOut = ref(false)
const restoring = ref(false)
async function restore() {
  if (restoring.value) return
  restoring.value = true
  startupError.value = ''
  try { await adminApi.restore() }
  catch (error) {
    if (!(error instanceof AdminRequestError && error.status === 401)) startupError.value = errorMessage(error)
  }
  if (!startupError.value) {
    await router.isReady()
    session.initialized = true
    await router.replace(allowedRoute(route.path) ?? route.path)
    ready.value = true
  }
  restoring.value = false
}
async function logout() {
  if (loggingOut.value) return
  loggingOut.value = true
  try { await adminApi.logout() }
  catch (error) { ElMessage.error(errorMessage(error)) }
  finally { loggingOut.value = false }
}
watch(() => session.epoch, () => {
  if (ready.value) {
    const redirect = allowedRoute(route.path)
    if (redirect) void router.replace(redirect)
  }
})
onMounted(restore)
</script>

<template>
  <div
    v-if="!ready"
    class="startup"
  >
    <h1>有聚点管理后台</h1>
    <template v-if="startupError">
      <el-alert
        :title="startupError"
        type="error"
        :closable="false"
      />
      <el-button
        :loading="restoring"
        @click="restore"
      >
        重新连接
      </el-button>
    </template>
    <p
      v-else
      role="status"
    >
      正在确认登录状态…
    </p>
  </div>
  <div
    v-else-if="session.account"
    class="app-shell"
  >
    <header class="app-header">
      <div class="brand">
        有聚点 <span>管理后台</span>
      </div>
      <div class="identity">
        <span>{{ session.account.displayName }} · {{ isSuperAdmin ? '超级管理员' : '普通运营' }}</span>
        <el-button
          text
          @click="router.push('/password')"
        >
          修改密码
        </el-button>
        <el-button
          text
          :loading="loggingOut"
          @click="logout"
        >
          退出登录
        </el-button>
      </div>
    </header>
    <div class="workspace">
      <nav
        class="sidebar"
        aria-label="后台导航"
      >
        <router-link to="/analytics">
          运营看板
        </router-link>
        <router-link to="/engagement">
          会员活跃
        </router-link>
        <router-link to="/content">
          运营文案
        </router-link>
        <router-link to="/advertising">
          首页广告
        </router-link>
        <router-link to="/members">
          会员查询
        </router-link>
        <router-link to="/feedback">
          评论与点评
        </router-link>
        <router-link to="/activities">
          活动管理
        </router-link>
        <router-link to="/circle">
          学友圈管理
        </router-link>
        <router-link
          v-if="isSuperAdmin"
          to="/accounts"
        >
          运营账号
        </router-link>
      </nav>
      <main class="page-main">
        <router-view :key="`${session.epoch}:${route.path}`" />
      </main>
    </div>
  </div>
  <main
    v-else
    class="auth-shell"
  >
    <router-view :key="session.epoch" />
  </main>
</template>

<style>
:root { font-family: 'PingFang SC', 'Microsoft YaHei', sans-serif; color: #213c31; background: #f5f7f5; --huiju-green: #247552; --huiju-muted: #6d7f74; --huiju-border: #e3e9e4; --el-color-primary: var(--huiju-green); --el-color-primary-light-3: #639e83; --el-color-primary-light-5: #91baa6; --el-color-primary-light-7: #bad4c7; --el-color-primary-light-8: #d3e4db; --el-color-primary-light-9: #eaf3ee; --el-color-primary-dark-2: #1d5e42; }
* { box-sizing: border-box; }
body { margin: 0; }
button, input, textarea { font: inherit; }
h1 { margin: 0 0 6px; font-size: 22px; line-height: 1.4; font-weight: 600; }
h2 { margin: 0 0 12px; font-size: 17px; line-height: 1.5; font-weight: 600; }
h3 { margin: 24px 0 12px; font-size: 15px; line-height: 1.5; font-weight: 600; }
p { line-height: 1.65; }
.muted, .page-description { color: var(--huiju-muted); }
.page-description { margin: 0 0 20px; font-size: 14px; }
.app-header { display: flex; justify-content: space-between; align-items: center; min-height: 60px; padding: 0 24px; border-bottom: 1px solid var(--huiju-border); background: white; gap: 16px; }
.brand { font-size: 20px; font-weight: 700; white-space: nowrap; color: var(--huiju-green); }
.brand span { margin-left: 10px; font-size: 13px; color: var(--huiju-muted); font-weight: 400; }
.identity { display: flex; align-items: center; gap: 4px; font-size: 13px; flex-wrap: wrap; }
.workspace { display: flex; min-height: calc(100vh - 60px); }
.sidebar { flex: 0 0 176px; padding: 20px 12px; border-right: 1px solid var(--huiju-border); }
.sidebar a { display: block; padding: 10px 14px; margin-bottom: 4px; border-radius: 8px; color: var(--huiju-muted); text-decoration: none; font-size: 14px; }
.sidebar a:hover, .sidebar .router-link-active { color: var(--huiju-green); background: #e7f0e9; }
.sidebar .router-link-active { font-weight: 600; }
.page-main { flex: 1; min-width: 0; padding: 24px 28px; }
.panel { background: white; border: 1px solid var(--huiju-border); border-radius: 12px; padding: 20px; }
.toolbar { display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 12px; margin-bottom: 16px; }
.filters, .actions { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; }
.pagination { display: flex; align-items: center; justify-content: flex-end; gap: 12px; margin-top: 16px; font-size: 13px; color: var(--huiju-muted); font-variant-numeric: tabular-nums; }
.auth-shell, .startup { min-height: 100vh; display: grid; align-content: center; justify-items: center; padding: 32px 20px; gap: 20px; }
.auth-card { width: min(100%, 420px); }
.password-card { max-width: 520px; margin: 0 auto; }
.full-width { width: 100%; }
.form-error { margin-bottom: 16px; }
.feedback-content { white-space: pre-wrap; overflow-wrap: anywhere; line-height: 1.65; margin: 4px 0; }
.clamp { display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 2; overflow: hidden; }
.el-table .cell p { margin: 2px 0 0; }
.el-table .cell .el-tag { margin: 2px 0; }
.el-table .cell .el-button + .el-button { margin-left: 8px; }
.el-dialog h2 { margin: 0 0 12px; }
.el-dialog h3 { margin: 20px 0 10px; }
.el-dialog .pagination { justify-content: flex-start; margin-top: 12px; }
.el-drawer__body .el-avatar { margin-bottom: 12px; }
.el-button { min-height: 32px; }
.el-input__wrapper, .el-select__wrapper { min-height: 32px; }
.el-table { --el-table-header-bg-color: #f6f8f6; --el-table-border-color: var(--huiju-border); }
.el-dialog { max-width: calc(100vw - 32px); }
.el-dialog .el-dialog__body { max-height: 70vh; overflow-y: auto; }
@media (max-width: 760px) { .app-header { padding: 12px 16px; align-items: flex-start; flex-direction: column; min-height: 0; } .workspace { flex-direction: column; } .sidebar { flex-basis: auto; display: flex; flex-wrap: wrap; padding: 10px 12px; gap: 4px; border-right: 0; border-bottom: 1px solid var(--huiju-border); } .sidebar a { margin: 0; } .page-main { padding: 16px; } .panel { padding: 16px; } h1 { font-size: 20px; } }
</style>
