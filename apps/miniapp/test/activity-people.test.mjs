import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { URL } from 'node:url'
import { setImmediate } from 'node:timers/promises'
import ts from 'typescript'
const require = createRequire(import.meta.url)
const { reactive, effectScope } = require('vue')
function harness(t, kind = 'roster') {
  const hooks = {}, requests = [], titles = []
  const session = reactive({ token: 'a', epoch: 0 })
  const request = (method, ...args) => new Promise((resolve, reject) => requests.push({ method, args, resolve, reject }))
  const deps = {
    '@dcloudio/uni-app': Object.fromEntries(['onLoad','onShow','onHide','onUnload','onReachBottom','onPullDownRefresh'].map(key => [key, fn => { hooks[key] = fn }])),
    '@/services/api': { api: { roster: (...args) => request('roster', ...args), activityReaders: (...args) => request('readers', ...args) }, errorMessage: e => e.message },
    '@/services/api/environment': {}, '@/services/navigation': {}, '@/stores/session': { useSessionStore: () => session }
  }
  const source = readFileSync(new URL('../src/pages/activity/people.vue', import.meta.url), 'utf8').match(/<script setup lang="ts">([\s\S]*?)<\/script>/)[1]
  const code = ts.transpileModule(source + '\nexport {people,load,loading,moreLoading,error,moreError,hasMore,retryMore};', { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
  const page = {}, scope = effectScope()
  scope.run(() => new Function('require','exports','uni',code)(name => deps[name] || require(name),page,{stopPullDownRefresh(){},setNavigationBarTitle(value){titles.push(value.title)}}))
  t.after(() => scope.stop())
  hooks.onLoad({id:'activity',kind}); hooks.onShow()
  return {page,hooks,requests,session,titles}
}
const result = (ids, hasMore = false) => ({items:ids.map(memberId => ({memberId,displayName:memberId})),hasMore})
test('both list modes select the correct API and page title', async t => {
  for (const kind of ['roster','readers']) {
    const h=harness(t,kind)
    assert.equal(h.requests[0].method,kind)
    assert.equal(h.titles[0],kind==='roster'?'报名名单':'阅读留痕')
    h.requests[0].resolve(result(['a'])); await setImmediate()
    assert.equal(h.page.people.value.length,1)
  }
})
test('append failure preserves rows, retries offset, and blocks duplicate requests', async t => {
  const h=harness(t); h.requests[0].resolve(result(['a'],true)); await setImmediate()
  h.hooks.onReachBottom(); h.hooks.onReachBottom(); assert.equal(h.requests.length,2)
  h.requests[1].reject(new Error('offline')); await setImmediate()
  assert.equal(h.page.people.value.length,1); assert.equal(h.page.moreError.value,'offline')
  h.page.retryMore(); assert.deepEqual(h.requests[2].args,['activity',{offset:1}])
  h.requests[2].resolve(result(['a','b'],true)); await setImmediate()
  assert.deepEqual(h.page.people.value.map(p=>p.memberId),['a','b'])
  h.hooks.onReachBottom(); assert.deepEqual(h.requests[3].args,['activity',{offset:3}])
})
test('refresh, hide and account change discard stale responses', async t => {
  const h=harness(t)
  h.hooks.onPullDownRefresh(); h.requests[0].resolve(result(['old']))
  h.requests[1].resolve(result(['fresh'])); await setImmediate()
  assert.equal(h.page.people.value[0].memberId,'fresh')
  h.session.epoch++; await setImmediate()
  assert.equal(h.page.people.value.length,0)
  h.hooks.onHide(); h.requests[2].resolve(result(['hidden'])); await setImmediate()
  assert.equal(h.page.people.value.length,0)
  h.hooks.onShow(); h.requests[3].resolve(result([])); await setImmediate()
  assert.equal(h.page.loading.value,false); assert.equal(h.page.hasMore.value,false)
})
