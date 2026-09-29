import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { URL } from 'node:url'
import ts from 'typescript'

const require = createRequire(import.meta.url)
const { effectScope } = require('vue')

function harness(t) {
  const requests = []
  let bottom, hide
  const deps = {
    '@dcloudio/uni-app': {
      onLoad() {}, onShow() {}, onHide(fn) { hide = fn }, onUnload() {}, onPullDownRefresh() {}, onReachBottom(fn) { bottom = fn }
    },
    '@/services/api': { api: { activities: query => new Promise((resolve, reject) => requests.push({ query, resolve, reject })) }, errorMessage: e => e.message },
    '@/services/api/environment': {}, '@/services/presentation': {}, '@/services/navigation': {},
    '@/stores/session': {}, '@/services/wechat': {}, '@/services/activity-code': {}, '@/components/base/RequestState.vue': {}
  }
  const source = readFileSync(new URL('../src/pages/activity/index.vue', import.meta.url), 'utf8').match(/<script setup lang="ts">([\s\S]*?)<\/script>/)[1]
  const code = ts.transpileModule(source + '\nexport { load, more, retryMore, items, hasMore, loadingMore, moreError, chooseTab };', {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
  }).outputText
  const page = {}, scope = effectScope()
  scope.run(() => new Function('require', 'exports', 'uni', code)(name => deps[name] || require(name), page, { stopPullDownRefresh() {} }))
  t.after(() => scope.stop())
  return { page, requests, bottom: () => bottom(), hide: () => hide() }
}

test('activity list appends pages once, preserves cards on failure and retries same offset', async t => {
  const h = harness(t)
  const first = h.page.load()
  assert.deepEqual(h.requests[0].query, { sort: 'latest', q: '' })
  h.requests[0].resolve({ items: [{ id: 'a' }], hasMore: true })
  await first

  const next = h.bottom()
  h.bottom()
  assert.equal(h.requests.length, 2)
  assert.equal(h.page.loadingMore.value, true)
  assert.equal(h.requests[1].query.offset, 1)
  h.requests[1].reject(new Error('网络中断'))
  await next
  assert.deepEqual(h.page.items.value.map(item => item.id), ['a'])
  assert.equal(h.page.moreError.value, '网络中断')
  h.bottom()
  assert.equal(h.requests.length, 2)

  h.page.retryMore()
  assert.equal(h.requests[2].query.offset, 1)
  h.requests[2].resolve({ items: [{ id: 'b' }], hasMore: false })
  await Promise.resolve()
  assert.deepEqual(h.page.items.value.map(item => item.id), ['a', 'b'])
  assert.equal(h.page.hasMore.value, false)
  h.bottom()
  assert.equal(h.requests.length, 3)
})

test('refresh and tab changes discard stale pages', async t => {
  const h = harness(t)
  const first = h.page.load()
  h.requests[0].resolve({ items: [{ id: 'a' }], hasMore: true })
  await first
  const olderPage = h.page.more()
  h.page.chooseTab('即将开始')
  assert.equal(h.requests[2].query.sort, 'upcoming')
  h.requests[1].resolve({ items: [{ id: 'stale' }], hasMore: false })
  await olderPage
  h.requests[2].resolve({ items: [{ id: 'future' }], hasMore: false })
  await Promise.resolve()
  assert.deepEqual(h.page.items.value.map(item => item.id), ['future'])
  const hidden = h.page.load()
  h.hide()
  h.requests[3].resolve({ items: [{ id: 'hidden' }], hasMore: false })
  await hidden
  assert.deepEqual(h.page.items.value.map(item => item.id), [])
})
