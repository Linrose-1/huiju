import { URL } from 'node:url'
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import ts from 'typescript'
const require = createRequire(import.meta.url)
const {reactive,effectScope} = require('vue')
function compile(source,deps={},extra='') {
  const code=ts.transpileModule(source+extra,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText
  const result={};new Function('require','exports',code)(name=>deps[name]||require(name),result);return result
}
const states=compile(readFileSync(new URL('../src/services/my-activities.ts',import.meta.url),'utf8'))
const base={startsAt:'2026-10-01T00:00:00Z',endsAt:'2026-10-01T02:00:00Z',registrationState:'open'}
test('activity filters use activity time rather than registration deadline and retain exceptional states',()=>{
  assert.equal(states.myActivityState(base,undefined,Date.parse(base.startsAt)-1),'upcoming')
  assert.equal(states.myActivityState(base,undefined,Date.parse(base.startsAt)),'ongoing')
  assert.equal(states.myActivityState(base,undefined,Date.parse(base.endsAt)),'ended')
  assert.equal(states.myActivityState({...base,lifecycle:'draft'}),'draft')
  assert.equal(states.myActivityState({...base,registrationState:'removed'},'cancelled'),'removed')
  assert.equal(states.myActivityLabel(base,'cancelled'),'已取消报名')
  assert.equal(states.myActivityLabel({...base,registrationState:'cancelled'},'active'),'活动已取消')
})
for(const pagePath of ['activity/organized','registration/index']) {
  test(pagePath+' clears account data and ignores late requests after account change or unload',async t=>{
    const session=reactive({token:'a',epoch:0}),pending=[];let unload
    const deps={
      '@dcloudio/uni-app':{onShow(){},onUnload(fn){unload=fn}},
      '@/services/api':{api:{organizedActivities:request,registrations:request},errorMessage:e=>e.message},
      '@/services/my-activities':states,
      '@/services/navigation':{},'@/stores/session':{useSessionStore:()=>session},
      '@/components/base/RequestState.vue':{},'@/components/business/MyActivityCard.vue':{}
    }
    function request(){return new Promise((resolve,reject)=>pending.push({resolve,reject}))}
    const source=readFileSync(new URL('../src/pages/'+pagePath+'.vue',import.meta.url),'utf8').match(/<script setup lang="ts">([\s\S]*?)<\/script>/)[1]
    const scope=effectScope();t.after(()=>scope.stop())
    const page=scope.run(()=>compile(source,deps,'\nexport {load,items,error,loading,visibleItems,selected};'))
    const old=page.load();session.token='b'
    pending[1].resolve({items:[{id:'b',...base,activity:base}],hasMore:false});await Promise.resolve();await Promise.resolve()
    pending[0].resolve({items:[{id:'a'}],hasMore:false});await old
    assert.equal(page.items.value[0].id,'b')
    session.token='';assert.deepEqual(page.items.value,[]);assert.equal(page.loading.value,false)
    session.token='c';const last=pending.at(-1);unload();last.reject(new Error('late failure'));await Promise.resolve();await Promise.resolve()
    assert.equal(page.error.value,'');assert.deepEqual(page.items.value,[])
  })
}


test('mine uses the organized total, keeps active registration count and ignores results after hiding', async t => {
  const session=reactive({token:'a',epoch:0});let hide;let finish
  let pending=false
  const deps={
    '@dcloudio/uni-app':{onShow(){},onHide(fn){hide=fn},onUnload(){}},
    '@/services/api':{refreshMember:async()=>{},errorMessage:e=>e.message,api:{
      registrations:async()=>({items:[{status:'active'},{status:'cancelled'}]}),
      notifications:async()=>({items:[],unreadCount:pending?0:103}),
      organizedActivities:()=>pending?new Promise(resolve=>{finish=resolve}):Promise.resolve({items:[],total:125,hasMore:true})
    }},
    '@/services/api/environment':{}, '@/services/navigation':{}, '@/stores/session':{useSessionStore:()=>session}
  }
  const source=readFileSync(new URL('../src/pages/mine/index.vue',import.meta.url),'utf8').match(/<script setup lang="ts">([\s\S]*?)<\/script>/)[1]
  const scope=effectScope();t.after(()=>scope.stop())
  const page=scope.run(()=>compile(source,deps,';export {load,count,organizedCount,unreadCount};'))
  await page.load();assert.equal(page.count.value,1);assert.equal(page.organizedCount.value,125);assert.equal(page.unreadCount.value,103)
  pending=true;const loading=page.load();await Promise.resolve();await Promise.resolve();hide();finish({items:[],total:200});await loading
  assert.equal(page.organizedCount.value,null);assert.equal(page.unreadCount.value,0)
  const returning=page.load();await Promise.resolve();await Promise.resolve();finish({items:[],total:125});await returning
  assert.equal(page.organizedCount.value,125);assert.equal(page.unreadCount.value,0)
})
