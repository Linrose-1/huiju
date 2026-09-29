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
  const session = reactive({ token: 'a', epoch: 0 }), requests = [], modals = [], mutations = []
  let hide, unload
  const pending = kind => new Promise((resolve, reject) => requests.push({ kind, resolve, reject }))
  const deps = {
    '@dcloudio/uni-app': { onLoad(fn) { fn({ id: 'activity-a' }) }, onShow() {}, onHide(fn) { hide = fn }, onUnload(fn) { unload = fn }, onShareAppMessage() {} },
    '@/services/api': { api: {
      managedActivity: () => pending('activity'), organizerRoster: () => pending('roster'), activityViewStats: async () => ({}),
      markAttendance: (activityId, registrationId) => { mutations.push([activityId, registrationId]); return pending('attendance') }
    }, ApiError: class extends Error {}, errorMessage: e => e.message },
    '@/services/api/environment': {}, '@/services/presentation': {}, '@/services/navigation': {},
    '@/stores/session': { useSessionStore: () => session }, '@/components/base/RequestState.vue': {}
  }
  const source = readFileSync(new URL('../src/pages/activity/manage.vue', import.meta.url), 'utf8').match(/<script setup lang="ts">([\s\S]*?)<\/script>/)[1]
  const code = ts.transpileModule(source+'\nexport {load,markAttendance,activity,roster,busy,attendanceBusy,attendanceCount,actionError};', { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
  const page = {}, scope = effectScope()
  scope.run(() => new Function('require', 'exports', 'uni', code)(name => deps[name] || require(name), page, { showModal: () => new Promise(resolve => modals.push(resolve)) }))
  t.after(() => scope.stop())
  const latest = kind => requests.filter(item => item.kind === kind).at(-1)
  const resolveLoad = (attended = false) => {
    latest('activity').resolve({ lifecycle: 'published', moderation: 'normal' })
    latest('roster').resolve({ items: [{ id: 'signup-a', status: 'active', attended }, { id: 'signup-b', status: 'active', attended: false }] })
  }
  const loaded = async () => { const task = page.load(); resolveLoad(); await task }
  return { page, session, requests, latest, loaded, resolveLoad, modals, mutations, hide: () => hide(), unload: () => unload() }
}

test('attendance confirmation is invalidated by account switch, hide or unload', async t => {
  const h = harness(t)
  for (const invalidate of [() => h.session.epoch++, h.hide, h.unload]) {
    await h.loaded()
    const task = h.page.markAttendance(h.page.roster.value[0])
    invalidate(); h.modals.at(-1)({ confirm: true }); await task
    assert.equal(h.page.attendanceBusy.value, ''); assert.equal(h.page.busy.value, false)
    assert.deepEqual(h.page.roster.value, [])
  }
  assert.deepEqual(h.mutations, [])
})

test('attendance prevents duplicate clicks through confirmation and request, refreshes authoritative roster on success', async t => {
  const h = harness(t); await h.loaded()
  const first = h.page.roster.value[0], second = h.page.roster.value[1]
  const task = h.page.markAttendance(first)
  await h.page.markAttendance(first); await h.page.markAttendance(second)
  assert.equal(h.modals.length, 1)
  h.modals[0]({ confirm: true }); await setImmediate()
  await h.page.markAttendance(first)
  assert.deepEqual(h.mutations, [['activity-a', 'signup-a']])
  h.latest('attendance').resolve({ attended: true }); await setImmediate()
  h.resolveLoad(true); await task
  assert.equal(h.page.roster.value[0].attended, true); assert.equal(h.page.attendanceCount.value, 1)
  assert.equal(h.page.attendanceBusy.value, ''); assert.equal(h.page.busy.value, false)
})

test('late attendance success or failure does not reload, show old errors or clear a new operation', async t => {
  const h = harness(t)
  for (const outcome of ['resolve', 'reject']) {
    await h.loaded()
    const oldTask = h.page.markAttendance(h.page.roster.value[0])
    h.modals.at(-1)({ confirm: true }); await setImmediate()
    const oldRequest = h.latest('attendance')
    h.session.epoch++; await h.loaded()
    const newTask = h.page.markAttendance(h.page.roster.value[1])
    const count = h.requests.length
    oldRequest[outcome](outcome === 'reject' ? new Error('old failure') : { attended: true }); await oldTask
    assert.equal(h.requests.length, count); assert.equal(h.page.actionError.value, '')
    assert.equal(h.page.busy.value, true); assert.equal(h.page.attendanceBusy.value, 'signup-b')
    h.modals.at(-1)({ confirm: false }); await newTask
  }
})

test('cancelled, already attended, foreign and unavailable records never open confirmation', async t => {
  const h = harness(t); await h.loaded()
  const item = h.page.roster.value[0]
  item.status = 'cancelled'; await h.page.markAttendance(item)
  item.status = 'active'; item.attended = true; await h.page.markAttendance(item)
  item.attended = false; await h.page.markAttendance({ ...item })
  h.page.activity.value.moderation = 'removed'; await h.page.markAttendance(item)
  h.page.activity.value.moderation = 'normal'; h.page.activity.value.lifecycle = 'cancelled'; await h.page.markAttendance(item)
  assert.equal(h.modals.length, 0); assert.deepEqual(h.mutations, [])
})
