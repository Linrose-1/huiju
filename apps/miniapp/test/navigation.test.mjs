import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readFileSync } from 'node:fs'
import { URL } from 'node:url'
import ts from 'typescript'

function harness() {
  let page = { route: 'pages/activity/index' }
  const calls = [], toasts = [], member = { profileComplete: false }
  class ApiError extends Error {}
  const deps = {
    '@/services/api': { ApiError },
    '@/services/wechat': { bootstrapIdentity: async () => {} },
    '@/stores/session': { useSessionStore: () => ({ member }) }
  }
  const uni = {
    navigateTo: options => calls.push({ ...options, method: 'navigateTo' }), redirectTo: options => calls.push({ ...options, method: 'redirectTo' }),
    showToast: options => toasts.push(options)
  }
  const code = ts.transpileModule(readFileSync(new URL('../src/services/navigation.ts', import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
  }).outputText
  const nav = {}
  new Function('require', 'exports', 'uni', 'getCurrentPages', code)(name => deps[name], nav, uni, () => [page])
  return { nav, calls, toasts, uni, enter: route => { page = { route } } }
}

test('source-page duplicate taps stay blocked while target onShow can open profile completion', async () => {
  const h = harness()
  h.nav.navigate('/pages/activity/editor')
  h.nav.navigate('/pages/activity/editor')
  assert.equal(h.calls.length, 1)
  h.enter('pages/activity/editor')
  assert.equal(await h.nav.requireProfile('/pages/activity/editor'), false)
  assert.equal(h.calls.length, 2)
  assert.equal(h.calls[1].url, '/pages/login/index?returnTo=%2Fpages%2Factivity%2Feditor')
  assert.equal(h.calls[1].method, 'redirectTo')
  // 上一跳的延迟回调不能释放目标页新建的导航锁。
  h.calls[0].complete()
  h.nav.loginPage('/pages/activity/editor')
  assert.equal(h.calls.length, 2)
  h.calls[1].success()
  h.nav.loginPage('/pages/activity/editor')
  assert.equal(h.calls.length, 3)
})

test('success, failure, completion and synchronous throws all release their own navigation', () => {
  for (const callback of ['success', 'fail', 'complete']) {
    const h = harness()
    h.nav.navigate('/pages/circle/mine')
    h.calls[0][callback]()
    h.nav.navigate('/pages/circle/mine')
    assert.equal(h.calls.length, 2)
    assert.equal(h.toasts.length, callback === 'fail' ? 1 : 0)
  }
  const h = harness(), original = h.uni.navigateTo
  h.uni.navigateTo = () => { throw new Error('navigation unavailable') }
  assert.throws(() => h.nav.navigate('/pages/circle/mine'), /unavailable/)
  h.uni.navigateTo = original
  h.nav.navigate('/pages/circle/mine')
  assert.equal(h.calls.length, 1)
})

test('changed active page recovers navigation even if an earlier callback was lost', () => {
  const h = harness()
  h.nav.navigate('/pages/activity/editor')
  h.enter('pages/circle/index')
  h.nav.navigate('/pages/circle/mine')
  assert.equal(h.calls.length, 2)
  h.calls[0].success()
  h.nav.navigate('/pages/circle/mine')
  assert.equal(h.calls.length, 2)
})

test('profile gate replaces protected forms but preserves public detail for cancellation', async () => {
  for (const path of ['/pages/activity/editor', '/pages/registration/form', '/pages/circle/editor']) {
    const h = harness()
    h.enter(path.slice(1))
    await h.nav.requireProfile(path + '?id=test')
    assert.equal(h.calls[0].method, 'redirectTo')
    assert.equal(h.calls[0].url, '/pages/login/index?returnTo=' + encodeURIComponent(path + '?id=test'))
  }
  const h = harness()
  h.enter('pages/activity/detail')
  await h.nav.requireProfile('/pages/registration/form?id=test')
  assert.equal(h.calls[0].method, 'navigateTo')
})
