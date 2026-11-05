import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readFileSync } from 'node:fs'
import { URL } from 'node:url'
import ts from 'typescript'

const sceneA = 'p1234567890abcdef12345678', sceneB = 'pabcdef1234567890abcdef12'
const resultA = { activityId: 'activity-a', inviteCode: 'INVITE_A' }
const resultB = { activityId: 'activity-b', inviteCode: 'INVITE_B' }
const entry = scene => ({ path: 'pages/activity/detail', query: { scene } })
function execute(source, dependencies, uni = {}) {
  const exports = {}
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
  new Function('require', 'exports', 'uni', code)(name => {
    assert.ok(name in dependencies, `unexpected dependency ${name}`)
    return dependencies[name]
  }, exports, uni)
  return exports
}
function harness() {
  const requests = [], captures = [], events = []
  const session = { captureInvite: value => { captures.push(value); events.push('capture:' + value) } }
  const dependencies = {
    '@/services/api': { api: { resolveActivityPoster: scene => new Promise((resolve, reject) => { requests.push({ scene, resolve, reject }); events.push('request:' + scene) }) } },
    '@/stores/session': { useSessionStore: () => session },
  }
  const source = readFileSync(new URL('../src/services/wechat/poster-entry.ts', import.meta.url), 'utf8')
  const module = execute(source, dependencies)
  return { ...module, requests, captures, events, session }
}

test('poster entry waits for resolution and captures invitation before identity may continue', async () => {
  const h = harness()
  h.preparePosterEntry(entry(sceneA))
  let completed = false
  const waiting = h.awaitPosterEntry().then(() => { completed = true; h.events.push('identity-ready') })
  await Promise.resolve()
  assert.equal(completed, false)
  assert.deepEqual(h.captures, [])
  assert.equal(h.requests.length, 1)
  h.requests[0].resolve(resultA)
  await waiting
  assert.deepEqual(h.events, ['request:' + sceneA, 'capture:INVITE_A', 'identity-ready'])
})

test('App launch and show prepare entry before identity bootstrap, sharing one resolution', async () => {
  const h = harness(), hooks = {}, boots = []
  const source = readFileSync(new URL('../src/App.vue', import.meta.url), 'utf8').match(/<script setup lang="ts">([\s\S]*?)<\/script>/)[1]
  execute(source, {
    '@dcloudio/uni-app': { onLaunch: fn => { hooks.launch = fn }, onShow: fn => { hooks.show = fn } },
    '@/stores/session': { useSessionStore: () => h.session },
    '@/services/wechat': { bootstrapIdentity: () => {
      const promise = h.awaitPosterEntry().then(() => { h.events.push('identify') })
      boots.push(promise); return promise
    } },
    '@/services/wechat/poster-entry': h,
    '@/services/api/environment': { LOCAL_TEST: false },
  }, { getEnterOptionsSync: () => entry(sceneA) })
  hooks.launch(entry(sceneA)); hooks.show()
  assert.equal(h.requests.length, 1)
  assert.ok(!h.events.includes('identify'))
  h.requests[0].resolve(resultA)
  await Promise.all(boots)
  assert.equal(h.events[1], 'capture:INVITE_A')
  assert.deepEqual(h.events.slice(2), ['identify', 'identify'])
})

test('same scene calls, including a once-encoded input, reuse the pending and resolved result', async () => {
  const h = harness(), encoded = '%70' + sceneA.slice(1)
  h.preparePosterEntry(entry(encoded))
  const first = h.awaitPosterEntry()
  h.preparePosterEntry(entry(encoded))
  const second = h.resolvePosterEntry(sceneA)
  assert.equal(h.requests.length, 1)
  h.requests[0].resolve(resultA)
  await first
  assert.deepEqual(await second, resultA)
  assert.deepEqual(await h.resolvePosterEntry(sceneA), resultA)
  assert.equal(h.requests.length, 1)
})

test('failure does not capture an invite and an explicit retry starts a fresh request', async () => {
  const h = harness()
  h.preparePosterEntry(entry(sceneA))
  const first = h.awaitPosterEntry(), rejected = assert.rejects(first, /offline/)
  h.requests[0].reject(new Error('offline'))
  await rejected
  assert.deepEqual(h.captures, [])
  const retry = h.awaitPosterEntry()
  assert.equal(h.requests.length, 2)
  h.requests[1].resolve(resultA)
  await retry
  assert.deepEqual(h.captures, ['INVITE_A'])
})

test('late result from a replaced scene cannot capture or replace the current invitation', async () => {
  const h = harness()
  h.preparePosterEntry(entry(sceneA))
  const old = h.awaitPosterEntry(), rejected = assert.rejects(old, /入口已变更|重新打开/)
  h.preparePosterEntry(entry(sceneB))
  const current = h.awaitPosterEntry()
  h.requests[1].resolve(resultB); await current
  h.requests[0].resolve(resultA); await rejected
  assert.deepEqual(h.captures, ['INVITE_B'])
  assert.deepEqual(await h.resolvePosterEntry(sceneB), resultB)
  assert.equal(h.requests.length, 2)
})

test('changing A to B and back to A invalidates the original A request too', async () => {
  const h = harness()
  h.preparePosterEntry(entry(sceneA))
  const old = h.awaitPosterEntry(), rejected = assert.rejects(old, /入口已变更|重新打开/)
  h.preparePosterEntry(entry(sceneB)); h.preparePosterEntry(entry(sceneA))
  const current = h.awaitPosterEntry()
  h.requests[1].resolve(resultA); await current
  h.requests[0].resolve({ activityId: 'stale-a', inviteCode: 'OLD_A' }); await rejected
  assert.deepEqual(h.captures, ['INVITE_A'])
  assert.deepEqual(await h.resolvePosterEntry(sceneA), resultA)
})

test('malformed, nonstring, oversized and double-encoded scenes never make an API request', async () => {
  const h = harness()
  for (const input of [undefined, null, {}, [sceneA], 1, '', '%', '%2570' + sceneA.slice(1), sceneA + '&inviteCode=OTHER',
    sceneA + '#fragment', 'https://other.example/' + sceneA, 'p' + 'a'.repeat(25), 'p' + 'A'.repeat(24), 'a'.repeat(10000)]) {
    assert.equal(h.posterScene(input), '', String(input))
    await assert.rejects(h.resolvePosterEntry(input), /海报链接无效/)
  }
  assert.equal(h.requests.length, 0)
  assert.deepEqual(h.captures, [])
})

test('malformed scene from App entry blocks first identity instead of accepting coerced parameters', async () => {
  for (const raw of [[sceneA], {}, '%2570' + sceneA.slice(1), sceneA + '&inviteCode=OTHER']) {
    const h = harness()
    h.preparePosterEntry(entry(raw))
    const waiting = h.awaitPosterEntry()
    const rejected = assert.rejects(waiting, /海报链接无效/)
    // Resolve a wrongly issued request so a regression fails without leaving this test hanging.
    for (const request of h.requests) request.resolve(resultA)
    await rejected
    assert.equal(h.requests.length, 0)
    assert.deepEqual(h.captures, [])
  }
})

test('ordinary entries do not fetch poster resolution and supersede pending poster entry', async () => {
  const h = harness()
  for (const options of [undefined, {}, { path: 'pages/activity/index' }, { path: 'pages/activity/detail', query: { id: 'activity', inviteCode: 'DIRECT' } },
    { path: 'pages/member/profile', query: { scene: sceneA } }]) {
    h.preparePosterEntry(options); await h.awaitPosterEntry()
  }
  assert.equal(h.requests.length, 0)
  h.preparePosterEntry(entry(sceneA))
  const old = h.awaitPosterEntry(), rejected = assert.rejects(old, /入口已变更|重新打开/)
  h.preparePosterEntry({ path: 'pages/activity/index' }); await h.awaitPosterEntry()
  h.requests[0].resolve(resultA); await rejected
  assert.deepEqual(h.captures, [])
})

test('leaving invalid or failed poster entry releases the identity gate without another resolution request', async () => {
  const invalid = harness(), raw = '%2570' + sceneA.slice(1)
  invalid.preparePosterEntry(entry(raw))
  await assert.rejects(invalid.awaitPosterEntry(), /海报链接无效/)
  invalid.releasePosterEntry(raw)
  await invalid.awaitPosterEntry()
  assert.equal(invalid.requests.length, 0)
  const failed = harness()
  failed.preparePosterEntry(entry(sceneA))
  const waiting = failed.awaitPosterEntry(), rejection = assert.rejects(waiting, /活动已下架/)
  failed.requests[0].reject(new Error('活动已下架')); await rejection
  failed.releasePosterEntry(sceneA)
  await failed.awaitPosterEntry()
  assert.equal(failed.requests.length, 1)
  assert.deepEqual(failed.captures, [])
})

test('released pending entry ignores late invitation while an unrelated release preserves the active scene', async () => {
  const h = harness()
  h.preparePosterEntry(entry(sceneA))
  const pending = h.awaitPosterEntry(), rejection = assert.rejects(pending, /入口已变更|重新打开/)
  h.releasePosterEntry(sceneA)
  await h.awaitPosterEntry()
  h.requests[0].resolve(resultA); await rejection
  assert.deepEqual(h.captures, [])
  h.preparePosterEntry(entry(sceneB))
  const current = h.awaitPosterEntry()
  h.releasePosterEntry(sceneA); h.releasePosterEntry(undefined)
  h.requests[1].resolve(resultB); await current
  assert.deepEqual(h.captures, ['INVITE_B'])
})
