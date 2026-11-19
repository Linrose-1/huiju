<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import { ElMessage } from 'element-plus'
import { adminApi, AdminRequestError, errorMessage, isSuperAdmin, session } from './services/admin'
import { allowedRoute, router } from './router'
import { brand, refreshBrand } from './services/brand'

const route = useRoute()
const ready = ref(false)
const startupError = ref('')
const loggingOut = ref(false)
const restoring = ref(false)
const navigation = [
  { title: '概览', items: [{ path: '/analytics', label: '运营看板' }, { path: '/engagement', label: '会员活跃' }] },
  { title: '运营管理', items: [
    { path: '/activities', label: '活动管理' }, { path: '/members', label: '会员查询' },
    { path: '/circle', label: '学友圈管理' }, { path: '/feedback', label: '评论与点评' },
    { path: '/advertising', label: '首页广告' }, { path: '/content', label: '运营文案' },
  ] },
  { title: '系统设置', superAdmin: true, items: [
    { path: '/brand', label: '品牌设置' }, { path: '/mcp-settings', label: 'MCP 接入设置' },
    { path: '/accounts', label: '运营账号' },
  ] },
]
const pageLabel = computed(() => route.meta?.title ?? (route.path === '/password' ? '修改密码'
  : navigation.flatMap(group => group.items).find(item => item.path === route.path)?.label ?? '管理后台'))

function accountAction(command: string) {
  if (command === 'password') void router.push('/password')
  if (command === 'logout') void logout()
}
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
    await router.replace(allowedRoute(route.path) ?? route.fullPath ?? route.path)
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
onMounted(() => { void refreshBrand().catch(() => {}) })
watch(() => [brand.displayName, brand.visible], () => {
  if (globalThis.document) globalThis.document.title = `${brand.visible ? brand.displayName + ' ' : ''}管理后台`
}, { immediate: true })
</script>

<template>
  <div
    v-if="!ready"
    class="startup"
  >
    <h1>{{ brand.visible ? brand.displayName + ' ' : '' }}管理后台</h1>
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
        <template v-if="brand.visible">
          <img
            v-if="brand.logoUrl"
            :src="brand.logoUrl"
            class="brand-logo"
            alt=""
          >
          <strong
            class="brand-name"
            :title="brand.displayName"
          >
            {{ brand.displayName }}
          </strong>
        </template><span>管理后台</span>
      </div>
      <div class="header-content">
        <span class="current-page">{{ pageLabel }}</span>
        <el-dropdown
          trigger="click"
          placement="bottom-end"
          @command="accountAction"
        >
          <el-button
            class="identity"
            text
            aria-label="账号菜单"
            :loading="loggingOut"
          >
            <span class="identity-name">{{ session.account.displayName }}</span>
            <span class="identity-role">{{ isSuperAdmin ? '超级管理员' : '普通运营' }}</span>
            <span
              class="menu-chevron"
              aria-hidden="true"
            />
          </el-button>
          <template #dropdown>
            <el-dropdown-menu>
              <el-dropdown-item command="password">
                修改密码
              </el-dropdown-item>
              <el-dropdown-item
                command="logout"
                :disabled="loggingOut"
                divided
              >
                退出登录
              </el-dropdown-item>
            </el-dropdown-menu>
          </template>
        </el-dropdown>
      </div>
    </header>
    <div class="workspace">
      <nav
        class="sidebar"
        aria-label="后台导航"
      >
        <template
          v-for="group in navigation"
          :key="group.title"
        >
          <div
            v-if="!group.superAdmin || isSuperAdmin"
            class="nav-group"
            role="group"
            :aria-label="group.title"
          >
            <div class="nav-group-title">
              {{ group.title }}
            </div>
            <router-link
              v-for="item in group.items"
              :key="item.path"
              :to="item.path"
              :class="{ 'router-link-active': item.path === '/activities' && route.meta.activityPage }"
            >
              {{ item.label }}
            </router-link>
          </div>
        </template>
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
.app-shell { --sidebar-width: 196px; --header-height: 60px; }
.app-header { position: sticky; top: 0; z-index: 10; display: grid; grid-template-columns: var(--sidebar-width) minmax(0, 1fr); height: var(--header-height); border-bottom: 1px solid var(--huiju-border); background: white; }
.brand { font-size: 20px; font-weight: 700; overflow-wrap: anywhere; color: var(--huiju-green); }
.brand-logo { width:32px; height:32px; object-fit:contain; margin-right:8px; vertical-align:middle; }
.brand span { margin-left: 10px; font-size: 13px; color: var(--huiju-muted); font-weight: 400; }
.app-header .brand { display: flex; align-items: center; gap: 8px; min-width: 0; padding: 12px 16px; border-right: 1px solid var(--huiju-border); }
.app-header .brand span, .app-header .brand-logo { margin: 0; }
.app-header .brand span, .app-header .brand-logo { flex-shrink: 0; }
.brand-name { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.header-content { display: flex; align-items: center; justify-content: space-between; gap: 8px; min-width: 0; padding: 0 24px; }
.current-page { font-size: 14px; font-weight: 600; }
.identity.el-button { max-width: 100%; color: inherit; }
.identity-name { max-width: 12ch; overflow: hidden; text-overflow: ellipsis; }
.identity-role { font-size: 12px; color: var(--huiju-muted); margin-left: 8px; }
.menu-chevron { width: 6px; height: 6px; margin: -3px 0 0 10px; border-right: 1.5px solid; border-bottom: 1.5px solid; transform: rotate(45deg); }
.workspace { display: flex; min-height: calc(100vh - var(--header-height)); }
.sidebar { position: sticky; top: var(--header-height); align-self: flex-start; flex: 0 0 var(--sidebar-width); height: calc(100dvh - var(--header-height)); overflow-y: auto; padding: 16px 12px; border-right: 1px solid var(--huiju-border); background: white; }
.nav-group + .nav-group { margin-top: 14px; padding-top: 12px; border-top: 1px solid var(--huiju-border); }
.nav-group-title { padding: 4px 12px 6px; font-size: 12px; font-weight: 600; color: var(--huiju-muted); }
.sidebar a { display: block; padding: 9px 12px; margin: 2px 0; border-radius: 6px; color: inherit; text-decoration: none; font-size: 14px; }
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
@media (max-width: 760px) {
  .app-header { position: static; grid-template-columns: 1fr; height: auto; }
  .app-header .brand { border-right: 0; padding-bottom: 4px; }
  .header-content { padding: 0 16px 6px; }
  .workspace { flex-direction: column; }
  .sidebar { position: static; align-self: stretch; flex-basis: auto; height: auto; overflow: visible; padding: 6px 12px; border-right: 0; border-bottom: 1px solid var(--huiju-border); }
  .nav-group { display: flex; flex-wrap: wrap; align-items: center; gap: 2px; }
  .nav-group + .nav-group { margin-top: 3px; padding-top: 3px; }
  .sidebar a { margin: 0; }
  .page-main { padding: 16px; }
  .panel { padding: 16px; }
  h1 { font-size: 20px; }
}
</style>
