import { readFileSync } from 'node:fs'
import ts from 'typescript'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as vue from 'vue'
import { createMemoryHistory } from 'vue-router'
import { adminApi, AdminRequestError, clearSession, session } from '../src/services/admin'
import * as admin from '../src/services/admin'
import { useRequestScope } from '../src/services/request-scope'
import { router, allowedRoute } from '../src/router'

vi.mock('vue-router', async importOriginal => ({
  ...await importOriginal<typeof import('vue-router')>(),
  createWebHistory: () => createMemoryHistory(),
}))

const scopes: vue.EffectScope[] = []
const account = { id: 'operator', username: 'operator', displayName: '运营', role: 'operator' as const, active: true, mustChangePassword: false, createdAt: '2026-10-02T00:00:00Z' }
function pageScript(path: string, exported: string, dependencies: Record<string, unknown>) {
  const source = readFileSync(new URL(path, import.meta.url), 'utf8').match(/<script setup lang="ts">([\s\S]*?)<\/script>/)![1]
  const code = ts.transpileModule(`${source}\nexport { ${exported} };`, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
  const scope = vue.effectScope()
  scopes.push(scope)
  const result: Record<string, unknown> = {}
  scope.run(() => new Function('require', 'exports', code)(
    (name: string) => name === 'vue' ? { ...vue, onMounted() {} } : dependencies[name], result,
  ))
  return result
}
function app() {
  return pageScript('../src/App.vue', 'restore, ready, startupError', {
    './services/admin': admin,
    './router': { router, allowedRoute },
    'vue-router': { useRoute: () => ({ get path() { return router.currentRoute.value.path } }) },
    'element-plus': { ElMessage: { error: vi.fn() } },
  }) as { restore(): Promise<void>; ready: vue.Ref<boolean>; startupError: vue.Ref<string> }
}
beforeEach(() => {
  clearSession()
  // Each test starts a fresh browser session bootstrap.
  session.initialized = false
})
afterEach(() => { scopes.splice(0).forEach(scope => scope.stop()); vi.restoreAllMocks() })

describe('admin page navigation and filtering', () => {
  it('waits for initial navigation when cookie restoration resolves immediately', async () => {
    const navigation = router.push('/members')
    const root = app()
    vi.spyOn(adminApi, 'restore').mockImplementation(async () => { session.account = { ...account } })
    await Promise.all([navigation, root.restore()])
    expect(root.ready.value).toBe(true)
    expect(router.currentRoute.value.path).toBe('/members')
  })
  it.each(['/members', '/activities', '/password'])('preserves direct %s while restoring a valid cookie', async path => {
    await router.push(path)
    const root = app()
    let resolve!: () => void
    vi.spyOn(adminApi, 'restore').mockImplementation(() => new Promise<void>(done => {
      resolve = () => { session.account = { ...account }; done() }
    }))
    const pending = root.restore()
    expect(root.ready.value).toBe(false)
    expect(router.currentRoute.value.path).toBe(path)
    resolve()
    await pending
    expect(root.ready.value).toBe(true)
    expect(router.currentRoute.value.path).toBe(path)
  })
  it('keeps the target through startup network failure and retry, then guards logout and operator routes', async () => {
    await router.push('/accounts')
    const root = app()
    vi.spyOn(adminApi, 'restore').mockRejectedValueOnce(new Error('网络连接失败'))
      .mockImplementationOnce(async () => { session.account = { ...account } })
    await root.restore()
    expect(root.ready.value).toBe(false)
    expect(root.startupError.value).toBe('网络连接失败')
    expect(router.currentRoute.value.path).toBe('/accounts')
    await root.restore()
    expect(root.ready.value).toBe(true)
    expect(router.currentRoute.value.path).toBe('/feedback')
    clearSession()
    await vue.nextTick()
    await router.push('/members')
    expect(router.currentRoute.value.path).toBe('/login')
  })
  it('redirects an expired cookie to login after restore returns 401', async () => {
    await router.push('/members')
    const root = app()
    vi.spyOn(adminApi, 'restore').mockRejectedValue(new AdminRequestError(401, 'ADMIN_SESSION_REQUIRED', '登录已失效'))
    await root.restore()
    expect(root.ready.value).toBe(true)
    expect(root.startupError.value).toBe('')
    expect(router.currentRoute.value.path).toBe('/login')
  })
  it('retains a super administrator account route and does not show business views after a 403', async () => {
    await router.push('/accounts')
    const root = app()
    vi.spyOn(adminApi, 'restore').mockRejectedValueOnce(new AdminRequestError(403, 'ADMIN_FORBIDDEN', '没有权限'))
      .mockImplementationOnce(async () => { session.account = { ...account, role: 'super_admin' } })
    await root.restore()
    expect(root.ready.value).toBe(false)
    expect(session.initialized).toBe(false)
    expect(root.startupError.value).toBe('没有权限')
    await root.restore()
    expect(root.ready.value).toBe(true)
    expect(router.currentRoute.value.path).toBe('/accounts')
    const redirected = new Promise<void>(resolve => {
      const stop = router.afterEach(to => { if (to.path === '/login') { stop(); resolve() } })
    })
    clearSession()
    await redirected
    expect(router.currentRoute.value.path).toBe('/login')
  })
  it('pages and refreshes applied activity filters until a new query is submitted', async () => {
    const requests = vi.spyOn(adminApi, 'activities').mockResolvedValue({ items: [], total: 60, hasMore: true })
    const page = pageScript('../src/modules/activities/ActivitiesPage.vue', 'keyword, status, load, changePage, offset', {
      '../../services/admin': admin,
      '../../services/request-scope': { useRequestScope },
      'element-plus': { ElMessage: { success: vi.fn() } },
    }) as { keyword: vue.Ref<string>; status: vue.Ref<string>; offset: vue.Ref<number>; load(reset?: boolean): Promise<void>; changePage(back: boolean): void }
    page.keyword.value = '原关键词'
    await page.load(true)
    page.keyword.value = '新关键词'
    page.changePage(false)
    await vue.nextTick()
    expect(requests).toHaveBeenLastCalledWith({ status: 'all', q: '原关键词', offset: 20 })
    await page.load()
    expect(requests).toHaveBeenLastCalledWith({ status: 'all', q: '原关键词', offset: 20 })
    await page.load(true)
    expect(requests).toHaveBeenLastCalledWith({ status: 'all', q: '新关键词', offset: 0 })
    page.changePage(false)
    await vue.nextTick()
    page.status.value = 'removed'
    await page.load(true)
    expect(requests).toHaveBeenLastCalledWith({ status: 'removed', q: '新关键词', offset: 0 })
  })
})
