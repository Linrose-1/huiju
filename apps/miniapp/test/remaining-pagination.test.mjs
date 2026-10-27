import assert from 'node:assert/strict'
import { test } from 'node:test'
import { URL } from 'node:url'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { setImmediate } from 'node:timers/promises'
import ts from 'typescript'

const require = createRequire(import.meta.url)
const { reactive, effectScope } = require('vue')
const counts = { all: 125, upcoming: 73, ongoing: 0, ended: 52, cancelled: 0, draft: 0, removed: 0 }
const records = (start, count) => Array.from({ length: count }, (_, i) => ({ id: String(start + i), status: 'active', attended: false }))
function harness(t, path) {
  const session = reactive({ token: 'member-a', epoch: 0 }), requests = [], hooks = {}
  const request = (name, query) => new Promise((resolve, reject) => requests.push({ name, query, resolve, reject }))
  const deps = {
    '@dcloudio/uni-app': Object.fromEntries(['onLoad', 'onShow', 'onHide', 'onUnload', 'onReachBottom', 'onPullDownRefresh', 'onShareAppMessage'].map(name => [name, callback => {
      hooks[name] = callback
      if (name === 'onLoad') callback({ id: 'activity-a' })
    }])),
    '@/stores/session': { useSessionStore: () => session },
    '@/services/api': { errorMessage: e => e.message, api: {
      organizedActivities: query => request('list', query), registrations: query => request('list', query), notifications: query => request('list', query),
      managedActivity: async () => ({ id: 'activity-a', lifecycle: 'published', startsAt: '2099-01-01', endsAt: '2099-01-02', moderation: 'normal' }),
      organizerRoster: (_id, query) => request('list', query), activityViewStats: async () => ({ views: 30, viewers: 20 })
    } },
    '@/services/my-activities': { activityFilters: [{ key: 'all', label: '全部' }, { key: 'upcoming', label: '未开始' }, { key: 'ended', label: '已结束' }] },
    '@/services/navigation': {}, '@/services/wechat/page-share': { usePageShare: () => ({ shareReady: { value: false }, shareError: { value: '' }, shareBusy: { value: false }, retryShare() {} }) },
    '@/services/api/environment': {}, '@/services/presentation': {},
  }
  const manage = path === 'activity/manage', notification = path === 'notification/index'
  const extra = manage ? 'load,loadRoster,selectFilter,roster,rosterMoreError,attendanceCount,activeCount,retryRosterMore'
    : notification ? 'load,more,items,moreError,retryMore' : 'load,more,items,moreError,retryMore,selectFilter,filters'
  const source = readFileSync(new URL('../src/pages/' + path + '.vue', import.meta.url), 'utf8').match(/<script setup lang="ts">([\s\S]*?)<\/script>/)[1]
  const code = ts.transpileModule(source + '\nexport {' + extra + '};', { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
  const page = {}, scope = effectScope()
  scope.run(() => new Function('require', 'exports', 'uni', code)(name => deps[name] || require(name), page, { stopPullDownRefresh() {} }))
  t.after(() => scope.stop())
  return { page, session, requests, hooks, items: manage ? page.roster : page.items,
    error: manage ? page.rosterMoreError : page.moreError, retry: manage ? page.retryRosterMore : page.retryMore }
}
const response = (items, hasMore = true) => ({ items, hasMore, counts, total: 125, activeCount: 103, attendedCount: 81 })

for (const path of ['activity/organized', 'registration/index', 'notification/index', 'activity/manage']) {
  test(path + ': appends, deduplicates, preserves first page on failure, retries same raw offset and stops at end', async t => {
    const h = harness(t, path), first = h.page.load()
    assert.equal(h.requests[0].query.offset, 0)
    h.requests[0].resolve(response(records(0, 20)))
    await first
    const next = h.hooks.onReachBottom()
    h.hooks.onReachBottom()
    assert.equal(h.requests.length, 2)
    assert.equal(h.requests[1].query.offset, 20)
    h.requests[1].reject(new Error('offline'))
    await next
    assert.equal(h.items.value.length, 20)
    assert.equal(h.error.value, 'offline')
    h.hooks.onReachBottom()
    assert.equal(h.requests.length, 2)
    h.retry()
    assert.equal(h.requests[2].query.offset, 20)
    h.requests[2].resolve(response(records(19, 2)))
    await setImmediate()
    assert.equal(h.items.value.length, 21)
    const last = h.hooks.onReachBottom()
    assert.equal(h.requests[3].query.offset, 22, 'offset follows raw result count despite duplicate rows')
    h.requests[3].resolve(response([], false))
    await last
    h.hooks.onReachBottom()
    assert.equal(h.requests.length, 4)
    if (h.page.attendanceCount) {
      assert.equal(h.page.attendanceCount.value, 81, 'attendance comes from full server aggregate, not loaded rows')
      assert.equal(h.page.activeCount.value, 103)
    }
  })

  test(path + ': refresh resets offset and ignores late pages, account/hide clear loaded data', async t => {
    const h = harness(t, path), first = h.page.load()
    h.requests[0].resolve(response(records(0, 20))); await first
    const old = h.hooks.onReachBottom()
    h.hooks.onPullDownRefresh()
    assert.equal(h.requests[2].query.offset, 0)
    h.requests[2].resolve(response(records(100, 1), false)); await setImmediate()
    h.requests[1].resolve(response(records(20, 20))); await old
    assert.deepEqual(h.items.value.map(item => item.id), ['100'])
    h.session.token = 'member-b'
    assert.deepEqual(h.items.value, [])
    const pending = h.page.load()
    h.hooks.onHide()
    h.requests.at(-1).resolve(response(records(200, 1))); await pending
    assert.deepEqual(h.items.value, [])
  })
}

for (const path of ['activity/organized', 'registration/index', 'activity/manage']) {
  test(path + ': filter is sent to server and cannot be overwritten by previous page', async t => {
    const h = harness(t, path), first = h.page.load()
    h.requests[0].resolve(response(records(0, 20))); await first
    const old = h.hooks.onReachBottom()
    const filter = path === 'activity/manage' ? 'cancelled' : 'ended'
    h.page.selectFilter(filter)
    assert.deepEqual(h.requests[2].query, { offset: 0, status: filter })
    h.requests[1].resolve(response(records(20, 20))); await old
    h.requests[2].resolve(response(records(100, 1), false)); await setImmediate()
    assert.deepEqual(h.items.value.map(item => item.id), ['100'])
    if (h.page.filters) assert.equal(h.page.filters.value.find(item => item.key === 'ended').count, 52)
  })
}
