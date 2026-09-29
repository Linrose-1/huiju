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
    <h1>会聚管理后台</h1>
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
        会聚 <span>管理后台</span>
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
        <router-link to="/members">
          会员查询
        </router-link>
        <router-link to="/feedback">
          评论与点评
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
h1 { margin: 0 0 8px; font-size: 26px; line-height: 1.4; font-weight: 600; }
p { line-height: 1.65; }
.muted, .page-description { color: var(--huiju-muted); }
.page-description { margin: 0 0 24px; font-size: 14px; }
.app-header { display: flex; justify-content: space-between; align-items: center; min-height: 76px; padding: 16px 32px; border-bottom: 1px solid var(--huiju-border); background: white; gap: 16px; }
.brand { font-size: 24px; font-weight: 700; white-space: nowrap; color: var(--huiju-green); }
.brand span { margin-left: 12px; font-size: 14px; color: var(--huiju-muted); font-weight: 400; }
.identity { display: flex; align-items: center; gap: 8px; font-size: 14px; flex-wrap: wrap; }
.workspace { display: flex; min-height: calc(100vh - 76px); }
.sidebar { flex: 0 0 192px; padding: 24px 16px; border-right: 1px solid var(--huiju-border); }
.sidebar a { display: block; padding: 12px 16px; margin-bottom: 8px; border-radius: 8px; color: var(--huiju-muted); text-decoration: none; }
.sidebar a:hover, .sidebar .router-link-active { color: var(--huiju-green); background: #e7f0e9; }
.sidebar .router-link-active { font-weight: 600; }
.page-main { flex: 1; min-width: 0; padding: 32px; }
.panel { background: white; border: 1px solid var(--huiju-border); border-radius: 12px; padding: 24px; }
.toolbar { display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 16px; margin-bottom: 20px; }
.filters, .actions { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; }
.pagination { display: flex; align-items: center; justify-content: flex-end; gap: 16px; margin-top: 20px; font-size: 14px; color: var(--huiju-muted); font-variant-numeric: tabular-nums; }
.auth-shell, .startup { min-height: 100vh; display: grid; align-content: center; justify-items: center; padding: 32px 20px; gap: 20px; }
.auth-card { width: min(100%, 420px); }
.password-card { max-width: 520px; margin: 0 auto; }
.full-width { width: 100%; }
.form-error { margin-bottom: 16px; }
.feedback-content { white-space: pre-wrap; overflow-wrap: anywhere; line-height: 1.65; margin: 8px 0; }
.el-button { min-height: 40px; }
.el-input__wrapper, .el-select__wrapper { min-height: 40px; }
.el-table { --el-table-header-bg-color: #f6f8f6; --el-table-border-color: var(--huiju-border); }
.el-dialog { max-width: calc(100vw - 32px); }
@media (max-width: 760px) { .app-header { padding: 16px; align-items: flex-start; flex-direction: column; } .workspace { flex-direction: column; } .sidebar { flex-basis: auto; display: flex; padding: 12px 16px; gap: 8px; border-right: 0; border-bottom: 1px solid var(--huiju-border); } .sidebar a { margin: 0; } .page-main { padding: 20px 16px; } .panel { padding: 16px; } h1 { font-size: 22px; } }
</style>
