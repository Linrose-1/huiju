import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { URL } from 'node:url'
import { setImmediate } from 'node:timers/promises'
import ts from 'typescript'
const require = createRequire(import.meta.url)
const { reactive, effectScope } = require('vue')
function harness(t, notification = false) {
  const session = reactive({ token: 'a', epoch: 0 }), requests = [], modals = [], mutations = [], navigated = []
  let hide, unload
  const pending = kind => new Promise((resolve, reject) => requests.push({ kind, resolve, reject }))
  const deps = {
    '@dcloudio/uni-app': { onLoad(fn) { fn({ id: 'activity-a' }) }, onShow() {}, onHide(fn) { hide = fn }, onUnload(fn) { unload = fn }, onShareAppMessage() {} },
    '@/services/api': { api: {
      managedActivity: () => pending('activity'), organizerRoster: () => pending('roster'), activityViewStats: () => pending('stats'),
      publishActivity: id => { mutations.push(['publish', id]); return pending('publish') },
      cancelActivity: (id, reason) => { mutations.push(['cancel', id, reason]); return pending('cancel') },
      notifications: () => pending('notifications'), readNotification: id => { mutations.push(['read', id]); return pending('read') }
    }, ApiError: class extends Error {}, errorMessage: e => e.message },
    '@/services/api/environment': {}, '@/services/presentation': {},
    '@/services/navigation': { routes: { detail: '/detail' }, navigate: value => navigated.push(value), loginPage: value => navigated.push(value) },
    '@/stores/session': { useSessionStore: () => session }, '@/components/base/RequestState.vue': {}
  }
  const file = notification ? 'notification/index' : 'activity/manage'
  const names = notification ? 'load,open,items,error,actionError,busy,loading' : 'load,publish,cancel,id,activity,roster,readingStats,reason,error,actionError,busy,loading'
  const source = readFileSync(new URL('../src/pages/'+file+'.vue', import.meta.url), 'utf8').match(/<script setup lang="ts">([\s\S]*?)<\/script>/)[1]
  const code = ts.transpileModule(source+'\nexport {'+names+'};', { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
  const page = {}, scope = effectScope()
  scope.run(() => new Function('require', 'exports', 'uni', code)(name => deps[name] || require(name), page, { showModal: () => new Promise(resolve => modals.push(resolve)) }))
  t.after(() => scope.stop())
  const latest = kind => requests.filter(item => item.kind === kind).at(-1)
  const loaded = async (lifecycle = 'draft') => {
    const promise = page.load()
    if (notification) latest('notifications').resolve({ items: [{ id: 'notice-a', activityId: 'activity-a', readAt: null }], hasMore: false })
    else { latest('activity').resolve({ lifecycle, startsAt: '2099-01-01', endsAt: '2099-01-02', moderation: 'normal' }); latest('roster').resolve({ items: [{ contactPhone: 'private' }] }) }
    await promise
  }
  return { page, session, requests, latest, loaded, modals, mutations, navigated, hide: () => hide(), unload: () => unload() }
}

test('management clears private data synchronously and discards late stats/load results', async t => {
  const h = harness(t); await h.loaded()
  assert.equal(h.page.roster.value[0].contactPhone, 'private')
  const stats = h.latest('stats'), pending = h.page.load()
  h.session.token = 'b'
  assert.equal(h.page.activity.value, null); assert.deepEqual(h.page.roster.value, [])
  h.latest('activity').resolve({ title: 'old' }); h.latest('roster').resolve({ items: [{ contactPhone: 'old' }] }); stats.resolve({ views: 1 })
  await pending; await setImmediate()
  assert.equal(h.page.readingStats.value, null); assert.equal(h.page.activity.value, null)
  assert.equal(h.page.loading.value, false)
})

test('publish confirmation expires on session change, hide and unload', async t => {
  const h = harness(t)
  for (const invalidate of [() => h.session.epoch++, h.hide, h.unload]) {
    await h.loaded(); const pending = h.page.publish(); await h.page.publish()
    const confirm = h.modals.at(-1); invalidate(); confirm({ confirm: true }); await pending
    assert.equal(h.page.busy.value, false)
  }
  assert.deepEqual(h.mutations, []); assert.equal(h.modals.length, 3)
})

test('cancel snapshots the activity and reason, requires confirmation, refreshes after success', async t => {
  const h = harness(t); await h.loaded('published'); h.page.reason.value = '  原因  '
  const declined = h.page.cancel(); h.modals.at(-1)({ confirm: false }); await declined
  assert.deepEqual(h.mutations, [])
  const accepted = h.page.cancel(); h.page.id.value = 'activity-b'; h.page.reason.value = 'changed'
  h.modals.at(-1)({ confirm: true }); await setImmediate()
  assert.deepEqual(h.mutations, [['cancel', 'activity-a', '原因']])
  h.latest('cancel').resolve(); await setImmediate()
  assert.equal(h.page.busy.value, false); assert.equal(h.page.loading.value, true)
  h.latest('activity').resolve({ lifecycle: 'cancelled' }); h.latest('roster').resolve({ items: [] }); await accepted
  assert.equal(h.page.activity.value.lifecycle, 'cancelled'); assert.equal(h.page.loading.value, false)
})

test('cancel modal and late mutation errors cannot affect another session', async t => {
  const h = harness(t); await h.loaded('published'); h.page.reason.value = 'reason'
  const pending = h.page.cancel(); h.hide(); h.modals.at(-1)({ confirm: true }); await pending
  assert.deepEqual(h.mutations, [])
  await h.loaded(); const publish = h.page.publish(); h.modals.at(-1)({ confirm: true }); await setImmediate()
  h.session.token = 'b'; h.latest('publish').reject(new Error('old')); await publish
  assert.equal(h.page.actionError.value, ''); assert.equal(h.page.busy.value, false)
})

test('notification read completion after hide/unload/account switch cannot navigate or restore data', async t => {
  const h = harness(t, true)
  for (const invalidate of [() => h.session.token = 'b', h.hide, h.unload]) {
    await h.loaded(); const item = h.page.items.value[0], pending = h.page.open(item)
    await h.page.open(item); invalidate(); h.latest('read').resolve(); await pending
    assert.equal(item.readAt, null); assert.deepEqual(h.page.items.value, []); assert.equal(h.page.busy.value, false)
  }
  assert.deepEqual(h.navigated, []); assert.equal(h.mutations.length, 3)
})

test('notification active read marks read and opens activity once, failed stale reads stay silent', async t => {
  const h = harness(t, true); await h.loaded()
  const item = h.page.items.value[0], pending = h.page.open(item)
  await h.page.open(item); h.latest('read').resolve(); await pending
  assert.ok(item.readAt); assert.deepEqual(h.navigated, ['/detail?id=activity-a'])
  await h.loaded(); const failed = h.page.open(h.page.items.value[0]); h.unload(); h.latest('read').reject(new Error('old')); await failed
  assert.equal(h.page.actionError.value, ''); assert.equal(h.page.busy.value, false)
})
