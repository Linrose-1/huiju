import assert from 'node:assert/strict'
import { test } from 'node:test'
import { setImmediate } from 'node:timers/promises'
import { existsSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../src')
const require = createRequire(import.meta.url)
const { createPinia, setActivePinia } = require('pinia')
const base = 'https://test.invalid/api/v1'
const sampleMember = { id: 'member', memberNumber: 'HJ-1', displayName: 'Member', avatarUrl: null, boundPhone: null, profileComplete: false, inviteCode: 'ABC' }
function harness(initialStorage = new Map(), localTest = false, networkDebug = false) {
  setActivePinia(createPinia())
  const queue = []
  const logins = []
  const shares = []
  const locations = []
  const networkWarnings = []
  const storage = initialStorage
  const uni = {
    getStorageSync: key => storage.get(key),
    setStorageSync: (key, value) => storage.set(key, value),
    removeStorageSync: key => storage.delete(key),
    request: options => queue.push(options),
    login: options => logins.push(options),
    showShareMenu: options => shares.push(options),
    chooseLocation: options => locations.push(options),
  }
  const cache = new Map()
  function load(path) {
    if (path === '@/services/api/environment' || path === './environment') return { API_BASE_URL: base, LOCAL_TEST: localTest, NETWORK_DEBUG: networkDebug }
    let file = resolve(root, path.replace(/^@\//, '') + (path.endsWith('.ts') ? '' : '.ts'))
    if (!existsSync(file)) file = file.slice(0, -3) + '/index.ts'
    file = resolve(file)
    if (cache.has(file)) return cache.get(file).exports
    const module = { exports: {} }
    cache.set(file, module)
    const source = readFileSync(file, 'utf8').replace(/\/\/ #ifndef MP-WEIXIN[\s\S]*?\/\/ #endif/g, '')
    const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
    const localRequire = target => target.startsWith('@/') || target === './environment' ? load(target) : require(target)
    new Function('require', 'module', 'exports', 'uni', 'console', code)(localRequire, module, module.exports, uni, { warn: (...args) => networkWarnings.push(args) })
    return module.exports
  }
  const store = load('@/stores/session').useSessionStore()
  const api = load('@/services/api/index')
  const accept = token => store.accept({ token, expiresAt: new Date(Date.now() + 3600000).toISOString(), member: sampleMember })
  const respond = (statusCode, data) => { const request = queue.shift(); assert.ok(request, 'expected queued request'); request.success({ statusCode, data }); return request }
  const app = entry => {
    const hooks = {}
    uni.getEnterOptionsSync = () => entry
    const source = readFileSync(resolve(root, 'App.vue'), 'utf8').match(/<script setup lang="ts">([\s\S]*?)<\/script>/)[1]
    const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
    new Function('require', 'exports', 'uni', code)(name => name === '@dcloudio/uni-app'
      ? { onLaunch: fn => { hooks.onLaunch = fn }, onShow: fn => { hooks.onShow = fn } } : load(name), {}, uni)
    return hooks
  }
  return { store, api, queue, logins, shares, locations, networkWarnings, storage, accept, respond, app, wechat: () => load('@/services/wechat/index') }
}

test('map selection is explicit, joins address and place name and handles cancel or permission failure', async () => {
  const h = harness(), wechat = h.wechat()
  assert.equal(h.locations.length, 0)
  let request = wechat.chooseActivityLocation()
  h.locations.shift().success({address:'深圳市福田区',name:'会展中心',latitude:22.5,longitude:114.1})
  assert.deepEqual(await request, { location:'深圳市福田区 会展中心',latitude:22.5,longitude:114.1 })
  request = wechat.chooseActivityLocation()
  h.locations.shift().success({address:'深圳市会展中心',name:'会展中心',latitude:0,longitude:0})
  assert.deepEqual(await request, { location:'深圳市会展中心',latitude:0,longitude:0 })
  request = wechat.chooseActivityLocation()
  h.locations.shift().fail({errMsg:'chooseLocation:fail cancel'})
  assert.equal(await request, null)
  request = wechat.chooseActivityLocation()
  h.locations.shift().fail({errMsg:'chooseLocation:fail auth deny'})
  await assert.rejects(request, /位置权限/)
  request = wechat.chooseActivityLocation()
  h.locations.shift().success({address:'字'.repeat(501),name:''})
  await assert.rejects(request, /500/)
  request = wechat.chooseActivityLocation()
  h.locations.shift().success({address:'有效地址',name:'',latitude:91,longitude:114})
  await assert.rejects(request, /位置无效/)
})

test('activity sharing enables friend and timeline menus without exchanging identity', () => {
  const h = harness()
  h.wechat().showActivityShareMenu()
  assert.deepEqual(h.shares, [{ menus: ['shareAppMessage', 'shareTimeline'] }])
  assert.equal(h.logins.length, 0); assert.equal(h.queue.length, 0)
})

test('timeline first invitation survives later entry and silent identification records no consent', async () => {
  const h = harness(), inviteCode = 'HJYQM20261005000001'
  const entry = { query: { id: 'activity-a', inviteCode }, scene: 1154 }
  const app = h.app(entry)
  app.onLaunch(entry); await setImmediate()
  assert.equal(h.store.pendingInvite, inviteCode)
  assert.equal(h.logins.length, 1); assert.equal(h.queue.length, 0)
  entry.query = {}; app.onShow(); await setImmediate()
  assert.equal(h.store.pendingInvite, inviteCode)
  const login = h.wechat().bootstrapIdentity()
  h.logins.shift().success({ code: 'explicit-code' }); await setImmediate()
  assert.equal(h.queue[0].data.inviteCode, inviteCode)
  assert.equal(h.queue[0].url.endsWith('/auth/wechat/identify'), true)
  assert.equal(h.queue[0].data.termsVersion, undefined)
  h.respond(200, { token: 'new-session', expiresAt: '2099-01-01', member: sampleMember })
  await login
  assert.equal(h.store.pendingInvite, '')
})

test('public requests do not wait for identity and remain available before identification', async () => {
  const h = harness()
  const result = h.api.api.activities()
  assert.equal(h.store.token, '')
  assert.equal(h.queue[0].header.Authorization, undefined)
  h.respond(200, { items: [] })
  assert.deepEqual(await result, { items: [] })
})

test('local test silent identification uses a stable mock credential without wx.login', async () => {
  for (let attempt = 0; attempt < 2; attempt++) {
    const h = harness(new Map(), true)
    const login = h.wechat().bootstrapIdentity()
    await setImmediate()
    assert.equal(h.logins.length, 0)
    assert.equal(h.queue[0].data.code, 'huiju-local-test')
    h.respond(200, { token: 'test-token', expiresAt: '2099-01-01', member: sampleMember })
    await login
    assert.equal(h.store.member.id, sampleMember.id)
  }
})

test('local test actors persist only under their API environment and switch with a fresh session', async () => {
  const h = harness(new Map(), true), wechat = h.wechat()
  for (const actor of wechat.localTestActors) {
    h.accept('previous-token')
    h.store.pendingInvite = 'PREVIOUS'
    const previousEpoch = h.store.epoch
    const switching = wechat.switchLocalTestActor(actor.key)
    assert.equal(h.store.token, '')
    assert.equal(h.store.pendingInvite, '')
    assert.equal(h.store.epoch, previousEpoch + 1)
    await setImmediate()
    const code = actor.key === 'owner' ? 'huiju-local-test' : `huiju-local-test:${actor.key}`
    assert.equal(h.queue[0].data.code, code)
    assert.equal(h.queue[0].header.Authorization, undefined)
    h.respond(200, { token: actor.key, expiresAt: '2099-01-01', member: { ...sampleMember, id: actor.key } })
    await switching
    assert.equal(h.store.member.id, actor.key)
    assert.equal(wechat.localTestCode(), code)
    assert.equal(h.storage.get(`huiju:local-test-actor:${base}`), actor.key)
  }
  const restored = harness(h.storage, true)
  assert.equal(restored.wechat().getLocalTestActor().key, 'visitor')
  assert.equal(h.logins.length, 0)
})

test('actor switching locks duplicates and late old identification cannot restore a previous actor', async () => {
  const h = harness(new Map(), true), wechat = h.wechat()
  const old = wechat.bootstrapIdentity()
  const oldRejected = assert.rejects(old, error => error.code === 'STALE_REQUEST')
  await setImmediate()
  const switching = wechat.switchLocalTestActor('planner')
  assert.equal(wechat.switchLocalTestActor('peer'), switching)
  await setImmediate()
  assert.equal(h.queue.length, 2)
  h.respond(200, { token: 'old', expiresAt: '2099-01-01', member: sampleMember })
  await oldRejected
  assert.equal(h.store.token, '')
  assert.equal(h.queue[0].data.code, 'huiju-local-test:planner')
  h.respond(200, { token: 'planner', expiresAt: '2099-01-01', member: { ...sampleMember, id: 'planner' } })
  await switching
  assert.equal(h.store.member.id, 'planner')
  assert.equal(wechat.getLocalTestActor().key, 'planner')
})

test('failed actor switch remains signed out and retry identifies the selected actor', async () => {
  const h = harness(new Map(), true), wechat = h.wechat()
  h.accept('owner')
  const failed = wechat.switchLocalTestActor('visitor')
  const rejected = assert.rejects(failed)
  await setImmediate()
  h.respond(503, { code: 'UNAVAILABLE', message: '稍后重试' })
  await rejected
  assert.equal(h.store.token, '')
  const retry = wechat.bootstrapIdentity()
  await setImmediate()
  assert.equal(h.queue[0].data.code, 'huiju-local-test:visitor')
  h.respond(200, { token: 'visitor', expiresAt: '2099-01-01', member: sampleMember })
  await retry
})

test('ordinary mode refuses local actor selection and ignores stored test actor', async () => {
  const h = harness(new Map([[`huiju:local-test-actor:${base}`, 'peer']]))
  const wechat = h.wechat()
  assert.throws(() => wechat.localTestCode(), /仅本地/)
  await assert.rejects(wechat.switchLocalTestActor('peer'), /仅本地/)
  assert.equal(h.queue.length, 0)
  const login = wechat.bootstrapIdentity()
  h.logins.shift().success({ code: 'real-wx-code' })
  await setImmediate()
  assert.equal(h.queue[0].data.code, 'real-wx-code')
  h.respond(200, { token: 'real', expiresAt: '2099-01-01', member: sampleMember })
  await login
})

test('environment switch removes previous environment token and keeps identity empty', () => {
  const storage = new Map([['huiju:environment', 'https://old.invalid/api/v1'], ['huiju:session:https://old.invalid/api/v1', { token: 'old' }]])
  const h = harness(storage)
  assert.equal(h.store.token, '')
  assert.equal(storage.has('huiju:session:https://old.invalid/api/v1'), false)
})

test('expired cache cannot authorize a private request', async () => {
  const h = harness(new Map([[`huiju:session:${base}`, { token: 'expired', expiresAt: '2000-01-01' }]]))
  await assert.rejects(h.api.api.registrations(), error => error.code === 'SESSION_REQUIRED')
  assert.equal(h.queue.length, 0)
})

test('late private response after logout cannot restore member state', async () => {
  const h = harness(); h.accept('first')
  const result = h.api.refreshMember()
  h.store.clear()
  h.respond(200, sampleMember)
  await assert.rejects(result, error => error.code === 'STALE_REQUEST')
  assert.equal(h.store.member, null)
  assert.equal(h.store.token, '')
})

test('account switch discards earlier identity response', async () => {
  const h = harness(); h.accept('first')
  const result = h.api.refreshMember()
  h.accept('second')
  h.respond(200, { ...sampleMember, displayName: 'Old account' })
  await assert.rejects(result, error => error.code === 'STALE_REQUEST')
  assert.equal(h.store.token, 'second')
  assert.equal(h.store.member.displayName, 'Member')
})

test('concurrent session refresh shares one request', async () => {
  const h = harness(); h.accept('first')
  const first = h.api.refreshMember(), second = h.api.refreshMember()
  assert.equal(h.queue.length, 1)
  h.respond(200, sampleMember)
  assert.deepEqual(await first, await second)
})

test('expired optional identity falls back to anonymous public browsing', async () => {
  const h = harness(); h.accept('first')
  const result = h.api.api.activities()
  h.respond(401, { code: 'SESSION_REQUIRED', message: 'Expired' })
  assert.equal(h.store.token, '')
  assert.equal(h.queue[0].header.Authorization, undefined)
  h.respond(200, { items: [] })
  assert.deepEqual(await result, { items: [] })
})

test('private expiration reports authentication failure without retrying a write', async () => {
  const h = harness(); h.accept('first')
  const result = h.api.api.profile('New name')
  assert.equal(h.queue[0].method, 'POST')
  h.respond(401, { code: 'SESSION_REQUIRED', message: 'Expired' })
  await assert.rejects(result, error => error.status === 401)
  assert.equal(h.queue.length, 0)
  assert.equal(h.store.member, null)
})

test('public GET discards old identity data and rereads anonymously during silent recovery', async () => {
  const h = harness(); h.accept('expired')
  const result = h.api.api.activity('public-activity')
  h.store.clear(); h.accept('recovered')
  h.respond(200, { id: 'public-activity', consultationContact: 'old identity only' })
  assert.equal(h.queue.length, 1)
  assert.equal(h.queue[0].header.Authorization, undefined)
  h.respond(200, { id: 'public-activity', consultationContact: null })
  assert.deepEqual(await result, { id: 'public-activity', consultationContact: null })
  assert.equal(h.store.token, 'recovered')
})

test('anonymous legal read remains valid when silent identity completes meanwhile', async () => {
  const h = harness(); const result = h.api.api.legalDocuments()
  h.accept('new-session')
  h.respond(200, { development: true })
  assert.deepEqual(await result, { development: true })
})

test('network failure remains a failure and does not fabricate a result', async () => {
  const h = harness(); const result = h.api.api.activities()
  h.queue.shift().fail({ errMsg: 'timeout' })
  await assert.rejects(result, error => error.code === 'NETWORK_ERROR')
  assert.equal(h.networkWarnings.length, 0)
})

test('development transport diagnostics redact URLs and exclude request credentials without retrying', async () => {
  const h = harness(new Map(), false, true); h.accept('private-session-token')
  const result = h.api.api.activities()
  h.queue.shift().fail({ errMsg: 'request:fail ssl hand shake error https://test.invalid/path?code=private-code', header: { Authorization: 'private-session-token' } })
  await assert.rejects(result, error => error.code === 'NETWORK_ERROR')
  assert.deepEqual(h.networkWarnings, [['[API_NETWORK_FAILURE]', {
    apiBase: base, method: 'GET', message: 'request:fail ssl hand shake error [URL]',
  }]])
  assert.equal(h.queue.length, 0)
})

test('new account does not reuse the previous account pending refresh', async () => {
  const h = harness(); h.accept('first')
  const oldResult = h.api.refreshMember()
  h.store.clear(); h.accept('second')
  const newResult = h.api.refreshMember()
  assert.equal(h.queue.length, 2)
  h.respond(200, { ...sampleMember, displayName: 'Old member' })
  await assert.rejects(oldResult, error => error.code === 'STALE_REQUEST')
  h.respond(200, { ...sampleMember, displayName: 'New member' })
  await newResult
  assert.equal(h.store.member.displayName, 'New member')
})

test('silent identity does not require or fabricate agreement consent', async () => {
  const h = harness(); h.store.captureInvite('FIRST')
  await assert.rejects(h.wechat().loginWithWechat(), error => error.code === 'LEGAL_CONSENT_REQUIRED')
  const result = h.wechat().bootstrapIdentity()
  h.logins.shift().success({ code: 'silent' }); await setImmediate()
  assert.deepEqual(h.queue[0].data, { code: 'silent', inviteCode: 'FIRST' })
  h.respond(200, { token: 'visitor', expiresAt: '2099-01-01', member: sampleMember }); await result
  assert.equal(h.queue.length, 0); assert.equal(h.store.member.profileComplete, false)
})

test('duplicate silent identities merge one exchange with captured first invitation', async () => {
  const h = harness(); h.store.pendingInvite = 'FIRST'
  const first = h.wechat().bootstrapIdentity()
  h.store.pendingInvite = 'LATER'
  const second = h.wechat().bootstrapIdentity()
  assert.equal(h.logins.length, 1)
  h.logins.shift().success({ code: 'test-code' }); await setImmediate()
  assert.equal(h.queue.length, 1)
  assert.deepEqual(h.queue[0].data, { code: 'test-code', inviteCode: 'FIRST' })
  h.respond(200, { token: 'session', expiresAt: new Date(Date.now() + 3600000).toISOString(), member: sampleMember })
  await Promise.all([first, second]); assert.equal(h.store.token, 'session'); assert.equal(h.store.identifying, false)
})

test('valid stored identity refreshes without a new WeChat exchange', async () => {
  const h = harness(); h.accept('current')
  const result = h.wechat().bootstrapIdentity()
  h.respond(200, sampleMember)
  await result
  assert.equal(h.logins.length, 0)
})

test('expired server session silently reidentifies the existing account', async () => {
  const h = harness(); h.accept('expired')
  const result = h.wechat().bootstrapIdentity()
  h.respond(401, { code: 'SESSION_REQUIRED', message: 'Expired' }); await setImmediate()
  assert.equal(h.logins.length, 1)
  h.logins.shift().success({ code: 'renewed' }); await setImmediate()
  h.respond(200, { token: 'renewed-token', expiresAt: '2099-01-01', member: { ...sampleMember, profileComplete: true } })
  await result; assert.equal(h.store.token, 'renewed-token'); assert.equal(h.store.member.profileComplete, true)
})

test('logout during WeChat code exchange cannot restore identity or submit a login', async () => {
  const h = harness(); const result = h.wechat().bootstrapIdentity()
  h.store.clear()
  h.logins.shift().success({ code: 'late-code' })
  await assert.rejects(result, error => error.code === 'STALE_REQUEST')
  assert.equal(h.queue.length, 0)
  assert.equal(h.store.token, '')
})

test('anonymous public response remains usable when silent login finishes meanwhile', async () => {
  const h = harness(); const publicResult = h.api.api.activities()
  h.accept('new-session')
  h.respond(200, { items: [] })
  assert.deepEqual(await publicResult, { items: [] })
  assert.equal(h.store.token, 'new-session')
})

test('natural first entry and failed identification keep their first source through retry', async () => {
  const h = harness(); h.store.captureInvite(); h.store.captureInvite('LATER')
  assert.equal(h.store.pendingInvite, '')
  const first = h.wechat().bootstrapIdentity(); h.logins.shift().fail()
  await assert.rejects(first, /重试/)
  h.store.captureInvite('LATER')
  const retry = h.wechat().bootstrapIdentity(); h.logins.shift().success({ code: 'retry' }); await setImmediate()
  assert.deepEqual(h.queue[0].data, { code: 'retry' })
  h.respond(200, { token: 'visitor', expiresAt: '2099-01-01', member: sampleMember }); await retry
})
