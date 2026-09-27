import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { URL } from 'node:url'
import { setImmediate } from 'node:timers/promises'
import ts from 'typescript'

const require = createRequire(import.meta.url)
const { reactive, effectScope } = require('vue')
class ApiError extends Error {
  constructor(code, message, status = 0) { super(message); this.code = code; this.status = status }
}
function harness(t, token = '', reading = {}, navigation = {}) {
  const session = reactive({ token, epoch: 0 })
  const calls = { activity: [], roster: [], myRegistration: [] }
  const api = Object.fromEntries(Object.keys(calls).map(method => [method, () => new Promise((resolve, reject) => {
    calls[method].push({ token: session.token, resolve, reject })
  })]))
  let unload, show
  const dependencies = {
    '@dcloudio/uni-app': { onLoad() {}, onShow(callback) { show = callback }, onUnload(callback) { unload = callback }, onShareAppMessage() {} },
    '@/services/reading': { createReadingVisit: reading.createVisit || (() => ({ record: async () => {} })) },
    '@/services/api': { api: { ...api, activityReaders: reading.list || (async () => ({items:[], total:0, hasMore:false})) }, ApiError, errorMessage: e => e.message },
    '@/services/api/environment': {}, '@/services/presentation': {}, '@/services/navigation': navigation,
    '@/stores/session': { useSessionStore: () => session },
  }
  const source = readFileSync(new URL('../src/pages/activity/detail.vue', import.meta.url), 'utf8')
    .match(/<script setup lang="ts">([\s\S]*?)<\/script>/)[1]
  const code = ts.transpileModule(source + '\nexport {load,id,activity,registration,loading,error,readers,readersError,loadReaders,openMember};', {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText
  const page = {}, scope = effectScope()
  scope.run(() => new Function('require', 'exports', code)(name => dependencies[name] || require(name), page))
  t.after(() => scope.stop())
  page.id.value = 'activity-a'
  async function publicResponse(title = 'Activity') {
    calls.activity.shift().resolve({ title, registrationState: 'full' })
    await setImmediate()
    calls.roster.shift().resolve({ items: [] })
    await setImmediate()
  }
  return { page, session, calls, publicResponse, unload: () => unload(), show: () => show() }
}

test('public details finish before login, then late identity loads the existing registration', async t => {
  const h = harness(t)
  const initial = h.page.load()
  await h.publicResponse()
  await initial
  assert.equal(h.page.loading.value, false)
  assert.equal(h.page.activity.value.registrationState, 'full')
  assert.equal(h.calls.myRegistration.length, 0)
  h.session.token = 'identified-member'
  await setImmediate()
  assert.equal(h.calls.myRegistration.length, 1)
  assert.equal(h.calls.myRegistration[0].token, 'identified-member')
  await h.publicResponse()
  assert.equal(h.page.loading.value, false, 'public details do not wait for the private lookup')
  h.calls.myRegistration.shift().resolve({ status: 'active' })
  await setImmediate()
  assert.equal(h.page.registration.value.status, 'active')
})

test('logout clears the displayed registration and ignores a late private response', async t => {
  const h = harness(t, 'old-member')
  void h.page.load()
  await h.publicResponse()
  h.calls.myRegistration.shift().resolve({ status: 'active' })
  await setImmediate()
  assert.equal(h.page.registration.value.status, 'active')
  void h.page.load()
  const late = h.calls.myRegistration.shift()
  h.session.epoch++
  h.session.token = ''
  await setImmediate()
  assert.equal(h.page.registration.value, null)
  late.resolve({ status: 'active' })
  await setImmediate()
  assert.equal(h.page.registration.value, null)
  assert.equal(h.page.error.value, '')
})

test('account switch keeps the new registration when old success or failure arrives last', async t => {
  for (const fail of [false, true]) {
    const h = harness(t, 'old-member')
    void h.page.load()
    const old = h.calls.myRegistration.shift()
    h.session.epoch++
    h.session.token = 'new-member'
    await setImmediate()
    h.calls.myRegistration.shift().resolve({ status: 'cancelled', memberId: 'new-member' })
    await setImmediate()
    if (fail) old.reject(new ApiError('STALE_REQUEST', 'Old request failed'))
    else old.resolve({ status: 'active', memberId: 'old-member' })
    await setImmediate()
    assert.equal(h.page.registration.value.memberId, 'new-member')
    assert.equal(h.page.error.value, '')
  }
})

test('a newer refresh supersedes an older registration response in the same session', async t => {
  const h = harness(t, 'member')
  void h.page.load()
  const old = h.calls.myRegistration.shift()
  void h.page.load()
  h.calls.myRegistration.shift().resolve({ status: 'cancelled' })
  await setImmediate()
  old.resolve({ status: 'active' })
  await setImmediate()
  assert.equal(h.page.registration.value.status, 'cancelled')
})

test('missing registration is allowed, while a real lookup failure remains visible', async t => {
  const h = harness(t, 'member')
  void h.page.load()
  h.calls.myRegistration.shift().reject(new ApiError('NOT_FOUND', 'No registration', 404))
  await setImmediate()
  assert.equal(h.page.error.value, '')
  void h.page.load()
  h.calls.myRegistration.shift().reject(new ApiError('NETWORK_ERROR', 'Network unavailable'))
  await setImmediate()
  assert.equal(h.page.error.value, 'Network unavailable')
})

test('unloaded details ignore pending private and public responses', async t => {
  const h = harness(t, 'member')
  void h.page.load()
  h.unload()
  h.calls.myRegistration.shift().resolve({ status: 'active' })
  h.calls.activity.shift().resolve({ title: 'Late activity' })
  await setImmediate()
  assert.equal(h.page.registration.value, null)
  assert.equal(h.page.activity.value, null)
  assert.equal(h.calls.roster.length, 0)
  h.session.token = 'another-member'
  await setImmediate()
  assert.equal(h.calls.activity.length, 0)
  assert.equal(h.calls.myRegistration.length, 0)
})


test('reading uses one visit across identity refresh and retry, and a new visit on returning', async t => {
  let visits = 0
  const recorded = []
  const h = harness(t, '', { createVisit: () => {
    const number = ++visits
    return { record: async () => { recorded.push(number) } }
  } })
  h.show(); await h.publicResponse()
  h.session.token = 'member'
  await setImmediate(); await h.publicResponse()
  await h.page.loadReaders()
  assert.deepEqual(recorded, [1, 1, 1])
  h.show(); await h.publicResponse()
  assert.deepEqual(recorded, [1, 1, 1, 2])
})

test('reading failure does not block public details, and unload ignores a late list', async t => {
  const h = harness(t, '', { list: async () => { throw new Error('offline') } })
  void h.page.load(); await h.publicResponse()
  assert.equal(h.page.loading.value, false)
  assert.equal(h.page.error.value, '')
  assert.equal(h.page.readersError.value, 'offline')
  let resolve
  const late = harness(t, '', { list: () => new Promise(done => { resolve = done }) })
  void late.page.load(); await late.publicResponse()
  late.unload()
  resolve({ items: [{ avatarUrl:null, displayName:'old member' }], total:1, hasMore:false })
  await setImmediate()
  assert.equal(late.page.readers.value.items.length, 0)
})

test('reading pagination fetches the next offset without recording another view', async t => {
  let records = 0
  const offsets = []
  const h = harness(t, '', {
    createVisit: () => ({ record: async () => { records++ } }),
    list: async (_id, offset) => {
      offsets.push(offset)
      return { items:[{avatarUrl:null, displayName:offset ? 'second' : 'first'}], total:2, hasMore:!offset }
    }
  })
  void h.page.load(); await h.publicResponse()
  await h.page.loadReaders(true)
  assert.deepEqual(offsets, [0, 1])
  assert.equal(records, 1)
  assert.deepEqual(h.page.readers.value.items.map(p => p.displayName), ['first', 'second'])
})


test('member card entry preserves target and coalesces taps until profile gate resolves', async t => {
  let finishGate
  const targets = [], navigated = []
  const h = harness(t, 'member', {}, {
    routes: { memberCard: '/pages/member/card' },
    requireProfile: target => { targets.push(target); return new Promise(resolve => { finishGate = resolve }) },
    navigate: target => navigated.push(target),
  })
  const first = h.page.openMember('person-a')
  await h.page.openMember('person-b')
  assert.deepEqual(targets, ['/pages/member/card?id=person-a'])
  finishGate(true)
  await first
  assert.deepEqual(navigated, targets)
  const second = h.page.openMember('person-b')
  finishGate(false)
  await second
  assert.equal(navigated.length, 1)
  const late = h.page.openMember('person-c')
  h.unload()
  finishGate(true)
  await late
  assert.equal(navigated.length, 1, 'unloaded page cannot navigate from late gate')
})
