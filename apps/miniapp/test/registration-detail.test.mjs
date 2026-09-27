import { setImmediate } from 'node:timers'
import { URL } from 'node:url'
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import ts from 'typescript'
const require = createRequire(import.meta.url)
const { reactive, effectScope } = require('vue')
const activity = { organizer: { memberId: 'organizer-id' }, feeType: 'free', consultationContact: 'private contact' }
const registration = { status: 'active', contactPhone: 'private phone', answers: [{ questionId: 'q1', value: ['one', 'two'] }] }
function harness(t) {
  const session = reactive({ token: 'a', epoch: 0, member: { displayName: 'member a' } })
  const requests = [], modals = [], cancelled = [], navigated = []
  let hide, unload
  const deps = {
    '@dcloudio/uni-app': { onLoad(fn) { fn({ id: 'activity-id' }) }, onShow() {}, onHide(fn) { hide = fn }, onUnload(fn) { unload = fn } },
    '@/services/api': { api: {
      activity: () => Promise.resolve(activity),
      myRegistration: () => new Promise((resolve, reject) => requests.push({ resolve, reject })),
      cancel: id => { cancelled.push(id); return Promise.resolve() }
    }, ApiError: class extends Error {}, errorMessage: e => e.message },
    '@/services/api/environment': { mediaUrl: value => value },
    '@/services/presentation': { canEdit: () => true, canCancel: () => true },
    '@/services/navigation': { routes: { memberCard: '/pages/member/card' }, navigate: value => navigated.push(value), loginPage() {} },
    '@/stores/session': { useSessionStore: () => session },
    '@/components/base/RequestState.vue': {}
  }
  const source = readFileSync(new URL('../src/pages/registration/detail.vue', import.meta.url), 'utf8').match(/<script setup lang="ts">([\s\S]*?)<\/script>/)[1]
  const code = ts.transpileModule(source + '\nexport {load,cancel,organizer,answer,activity,registration,error,busy};', { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
  const page = {}, scope = effectScope()
  scope.run(() => new Function('require', 'exports', 'uni', code)(name => deps[name] || require(name), page, { showModal: () => new Promise(resolve => modals.push(resolve)) }))
  t.after(() => scope.stop())
  const loaded = async () => { const pending = page.load(); requests.at(-1).resolve(registration); await pending }
  return { session, page, requests, modals, cancelled, navigated, loaded, hide: () => hide(), unload: () => unload() }
}
test('late private response cannot restore old account data; identity change clears immediately', async t => {
  const h = harness(t); await h.loaded()
  assert.equal(h.page.registration.value.contactPhone, 'private phone')
  const pending = h.page.load()
  h.session.token = 'b'
  assert.equal(h.page.registration.value, null)
  h.requests.at(-1).resolve(registration); await pending
  assert.equal(h.page.activity.value, null)
  assert.equal(h.page.registration.value, null)
})
test('cancel modal confirmation is invalid after a session change or page hiding', async t => {
  const h = harness(t); await h.loaded()
  const first = h.page.cancel(); await h.page.cancel()
  assert.equal(h.modals.length, 1)
  h.session.epoch++; h.modals[0]({ confirm: true }); await first
  assert.deepEqual(h.cancelled, [])
  await h.loaded(); const second = h.page.cancel(); h.hide(); h.modals[1]({ confirm: true }); await second
  assert.deepEqual(h.cancelled, [])
})
test('cancel requires explicit confirmation and reloads the actual registration after success', async t => {
  const h = harness(t); await h.loaded()
  const declined = h.page.cancel(); h.modals[0]({ confirm: false }); await declined
  assert.deepEqual(h.cancelled, [])
  const accepted = h.page.cancel(); h.modals[1]({ confirm: true }); await new Promise(resolve => setImmediate(resolve))
  assert.deepEqual(h.cancelled, ['activity-id'])
  h.requests.at(-1).resolve({ ...registration, status: 'cancelled' }); await accepted
  assert.equal(h.page.registration.value.status, 'cancelled')
  assert.equal(h.page.busy.value, false)
})
test('unload rejects late private errors and answers remain dynamic', async t => {
  const h = harness(t); await h.loaded()
  assert.equal(h.page.answer('q1'), 'one、two'); assert.equal(h.page.answer('missing'), '未填写')
  h.page.organizer(); assert.deepEqual(h.navigated, ['/pages/member/card?id=organizer-id'])
  const pending = h.page.load(); h.unload(); h.requests.at(-1).reject(new Error('old failure')); await pending
  assert.equal(h.page.error.value, '')
  assert.equal(h.page.registration.value, null)
})
