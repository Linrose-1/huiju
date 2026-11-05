import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { setImmediate } from 'node:timers/promises'
import { URL } from 'node:url'
import ts from 'typescript'

const require = createRequire(import.meta.url), vue = require('vue')
const fixture = {
  activityId: 'activity-1', title: '产业交流', coverUrl: '/cover.jpg', startsAt: '2026-12-20T01:00:00.000Z', endsAt: '2026-12-20T04:00:00.000Z',
  location: '交流厅', feeType: 'free', feeAmount: null, sourceHash: 'hash-a', version: 1,
  subtitle: '已确认介绍', highlights: ['已确认亮点'], copyStatus: 'confirmed', canEdit: true,
}
function harness(t, options = {}) {
  const hooks = {}, calls = { activityPoster: [], generatePosterCopy: [], savePosterCopy: [], activityPosterCode: [], platformBrand: [] }
  const modals = [], saves = [], shares = [], toasts = [], renders = [], removed = []
  const session = vue.reactive({ token: 'token-a', epoch: 1, member: { inviteCode: 'INVITE_A' } })
  const scope = vue.effectScope(); t.after(() => scope.stop())
  const ready = vue.ref(true)
  let bootCalls = 0
  const dependencies = {
    vue: { ...vue, getCurrentInstance: () => ({ proxy: {} }) },
    '@dcloudio/uni-app': Object.fromEntries(['onLoad', 'onShow', 'onHide', 'onUnload', 'onShareAppMessage'].map(name => [name, fn => { hooks[name] = fn }])),
    '@/services/api': { errorMessage: error => error.message, api: Object.fromEntries(Object.keys(calls).map(name => [name, (...args) => new Promise((resolve, reject) => calls[name].push({ args, resolve, reject }))])) },
    '@/services/navigation': { routes: { detail: '/pages/activity/detail' } },
    '@/stores/session': { useSessionStore: () => session },
    '@/services/wechat': { bootstrapIdentity: async () => { bootCalls++; if (options.bootstrap) await options.bootstrap(session, bootCalls) } },
    '@/services/wechat/page-share': { usePageShare: () => ({ shareReady: ready, shareBusy: vue.ref(false), shareError: vue.ref(''), retryShare() {}, shareMessage() {} }) },
    '@/services/wechat/poster-files': {
      posterCoverPath: async () => '/downloaded-cover.jpg', writePosterCode: async () => '/code.png', removePosterCode: path => removed.push(path),
      savePosterImage: async path => { saves.push(path) }, sharePosterImage: async path => { shares.push(path) },
    },
    '@/services/wechat/activity-poster-canvas': { POSTER_WIDTH: 1080, POSTER_HEIGHT: 1800, renderActivityPoster: async value => { renders.push(value); return '/poster.png' } },
    '@/components/base/PageReturn.vue': {}, '@/components/base/RequestState.vue': {},
  }
  const uni = { showModal: value => modals.push(value), showToast: value => toasts.push(value) }
  const source = readFileSync(new URL('../src/pages/activity/share.vue', import.meta.url), 'utf8').match(/<script setup lang="ts">([\s\S]*?)<\/script>/)[1]
  const code = ts.transpileModule(source + '\nexport { load, generateCopy, confirmCopy, reloadCopy, discardCopy, createPoster, exportImage, data, subtitle, highlight1, highlight2, generated, dirty, busy, loading, generating, saving, rendering, exporting, error, actionError, imagePath, remaining, editing };', {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText
  const page = {}
  scope.run(() => new Function('require', 'exports', 'uni', code)(name => {
    assert.ok(name in dependencies, `unexpected dependency ${name}`); return dependencies[name]
  }, page, uni))
  const flush = () => setImmediate()
  const h = { page, calls, hooks, session, modals, saves, shares, toasts, renders, removed, ready, flush, get bootCalls() { return bootCalls } }
  h.load = async (value = fixture) => {
    hooks.onLoad({ id: 'activity-1' }); hooks.onShow(); await flush()
    assert.ok(calls.activityPoster.length, 'load should reach the API after identity is ready')
    calls.activityPoster.at(-1).resolve({ ...value, highlights: [...value.highlights] }); await flush()
    assert.equal(page.loading.value, false)
  }
  h.makeImage = async () => {
    const pending = page.createPoster()
    calls.activityPoster.at(-1).resolve({ ...fixture }); await flush()
    calls.activityPosterCode.at(-1).resolve({ scene: 'p' + 'a'.repeat(24), base64: 'test-image', mimeType: 'image/png' })
    calls.platformBrand.at(-1).resolve({ displayName: '有聚点', visible: true })
    await pending
    assert.equal(page.imagePath.value, '/poster.png')
  }
  return h
}

test('initial identity recovery may change session while onShow still finishes the current page load', async t => {
  const h = harness(t, { bootstrap: async (session, call) => { if (call === 1) { session.token = 'recovered'; session.epoch++; session.member.inviteCode = 'RECOVERED' } } })
  await h.load()
  assert.equal(h.calls.activityPoster.length, 1)
  assert.equal(h.page.data.value.title, fixture.title)
  assert.ok(h.bootCalls >= 2)
  assert.equal(h.page.error.value, '')
})

test('AI generation produces an editable candidate without saving or exporting it', async t => {
  const h = harness(t); await h.load()
  const pending = h.page.generateCopy()
  await h.page.generateCopy()
  assert.equal(h.calls.generatePosterCopy.length, 1)
  h.calls.generatePosterCopy[0].resolve({ subtitle: 'AI候选', highlights: ['候选亮点'], sourceHash: fixture.sourceHash, remainingToday: 4 })
  await pending
  assert.equal(h.page.subtitle.value, 'AI候选')
  assert.equal(h.page.remaining.value, 4)
  assert.equal(h.page.dirty.value, true)
  assert.equal(h.page.editing.value, true)
  assert.equal(h.calls.savePosterCopy.length, 0)
  await h.page.createPoster()
  assert.equal(h.calls.activityPosterCode.length, 0)
})

test('dirty-copy regeneration locks before confirmation, so repeated taps open one dialog', async t => {
  const h = harness(t); await h.load(); h.page.subtitle.value = '未确认修改'
  const first = h.page.generateCopy(), second = h.page.generateCopy()
  const count = h.modals.length
  for (const modal of h.modals) modal.success({ confirm: false })
  await Promise.all([first, second])
  assert.equal(count, 1)
  assert.equal(h.calls.generatePosterCopy.length, 0)
  assert.equal(h.page.busy.value, false)
  assert.equal(h.page.subtitle.value, '未确认修改')
})

test('an old confirmation cannot generate AI copy after the account changes and reloads', async t => {
  const h = harness(t); await h.load(); h.page.subtitle.value = '旧账号草稿'
  const pending = h.page.generateCopy()
  h.session.token = 'token-b'; await h.flush()
  h.calls.activityPoster.at(-1).resolve({ ...fixture, subtitle: '新账号内容' }); await h.flush()
  h.modals[0].success({ confirm: true }); await h.flush()
  // Resolve an incorrectly dispatched call to keep the regression deterministic.
  for (const request of h.calls.generatePosterCopy) request.resolve({ subtitle: '错误调用', highlights: [], sourceHash: fixture.sourceHash, remainingToday: 4 })
  await pending
  assert.equal(h.calls.generatePosterCopy.length, 0)
  assert.equal(h.page.subtitle.value, '新账号内容')
})

test('late AI results after hide or identity change do not restore the old candidate', async t => {
  for (const mode of ['hide', 'identity']) {
    const h = harness(t); await h.load()
    const pending = h.page.generateCopy()
    if (mode === 'hide') h.hooks.onHide()
    else h.session.token = 'token-b'
    h.calls.generatePosterCopy[0].resolve({ subtitle: '迟到候选', highlights: [], sourceHash: fixture.sourceHash, remainingToday: 4 })
    await pending
    assert.notEqual(h.page.subtitle.value, '迟到候选')
    assert.equal(h.page.generated.value, false)
    assert.equal(h.page.generating.value, false)
    assert.equal(h.calls.savePosterCopy.length, 0)
  }
})

test('confirmation conflict preserves the candidate and does not report success', async t => {
  const h = harness(t); await h.load(); h.page.subtitle.value = '要保留的草稿'
  const pending = h.page.confirmCopy(); await h.page.confirmCopy()
  assert.equal(h.calls.savePosterCopy.length, 1)
  assert.deepEqual(h.calls.savePosterCopy[0].args, ['activity-1', { subtitle: '要保留的草稿', highlights: fixture.highlights, sourceHash: fixture.sourceHash, version: 1 }])
  h.calls.savePosterCopy[0].reject(Object.assign(new Error('版本冲突，请重新读取'), { status: 409 }))
  await pending
  assert.equal(h.page.subtitle.value, '要保留的草稿')
  assert.equal(h.page.dirty.value, true)
  assert.match(h.page.actionError.value, /版本冲突/)
  assert.equal(h.toasts.length, 0)
})

test('after a conflict reload cancellation preserves the draft, and confirmed reload replaces source and version', async t => {
  const h = harness(t); await h.load(); h.page.subtitle.value = '冲突后的草稿'
  const save = h.page.confirmCopy()
  h.calls.savePosterCopy[0].reject(Object.assign(new Error('版本冲突，请重新读取'), { status: 409 })); await save
  const cancelled = h.page.reloadCopy()
  h.modals.at(-1).success({ confirm: false }); await cancelled
  assert.equal(h.page.subtitle.value, '冲突后的草稿')
  assert.equal(h.page.dirty.value, true)
  assert.equal(h.calls.activityPoster.length, 1)
  const reload = h.page.reloadCopy(); await h.page.reloadCopy()
  assert.equal(h.modals.length, 2)
  h.modals.at(-1).success({ confirm: true }); await h.flush()
  h.calls.activityPoster.at(-1).resolve({ ...fixture, subtitle: '服务器新稿', sourceHash: 'hash-latest', version: 3 }); await reload
  assert.equal(h.page.subtitle.value, '服务器新稿')
  assert.equal(h.page.dirty.value, false)
  assert.equal(h.page.data.value.version, 3)
  h.page.subtitle.value = '基于新版本修订'
  const again = h.page.confirmCopy()
  assert.deepEqual(h.calls.savePosterCopy.at(-1).args[1], { subtitle: '基于新版本修订', highlights: fixture.highlights, sourceHash: 'hash-latest', version: 3 })
  h.calls.savePosterCopy.at(-1).resolve({ ...fixture, subtitle: '基于新版本修订', sourceHash: 'hash-latest', version: 4 }); await again
})

test('reload confirmation from a previous account cannot issue another read or replace new account content', async t => {
  const h = harness(t); await h.load(); h.page.subtitle.value = '旧账号未确认稿'
  const pending = h.page.reloadCopy()
  h.session.token = 'token-b'; await h.flush()
  h.calls.activityPoster.at(-1).resolve({ ...fixture, subtitle: '新账号内容' }); await h.flush()
  const reads = h.calls.activityPoster.length
  h.modals[0].success({ confirm: true }); await h.flush()
  for (const request of h.calls.activityPoster.slice(reads)) request.resolve({ ...fixture, subtitle: '过期覆盖' })
  await pending
  assert.equal(h.calls.activityPoster.length, reads)
  assert.equal(h.page.subtitle.value, '新账号内容')
  assert.equal(h.page.loading.value, false)
})

test('confirmed copy clears dirty state and ordinary viewers cannot generate or save copy', async t => {
  const h = harness(t); await h.load(); h.page.subtitle.value = '已检查文案'
  const pending = h.page.confirmCopy()
  h.calls.savePosterCopy[0].resolve({ ...fixture, subtitle: '已检查文案', version: 2 })
  await pending
  assert.equal(h.page.dirty.value, false)
  assert.equal(h.page.data.value.version, 2)
  const viewer = harness(t); await viewer.load({ ...fixture, canEdit: false, copyStatus: 'none', subtitle: '', highlights: [] })
  await viewer.page.generateCopy(); await viewer.page.confirmCopy()
  assert.equal(viewer.calls.generatePosterCopy.length, 0)
  assert.equal(viewer.calls.savePosterCopy.length, 0)
})

test('poster creation cleans temporary code and a dirty edit blocks exporting the existing image', async t => {
  const h = harness(t); await h.load(); await h.makeImage()
  assert.equal(h.renders.length, 1)
  assert.deepEqual(h.removed, ['/code.png'])
  h.page.subtitle.value = '尚未确认的新文案'
  const count = h.calls.activityPoster.length
  const pending = h.page.exportImage(false)
  for (const request of h.calls.activityPoster.slice(count)) request.resolve({ ...fixture })
  await pending
  assert.equal(h.calls.activityPoster.length, count)
  assert.deepEqual(h.saves, [])
})

test('export rechecks both activity source and confirmed-copy version before sharing or saving', async t => {
  for (const patch of [{ sourceHash: 'hash-new' }, { version: 2 }]) {
    const h = harness(t); await h.load(); await h.makeImage()
    const pending = h.page.exportImage(true)
    assert.deepEqual(h.shares, [])
    h.calls.activityPoster.at(-1).resolve({ ...fixture, ...patch }); await pending
    assert.equal(h.page.imagePath.value, '')
    assert.match(h.page.actionError.value, /已更新/)
    assert.deepEqual(h.shares, [])
  }
})

test('unchanged export invokes the platform adapter once and identity switch cancels pending export', async t => {
  const h = harness(t); await h.load(); await h.makeImage()
  const save = h.page.exportImage(false); await h.page.exportImage(false)
  h.calls.activityPoster.at(-1).resolve({ ...fixture }); await save
  assert.deepEqual(h.saves, ['/poster.png'])
  const share = h.page.exportImage(true), request = h.calls.activityPoster.at(-1)
  h.session.token = 'token-b'
  request.resolve({ ...fixture }); await share
  assert.deepEqual(h.shares, [])
  assert.equal(h.page.imagePath.value, '')
})
