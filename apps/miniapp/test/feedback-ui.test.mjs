import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { URL } from 'node:url'
import { setImmediate } from 'node:timers/promises'
import ts from 'typescript'
const require = createRequire(import.meta.url)
const { reactive, effectScope } = require('vue')
function harness(t) {
  const session = reactive({ token: 'a', epoch: 0, member: { id: 'member-a', profileComplete: true } }), requests = [], mutations = [], modals = []
  let hide, unload
  const pending = kind => new Promise((resolve, reject) => requests.push({ kind, resolve, reject }))
  const api = Object.fromEntries(['activity', 'feedbackContext', 'feedbackComments', 'feedbackReviews', 'reviewStats'].map(name => [name, () => pending(name)]))
  for (const name of ['createComment', 'editComment', 'deleteComment', 'createReview', 'editReview', 'deleteReview']) api[name] = (...args) => { mutations.push([name, ...args]); return pending(name) }
  const deps = {
    '@dcloudio/uni-app': { onLoad(fn) { fn({ id: 'activity-a' }) }, onShow() {}, onHide(fn) { hide = fn }, onUnload(fn) { unload = fn } },
    '@/services/api': { api, errorMessage: e => e.message }, '@/services/api/environment': {}, '@/services/presentation': {},
    '@/services/navigation': { routes: { feedback: '/feedback' }, loginPage() {} }, '@/stores/session': { useSessionStore: () => session }, '@/components/base/RequestState.vue': {}
  }
  const source = readFileSync(new URL('../src/pages/activity/feedback.vue', import.meta.url), 'utf8').match(/<script setup lang="ts">([\s\S]*?)<\/script>/)[1]
  const code = ts.transpileModule(source+'\nexport {load,items,activity,context,loading,editor,content,openEditor,submit,remove,busy,actionError,more,hasMore,loadStats,stats,statsError,statsLoading};', { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
  const page = {}, scope = effectScope()
  scope.run(() => new Function('require', 'exports', 'uni', code)(name => deps[name] || require(name), page, { showModal: () => new Promise(resolve => modals.push(resolve)) }))
  t.after(() => scope.stop())
  const latest = name => requests.filter(item => item.kind === name).at(-1)
  const item = { id: 'comment-a', member: { memberId: 'member-a' }, content: 'hello' }
  function resolveLoad() { latest('activity').resolve({ title: 'activity' }); latest('feedbackContext').resolve({ canComment: true, canReview: true, myReview: null, isOrganizer: false }); latest('feedbackComments').resolve({ items: [item], total: 1, hasMore: false }); latest('feedbackReviews').resolve({ items: [], total: 0, hasMore: false }) }
  async function loaded() { const work = page.load(); resolveLoad(); await work }
  return { page, session, latest, loaded, resolveLoad, item, mutations, modals, hide: () => hide(), unload: () => unload() }
}
test('late feedback loads cannot restore private data after account switch or leaving', async t => {
  const h = harness(t)
  for (const invalidate of [() => h.session.epoch++, h.hide, h.unload]) {
    await h.loaded(); h.page.openEditor('comment'); h.page.content.value = 'private draft'
    const work = h.page.load(); invalidate(); h.resolveLoad(); await work
    assert.equal(h.page.activity.value, null); assert.deepEqual(h.page.items.value, []); assert.equal(h.page.content.value, ''); assert.equal(h.page.editor.value, false)
  }
})
test('submission locks duplicate writes and ignores late errors after hide', async t => {
  const h = harness(t); await h.loaded(); h.page.openEditor('comment'); h.page.content.value = '  hello  '
  const work = h.page.submit(); await h.page.submit()
  assert.deepEqual(h.mutations, [['createComment', 'activity-a', 'hello']])
  h.hide(); h.latest('createComment').reject(new Error('old account failure')); await work
  assert.equal(h.page.actionError.value, ''); assert.equal(h.page.busy.value, false)
})
test('delete confirmation expires after identity change and duplicate taps do not open more modals', async t => {
  const h = harness(t); await h.loaded()
  const work = h.page.remove(h.item, 'comment'); await h.page.remove(h.item, 'comment')
  assert.equal(h.modals.length, 1); h.session.token = 'b'; h.modals[0]({ confirm: true }); await work
  assert.deepEqual(h.mutations, [])
})
test('successful submit reloads server data while a failed submit preserves the draft', async t => {
  const h = harness(t); await h.loaded(); h.page.openEditor('review'); h.page.content.value = 'experience'
  const failed = h.page.submit(); h.latest('createReview').reject(new Error('retry')); await failed
  assert.equal(h.page.content.value, 'experience'); assert.equal(h.page.editor.value, true); assert.equal(h.page.busy.value, false)
  const work = h.page.submit(); h.latest('createReview').resolve({}); await setImmediate(); h.resolveLoad(); await work
  assert.equal(h.page.editor.value, false); assert.equal(h.page.actionError.value, '')
})


test('stats failure is independently retryable and late stats cannot restore another account', async t => {
  const h = harness(t); await h.loaded(); h.page.context.value.isOrganizer = true
  const failed = h.page.loadStats(); h.latest('reviewStats').reject(new Error('network')); await failed
  assert.equal(h.page.statsError.value, 'network'); assert.equal(h.page.items.value.length, 1)
  const retry = h.page.loadStats(); h.latest('reviewStats').resolve({ count: 2, averageScore: 4.5 }); await retry
  assert.equal(h.page.statsError.value, ''); assert.equal(h.page.stats.value.averageScore, 4.5)
  const stale = h.page.loadStats(); h.hide(); h.latest('reviewStats').resolve({ count: 7, averageScore: 5 }); await stale
  assert.equal(h.page.stats.value, null); assert.equal(h.page.statsLoading.value, false)
})
