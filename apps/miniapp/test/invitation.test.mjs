import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { URL } from 'node:url'
import { setImmediate } from 'node:timers/promises'
import ts from 'typescript'
const require = createRequire(import.meta.url)
const {reactive, effectScope} = require('vue')
function harness(t) {
  const session = reactive({token:'member-a',epoch:0,member:{inviteCode:'real-code-a'}})
  const refreshes=[],copies=[],tabs=[]
  let unload
  const deps={
    '@dcloudio/uni-app':{onShow(){},onUnload(fn){unload=fn}},
    '@/services/api':{refreshMember:()=>new Promise((resolve,reject)=>refreshes.push({resolve,reject})),errorMessage:e=>e.message},
    '@/services/api/environment':{}, '@/services/navigation':{routes:{activity:'/pages/activity/index'}},
    '@/stores/session':{useSessionStore:()=>session}
  }
  const source=readFileSync(new URL('../src/pages/invitation/index.vue',import.meta.url),'utf8').match(/<script setup lang="ts">([\s\S]*?)<\/script>/)[1]
  const code=ts.transpileModule(source+'\nexport {load,copy,activities,error,loading};',{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText
  const page={},scope=effectScope()
  scope.run(()=>new Function('require','exports','uni',code)(name=>deps[name]||require(name),page,{
    setClipboardData:({data})=>new Promise(resolve=>copies.push({data,resolve})),switchTab:input=>tabs.push(input)
  }))
  t.after(()=>scope.stop())
  return {session,page,refreshes,copies,tabs,unload:()=>unload()}
}
test('copy uses the current member code, blocks duplicate taps and anonymous copying',async t=>{
  const h=harness(t)
  const first=h.page.copy();await h.page.copy()
  assert.equal(h.copies.length,1);assert.equal(h.copies[0].data,'real-code-a')
  h.copies[0].resolve();await first
  h.session.token='';h.session.member=null;await setImmediate();await h.page.copy()
  assert.equal(h.copies.length,1)
})
test('late refresh failure cannot overwrite a new account or an unloaded page',async t=>{
  const h=harness(t)
  const old=h.page.load()
  h.session.token='member-b';h.session.epoch++;await setImmediate()
  h.refreshes[1].resolve();await setImmediate()
  h.refreshes[0].reject(new Error('old failure'));await old
  assert.equal(h.page.error.value,'')
  const pending=h.page.load();h.unload();h.refreshes[2].reject(new Error('unloaded'));await pending
  assert.equal(h.page.error.value,'')
})
test('activity entry uses the registered tab route', t=>{
  const h=harness(t);h.page.activities();assert.deepEqual(h.tabs,[{url:'/pages/activity/index'}])
})
