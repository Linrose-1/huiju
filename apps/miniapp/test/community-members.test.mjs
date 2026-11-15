import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { URL } from 'node:url'
import { setImmediate } from 'node:timers/promises'
import { test } from 'node:test'
import ts from 'typescript'
import * as vue from 'vue'

const file = new URL('../src/pages/community/members.vue', import.meta.url)
const script = readFileSync(file, 'utf8').match(/<script setup lang="ts">([\s\S]*?)<\/script>/)[1]
const compiled = ts.transpileModule(script + '\nexport {items, change, load, moreError, denied}', {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText
class ApiError extends Error { status = 403 }
const row = { memberId: 'abc', displayName: '用户', userNumber: 'XJ000001', isRegistered: false }
function mockPage(t, api, confirm) {
  let show
  const hooks = { onShow: fn => { show = fn }, onHide() {}, onUnload() {}, onPullDownRefresh() {}, onReachBottom() {} }
  const scope = vue.effectScope(), session = vue.reactive({ epoch: 0, token: 'user' })
  const modules = {
    vue, '@dcloudio/uni-app': hooks, '@/services/api': { api, ApiError, errorMessage: e => e.message },
    '@/services/navigation': { requireProfile: async () => true, routes: {} }, '@/stores/session': { useSessionStore: () => session },
  }
  const page = {}
  scope.run(() => new Function('require', 'exports', 'uni', compiled)(name => modules[name] || {}, page, {
    stopPullDownRefresh() {}, showToast() {}, showModal: confirm,
  }))
  t.after(() => scope.stop())
  show()
  return {page, session}
}
test('an append failure keeps the loaded rows; a revoked administrator loses access to the entire roster', async t => {
  const requests = []
  const api = { communityMembers: async offset => {
    requests.push(offset)
    if (offset === 0) return {items:[row], total:2}
    if (requests.length === 2) throw new Error('稍后重试')
    throw new ApiError('无权限')
  } }
  const {page} = mockPage(t,api); await setImmediate()
  await page.load(true)
  assert.equal(page.items.value.length,1)
  assert.equal(page.moreError.value,'稍后重试')
  await page.load(true)
  assert.deepEqual(requests,[0,1,1])
  assert.equal(page.denied.value,true)
  assert.equal(page.items.value.length,0)
})
test('canceling confirmation and switching accounts during confirmation both prevent submitting the change',async t => {
  let reply, writes = 0
  const api = {
    communityMembers: async () => ({items:[row],total:1}),
    setCommunityMembership: async () => { writes++; return {...row,isRegistered:true} },
  }
  const {page,session} = mockPage(t,api,() => new Promise(resolve => { reply = resolve }))
  await setImmediate()
  let update = page.change(row); reply({confirm:false}); await update
  assert.equal(writes,0)
  update = page.change(row); session.epoch++; reply({confirm:true}); await update
  assert.equal(writes,0)
  await setImmediate()
  update = page.change(row); reply({confirm:true}); await update
  assert.equal(writes,1)
  assert.equal(page.items.value[0].isRegistered,true)
})
