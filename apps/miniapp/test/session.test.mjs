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
function harness(initialStorage = new Map()) {
  setActivePinia(createPinia())
  const queue = []
  const logins = []
  const storage = initialStorage
  const uni = {
    getStorageSync: key => storage.get(key),
    setStorageSync: (key, value) => storage.set(key, value),
    removeStorageSync: key => storage.delete(key),
    request: options => queue.push(options),
    login: options => logins.push(options),
  }
  const cache = new Map()
  function load(path) {
    if (path === '@/services/api/environment' || path === './environment') return { API_BASE_URL: base }
    let file = resolve(root, path.replace(/^@\//, '') + (path.endsWith('.ts') ? '' : '.ts'))
    if (!existsSync(file)) file = file.slice(0, -3) + '/index.ts'
    if (cache.has(file)) return cache.get(file).exports
    const module = { exports: {} }
    cache.set(file, module)
    const source = readFileSync(file, 'utf8').replace(/\/\/ #ifndef MP-WEIXIN[\s\S]*?\/\/ #endif/g, '')
    const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
    const localRequire = target => target.startsWith('@/') || target === './environment' ? load(target) : require(target)
    new Function('require', 'module', 'exports', 'uni', code)(localRequire, module, module.exports, uni)
    return module.exports
  }
  const store = load('@/stores/session').useSessionStore()
  const api = load('@/services/api/index')
  const accept = token => store.accept({ token, expiresAt: new Date(Date.now() + 3600000).toISOString(), member: sampleMember })
  const respond = (statusCode, data) => { const request = queue.shift(); assert.ok(request, 'expected queued request'); request.success({ statusCode, data }); return request }
  return { store, api, queue, logins, storage, accept, respond, wechat: () => load('@/services/wechat/index') }
}

test('cold start does not create an identity or block public activity requests', async () => {
  const h = harness()
  const result = h.api.api.activities()
  assert.equal(h.store.token, '')
  assert.equal(h.queue[0].header.Authorization, undefined)
  h.respond(200, { items: [] })
  assert.deepEqual(await result, { items: [] })
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

test('network failure remains a failure and does not fabricate a result', async () => {
  const h = harness(); const result = h.api.api.activities()
  h.queue.shift().fail({ errMsg: 'timeout' })
  await assert.rejects(result, error => error.code === 'NETWORK_ERROR')
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

test('silent and manual login merge one exchange and preserve captured invitation', async () => {
  const h = harness(); h.store.pendingInvite = 'FIRST'
  const wechat = h.wechat()
  const silent = wechat.bootstrapIdentity()
  h.store.pendingInvite = 'LATER'
  const manual = wechat.loginWithWechat()
  assert.equal(h.logins.length, 1)
  h.logins.shift().success({ code: 'test-code' })
  await setImmediate()
  assert.equal(h.queue.length, 1)
  assert.equal(h.queue[0].data.inviteCode, 'FIRST')
  h.respond(200, { token: 'session', expiresAt: new Date(Date.now() + 3600000).toISOString(), member: sampleMember })
  await Promise.all([silent, manual])
  assert.equal(h.store.token, 'session')
  assert.equal(h.store.identifying, false)
})

test('silent login failure leaves public browsing available', async () => {
  const h = harness(); const silent = h.wechat().bootstrapIdentity()
  h.logins.shift().fail({ errMsg: 'unavailable' })
  await assert.rejects(silent)
  assert.equal(h.store.token, '')
  const publicResult = h.api.api.activities()
  h.respond(200, { items: [] })
  assert.deepEqual(await publicResult, { items: [] })
})

test('valid stored identity refreshes without a new WeChat exchange', async () => {
  const h = harness(); h.accept('current')
  const result = h.wechat().bootstrapIdentity()
  h.respond(200, sampleMember)
  await result
  assert.equal(h.logins.length, 0)
})

test('expired server session is silently rebuilt without replaying business actions', async () => {
  const h = harness(); h.accept('expired')
  const result = h.wechat().bootstrapIdentity()
  h.respond(401, { code: 'SESSION_REQUIRED', message: 'Expired' })
  await setImmediate()
  assert.equal(h.logins.length, 1)
  h.logins.shift().success({ code: 'new-code' })
  await setImmediate()
  assert.equal(h.queue[0].url, base + '/auth/wechat/session')
  h.respond(200, { token: 'new', expiresAt: new Date(Date.now() + 3600000).toISOString(), member: sampleMember })
  await result
  assert.equal(h.store.token, 'new')
  assert.equal(h.queue.length, 0)
})

test('logout during WeChat code exchange cannot restore identity or submit a login', async () => {
  const h = harness(); const result = h.wechat().loginWithWechat()
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
