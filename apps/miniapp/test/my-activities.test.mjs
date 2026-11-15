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
  const result={};new Function('require','exports','uni',code)(name=>deps[name]||require(name),result,{stopPullDownRefresh(){}});return result
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
      '@dcloudio/uni-app':{onShow(fn){Promise.resolve().then(fn)},onHide(){},onReachBottom(){},onPullDownRefresh(){},onUnload(fn){unload=fn}},
      '@/services/platform-brand': { usePlatformBrand: () => ({ value: { displayName: '有聚点', visible: true } }) },
    '@/services/api':{api:{organizedActivities:request,registrations:request},errorMessage:e=>e.message},
      '@/services/my-activities':states,
      '@/services/navigation':{},'@/stores/session':{useSessionStore:()=>session},
      '@/components/base/RequestState.vue':{},'@/components/business/MyActivityCard.vue':{}
    }
    function request(){return new Promise((resolve,reject)=>pending.push({resolve,reject}))}
    const source=readFileSync(new URL('../src/pages/'+pagePath+'.vue',import.meta.url),'utf8').match(/<script setup lang="ts">([\s\S]*?)<\/script>/)[1]
    const scope=effectScope();t.after(()=>scope.stop())
    const page=scope.run(()=>compile(source,deps,'\nexport {load,items,error,loading,visibleItems,selected};'))
    await Promise.resolve(); const oldRequest=pending[0]; session.token='b'
    pending[1].resolve({items:[{id:'b',...base,activity:base}],hasMore:false});await Promise.resolve();await Promise.resolve()
    oldRequest.resolve({items:[{id:'a'}],hasMore:false});await Promise.resolve();await Promise.resolve()
    assert.equal(page.items.value[0].id,'b')
    session.token='';assert.deepEqual(page.items.value,[]);assert.equal(page.loading.value,false)
    session.token='c';const last=pending.at(-1);unload();last.reject(new Error('late failure'));await Promise.resolve();await Promise.resolve()
    assert.equal(page.error.value,'');assert.deepEqual(page.items.value,[])
  })
}


test('mine displays the nearest registration in Beijing time, handles empty cards and ignores stale private data', async t => {
  const session=reactive({token:'a',epoch:0,member:{profileComplete:true}});let hide;let finish
  let pending=false

  const activitySummary={registeredCount:75,organizedCount:125,nextRegistration:{id:'a',title:'讨论会',startsAt:'2026-11-14T17:30:00Z',location:'广州'},latestOrganized:{id:'b',title:'茶话会',activeRegistrationCount:0,capacity:null}}
  const presentation=compile(readFileSync(new URL('../src/services/presentation.ts',import.meta.url),'utf8'))
  const deps={
    '@dcloudio/uni-app':{onShow(){},onHide(fn){hide=fn},onUnload(){}},
    '@/services/platform-brand': { usePlatformBrand: () => ({ value: { displayName: '有聚点', visible: true } }) },
    '@/services/api':{refreshMember:async()=>{},errorMessage:e=>e.message,api:{
      myActivitySummary:()=>pending?new Promise(resolve=>{finish=resolve}):Promise.resolve(activitySummary),
      notifications:async()=>({items:[],unreadCount:pending?0:103}),
      platformContent:async()=>({canEdit:false})
    }},
    '@/services/presentation':presentation,'@/services/api/environment':{}, '@/services/wechat':{bootstrapIdentity:async()=>{}}, '@/services/navigation':{}, '@/stores/session':{useSessionStore:()=>session}
  }
  const source=readFileSync(new URL('../src/pages/mine/index.vue',import.meta.url),'utf8').match(/<script setup lang="ts">([\s\S]*?)<\/script>/)[1]
  const scope=effectScope();t.after(()=>scope.stop())
  const page=scope.run(()=>compile(source,deps,';export {load,summary,start,startLabel,unreadCount};'))
  await page.load()
  assert.deepEqual(page.summary.value,activitySummary)
  assert.equal(page.startLabel.value,'11月15日 01:30')
  assert.equal(page.start.value.week,'周日')
  assert.equal(page.unreadCount.value,103)
  pending=true;const loading=page.load();await Promise.resolve();await Promise.resolve();hide();finish(activitySummary);await loading
  assert.equal(page.summary.value,null);assert.equal(page.unreadCount.value,0)
  const returning=page.load();await Promise.resolve();await Promise.resolve()
  finish({...activitySummary,nextRegistration:null,latestOrganized:null});await returning
  assert.equal(page.start.value,null);assert.equal(page.summary.value.latestOrganized,null)
  const old=page.load();await Promise.resolve();await Promise.resolve()
  session.token='new-account';finish(activitySummary);await old
  assert.equal(page.summary.value,null)
})
