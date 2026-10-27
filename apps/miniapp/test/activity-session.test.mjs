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
  const session = reactive({ token, epoch: 0, captureInvite() {} })
  const calls = { activity: [], roster: [], myRegistration: [] }
  const api = Object.fromEntries(Object.keys(calls).map(method => [method, (...args) => new Promise((resolve, reject) => {
    calls[method].push({ token: session.token, args, resolve, reject })
  })]))
  let unload, show, onLoadPage
  const scrolls = []
  const dependencies = {
    '@dcloudio/uni-app': { onHide() {}, onReachBottom() {}, onPullDownRefresh() {}, onLoad(fn) { onLoadPage = fn }, onShow(callback) { show = callback }, onUnload(callback) { unload = callback }, onShareAppMessage() {}, onShareTimeline() {} },
    '@/services/reading': { createReadingVisit: reading.createVisit || (() => ({ record: async () => {} })) },
    '@/services/wechat': { showActivityShareMenu() {} },
    '@/services/api': { api: { ...api, activityReaders: reading.list || (async () => ({items:[], total:0, hasMore:false})) }, ApiError, errorMessage: e => e.message },
    '@/services/api/environment': {}, '@/services/presentation': {}, '@/services/navigation': navigation,
    '@/stores/session': { useSessionStore: () => session },
  }
  const source = readFileSync(new URL('../src/pages/activity/detail.vue', import.meta.url), 'utf8')
    .match(/<script setup lang="ts">([\s\S]*?)<\/script>/)[1]
  const code = ts.transpileModule(source + '\nexport {load,id,activity,registration,loading,error,readers,readersError,loadReaders,retryReaders,openMember,loadRegistration,registrationError,registrationKnown,registrationLoading,register,loadRoster,roster,rosterHasMore,rosterMoreError,openPeople};', {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText
  const page = {}, scope = effectScope()
  scope.run(() => new Function('require', 'exports', 'uni', code)(name => dependencies[name] || require(name), page, { stopPullDownRefresh() {}, pageScrollTo(options) { scrolls.push(options) } }))
  t.after(() => scope.stop())
  page.id.value = 'activity-a'
  async function publicResponse(title = 'Activity') {
    calls.activity.shift().resolve({ title, registrationState: 'full' })
    await setImmediate()
    calls.roster.shift().resolve({ items: [] })
    await setImmediate()
  }
  return { page, session, calls, publicResponse, scrolls, open: options => { onLoadPage(options); show() }, unload: () => unload(), show: () => show() }
}

test('roster and readers navigate to separate list views for the current activity', t => {
  const targets = []
  const h = harness(t, '', {}, { routes: { activityPeople: '/pages/activity/people' }, navigate: target => targets.push(target) })
  h.page.openPeople('roster'); h.page.openPeople('readers')
  assert.deepEqual(targets, ['/pages/activity/people?id=activity-a&kind=roster', '/pages/activity/people?id=activity-a&kind=readers'])
})

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
  assert.equal(h.page.error.value, '')
  assert.equal(h.page.registrationError.value, 'Network unavailable')
  assert.equal(h.page.registrationKnown.value, false)
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
      return { items:[{memberId: String(offset), avatarUrl:null, displayName:offset ? 'second' : 'first'}], total:2, hasMore:!offset }
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

test('private lookup failure keeps public activity visible, blocks unknown registration, and retries independently', async t => {
  const navigated = []
  const h = harness(t, 'member', {}, { navigate: target => navigated.push(target), routes: { result: '/registration' } })
  const initial = h.page.load()
  h.calls.myRegistration.shift().reject(new ApiError('NETWORK_ERROR', 'offline'))
  await h.publicResponse('Public activity'); await initial
  assert.equal(h.page.activity.value.title, 'Public activity')
  assert.equal(h.page.error.value, '')
  assert.equal(h.page.registrationError.value, 'offline')
  await h.page.register()
  assert.deepEqual(navigated, [], 'unknown private state cannot start or reopen a registration')
  const retry = h.page.loadRegistration()
  h.page.loadRegistration()
  assert.equal(h.calls.myRegistration.length, 1)
  assert.equal(h.calls.activity.length, 0, 'retry does not reload the public page')
  h.calls.myRegistration.shift().resolve({ status: 'active' }); await retry
  assert.equal(h.page.registrationKnown.value, true)
  assert.equal(h.page.registrationError.value, '')
  await h.page.register()
  assert.deepEqual(navigated, ['/registration?id=activity-a'])
})

test('public roster appends, preserves loaded rows on failure, retries raw offset and ignores old refresh', async t => {
  const h = harness(t)
  const initial = h.page.load()
  h.calls.activity.shift().resolve({ title: 'Activity', registrationState: 'open' }); await setImmediate()
  h.calls.roster.shift().resolve({ items: [{ memberId: 'a' }], hasMore: true }); await initial
  const more = h.page.loadRoster(true)
  h.page.loadRoster(true)
  assert.equal(h.calls.roster.length, 1)
  assert.equal(h.calls.roster[0].args[1].offset, 1)
  h.calls.roster.shift().reject(new Error('offline')); await more
  assert.deepEqual(h.page.roster.value.map(item => item.memberId), ['a'])
  await h.page.loadRoster(true)
  assert.equal(h.calls.roster.length, 0)
  h.page.rosterMoreError.value = ''; void h.page.loadRoster(true)
  assert.equal(h.calls.roster[0].args[1].offset, 1)
  h.calls.roster.shift().resolve({ items: [{ memberId: 'a' }, { memberId: 'b' }], hasMore: true }); await setImmediate()
  assert.deepEqual(h.page.roster.value.map(item => item.memberId), ['a', 'b'])
  const old = h.page.loadRoster(true), pending = h.calls.roster.shift()
  assert.equal(pending.args[1].offset, 3)
  const refresh = h.page.load()
  await h.publicResponse('Refreshed'); await refresh
  pending.resolve({ items: [{ memberId: 'old' }], hasMore: false }); await old
  assert.deepEqual(h.page.roster.value, [])
})

test('reader pagination failure keeps earlier page and explicit retry resumes without recording another view', async t => {
  let records = 0
  const requests = []
  const h = harness(t, '', {
    createVisit: () => ({ record: async () => { records++ } }),
    list: (_id, offset) => new Promise((resolve, reject) => requests.push({ offset, resolve, reject }))
  })
  const initial = h.page.load(); await h.publicResponse(); await initial
  requests[0].resolve({ items: [{ memberId: 'a' }], total: 2, hasMore: true }); await setImmediate()
  const more = h.page.loadReaders(true)
  requests[1].reject(new Error('offline')); await more
  assert.deepEqual(h.page.readers.value.items.map(item => item.memberId), ['a'])
  assert.equal(h.page.readersError.value, 'offline')
  h.page.retryReaders()
  assert.equal(requests[2].offset, 1)
  requests[2].resolve({ items: [{ memberId: 'b' }], total: 2, hasMore: false }); await setImmediate()
  assert.deepEqual(h.page.readers.value.items.map(item => item.memberId), ['a', 'b'])
  assert.equal(records, 1)
})
