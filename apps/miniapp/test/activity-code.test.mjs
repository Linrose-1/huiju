import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { URL } from 'node:url'
import ts from 'typescript'
const require = createRequire(import.meta.url)
function execute(source, dependencies = {}, uni = {}) {
  const exports = {}
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText
  new Function('require', 'exports', 'uni', code)(name => dependencies[name] || require(name), exports, uni)
  return exports
}
const { activityCodeTarget } = execute(readFileSync(new URL('../src/services/activity-code.ts', import.meta.url), 'utf8'))
const id = 'd13244f9-da4a-43e1-8995-b394ec30c38d'
test('scanned activity paths and application codes retain validated invite only', () => {
  for (const value of [`pages/activity/detail?id=${id}`, `/pages/activity/detail?id=${id}`, `huiju://activity/${id}`]) assert.deepEqual(activityCodeTarget(value), { id })
  assert.deepEqual(activityCodeTarget(`huiju://activity/${id}?inviteCode=ABC_123`), { id, inviteCode: 'ABC_123' })
  assert.deepEqual(activityCodeTarget(`/pages/activity/detail?inviteCode=ABC&id=${id}`), { id, inviteCode: 'ABC' })
})
test('rejects foreign links, arbitrary routes, malformed encoding and conflicting identifiers', () => {
  for (const value of ['', id, 'https://foreign.example/pages/activity/detail?id='+id, 'javascript:alert(1)', '/pages/login/index?id='+id,
    '/pages/activity/detail?id=bad', `/pages/activity/detail?id=${id}&id=${id}`, `/pages/activity/detail?id=${id}&inviteCode=%`,
    `/pages/activity/detail?id=${id}&returnTo=other`, `/pages/activity/detail?id=${id}#bad`, `/pages/activity/detail?id=${id}&inviteCode=%26id%3Devil`,
    `huiju://activity/${id}?id=${id}`]) assert.equal(activityCodeTarget(value), null, value)
})
function harness(scanner) {
  const session = { epoch: 1, token: 'a' }, navigations = [], modals = []
  let unload
  const source = readFileSync(new URL('../src/pages/activity/index.vue', import.meta.url), 'utf8').match(/<script setup lang="ts">([\s\S]*?)<\/script>/)[1]
  const page = execute(source + '\nexport { scanActivity, scanning };', {
    '@dcloudio/uni-app': { onShow() {}, onHide() {}, onPullDownRefresh() {}, onReachBottom() {}, onLoad() {}, onUnload: f => { unload = f } },
    '@/services/api': { api: {}, errorMessage: e => e.message },
    '@/services/api/environment': {}, '@/services/presentation': {},
    '@/services/navigation': { routes: { detail: '/pages/activity/detail' }, navigate: url => navigations.push(url) },
    '@/stores/session': { useSessionStore: () => session }, '@/services/wechat': { scanActivityCode: scanner },
    '@/services/activity-code': { activityCodeTarget },
  }, { showModal: o => modals.push(o) })
  return { page, session, navigations, modals, unload: () => unload() }
}
test('scan routes only valid destinations; cancel is quiet and failures allow retry', async () => {
  let result = null
  const h = harness(async () => { if (result instanceof Error) throw result; return result })
  await h.page.scanActivity(); assert.equal(h.modals.length, 0)
  result = { result: 'foreign' }; await h.page.scanActivity(); assert.equal(h.navigations.length, 0); assert.equal(h.modals.length, 1)
  result = new Error('camera denied'); await h.page.scanActivity(); assert.equal(h.modals[1].content, 'camera denied')
  result = { path: `pages/activity/detail?id=${id}&inviteCode=ABC`, result: 'opaque' }; await h.page.scanActivity()
  assert.deepEqual(h.navigations, [`/pages/activity/detail?id=${id}&inviteCode=ABC`]); assert.equal(h.page.scanning.value, false)
})
test('duplicate taps, account changes and page disposal cannot navigate late', async () => {
  for (const mode of ['account', 'unload', 'normal']) {
    let complete, calls = 0
    const h = harness(() => { calls++; return new Promise(resolve => { complete = resolve }) })
    const pending = h.page.scanActivity(); await h.page.scanActivity(); assert.equal(calls, 1)
    if (mode === 'account') h.session.epoch++
    if (mode === 'unload') h.unload()
    complete({ result: `huiju://activity/${id}` }); await pending
    assert.equal(h.navigations.length, mode === 'normal' ? 1 : 0)
    assert.equal(h.page.scanning.value, false)
  }
})
