import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readFileSync } from 'node:fs'
import { URL } from 'node:url'
import { createRequire } from 'node:module'
import ts from 'typescript'

const require = createRequire(import.meta.url)
class ApiError extends Error {
  constructor(code, message, status = 0) { super(message); this.code = code; this.status = status }
}
function evaluate(source, dependencies, globals = {}) {
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
  const exports = {}
  new Function('require', 'exports', ...Object.keys(globals), code)(
    name => name in dependencies ? dependencies[name] : require(name), exports, ...Object.values(globals),
  )
  return exports
}
function formHarness({ existing = null, lookupError = null } = {}) {
  let registration = existing
  let submitted = 0
  const navigations = []
  const activity = { registrationState: 'open', questions: [] }
  const api = {
    activity: async () => activity,
    myRegistration: async () => {
      if (lookupError) throw lookupError
      if (!registration) throw new ApiError('REGISTRATION_NOT_FOUND', '没有报名记录', 404)
      return registration
    },
    register: async () => {
      submitted++
      registration = { status: 'active' }
      activity.registrationState = 'full'
      throw new ApiError('NETWORK_ERROR', '响应超时')
    },
  }
  const source = readFileSync(new URL('../src/pages/registration/form.vue', import.meta.url), 'utf8')
    .match(/<script setup lang="ts">([\s\S]*?)<\/script>/)[1]
  const page = evaluate(source + '\nexport { load, submit, id, allowed, loading, error, phone };', {
    '@dcloudio/uni-app': { onLoad() {}, onShow() {} },
    '@/services/api': { api, ApiError, errorMessage: e => e.message },
    '@/services/presentation': { canEdit: () => true },
    '@/services/navigation': {
      routes: { form: '/pages/registration/form', result: '/pages/registration/detail' },
      requireProfile: async () => true, loginPage() {},
      navigate: (...args) => navigations.push(args),
    },
    '@/stores/session': { useSessionStore: () => ({ member: { id: 'member-a', boundPhone: '13800000000' } }) },
  })
  page.id.value = 'activity-a'
  return { page, navigations, submitted: () => submitted }
}

test('a committed registration with a lost response recovers to its record even when full', async () => {
  const h = formHarness()
  await h.page.load()
  assert.equal(h.page.allowed.value, true)
  await h.page.submit()
  assert.equal(h.submitted(), 1)
  assert.deepEqual(h.navigations, [['/pages/registration/detail?id=activity-a', true]])
  assert.equal(h.page.loading.value, false)
})
test('reopening an active registration form goes to the existing record without resubmitting', async () => {
  const h = formHarness({ existing: { status: 'active' } })
  await h.page.load()
  assert.equal(h.page.allowed.value, false)
  assert.equal(h.submitted(), 0)
  assert.equal(h.navigations.length, 1)
})
test('cancelled registration can be submitted again under current activity eligibility', async () => {
  const h = formHarness({ existing: { status: 'cancelled' } })
  await h.page.load()
  assert.equal(h.page.allowed.value, true)
  assert.equal(h.navigations.length, 0)
})
test('failed status lookup is not treated as absence or successful registration', async () => {
  const h = formHarness({ lookupError: new ApiError('NETWORK_ERROR', '连接失败') })
  await h.page.load()
  assert.equal(h.page.allowed.value, false)
  assert.equal(h.page.error.value, '连接失败')
  assert.equal(h.navigations.length, 0)
})

function navigationHarness(previous) {
  const calls = []
  const uni = Object.fromEntries(['navigateBack', 'switchTab', 'redirectTo', 'navigateTo'].map(method =>
    [method, options => { calls.push([method, options?.url]); options?.complete?.() }]))
  const source = readFileSync(new URL('../src/services/navigation.ts', import.meta.url), 'utf8')
  const navigation = evaluate(source, {
    '@/services/api': {}, '@/services/wechat': {}, '@/stores/session': {},
  }, { uni, getCurrentPages: () => [previous, { route: 'pages/login/index' }] })
  return { calls, navigation }
}
test('profile completion returns back only to the same activity and editing mode', () => {
  const h = navigationHarness({ route: 'pages/registration/form', options: { id: 'a', edit: '1' } })
  h.navigation.finishProfile('/pages/registration/form?id=a&edit=1')
  assert.equal(h.calls[0][0], 'navigateBack')
})
test('profile completion cannot return to another activity or a different editing mode', () => {
  for (const options of [{ id: 'b', edit: '1' }, { id: 'a' }]) {
    const h = navigationHarness({ route: 'pages/registration/form', options })
    h.navigation.finishProfile('/pages/registration/form?id=a&edit=1')
    assert.deepEqual(h.calls, [['redirectTo', '/pages/registration/form?id=a&edit=1']])
  }
})
test('tab return context uses switchTab with a path and external paths are rejected', () => {
  const h = navigationHarness({ route: 'pages/activity/detail', options: { id: 'a' } })
  h.navigation.finishProfile('/pages/activity/index?inviteCode=abc')
  h.navigation.finishProfile('https://invalid.example/path')
  assert.deepEqual(h.calls, [['switchTab', '/pages/activity/index'], ['switchTab', '/pages/activity/index']])
})
