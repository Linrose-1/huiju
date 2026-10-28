import assert from 'node:assert/strict'
import { URL } from 'node:url'
import { test } from 'node:test'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { setImmediate } from 'node:timers/promises'
import ts from 'typescript'
const require = createRequire(import.meta.url)
function compile(path, exports, deps, globals = {}) {
  const file = readFileSync(new URL(path, import.meta.url), 'utf8')
  const source = path.endsWith('.vue') ? file.match(/<script setup lang="ts">([\s\S]*?)<\/script>/)[1] : file
  const code = ts.transpileModule(source + (exports ? '\nexport { ' + exports + ' };' : ''), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
  const out = {}
  new Function('require', 'exports', ...Object.keys(globals), code)(name => deps[name] || (name.endsWith('.vue') ? {} : require(name)), out, ...Object.values(globals))
  return out
}
const helpers = compile('../src/services/advertising.ts', '', { './api': { errorMessage: e => e.message } })
const deferred = () => { let resolve, reject; const promise = new Promise((a,b) => {resolve=a;reject=b}); return {promise,resolve,reject} }
const ad = i => ({ id: String(i), title: '广告'+i, introductionId: 'intro'+i, imageUrl: '/image/'+i })
test('carousel continues beyond the first page, deduplicates and only mounts adjacent images', async () => {
  const calls = []
  const list = helpers.useAdvertising(async offset => { calls.push(offset); return offset === 0 ? {items:Array.from({length:20},(_,i)=>ad(i)),total:22,hasMore:true} : {items:[ad(19),ad(20),ad(21)],total:22,hasMore:false} })
  await list.show(); assert.equal(list.items.value.length,20)
  list.change(18); await setImmediate()
  assert.deepEqual(calls,[0,20]); assert.equal(list.items.value.length,22); assert.equal(list.total.value,22)
  assert.deepEqual(list.items.value.map((_,i)=>i).filter(list.imageVisible),[17,18,19])
  list.change(21); assert.deepEqual([0,20,21].map(list.imageVisible),[true,true,true])
  assert.equal(list.hasMore.value,false); assert.equal(list.autoplay.value,true)
})
test('append failure preserves the image and stops autoplay at the tail until explicit retry', async () => {
  let failures = true
  const list = helpers.useAdvertising(async offset => {
    if (offset && failures) throw new Error('网络失败')
    return offset ? {items:[ad(4)],total:5,hasMore:false} : {items:[0,1,2,3].map(ad),total:5,hasMore:true}
  })
  await list.show(); list.change(3); await setImmediate()
  assert.equal(list.items.value.length,4); assert.equal(list.index.value,3); assert.equal(list.error.value,'网络失败'); assert.equal(list.autoplay.value,false)
  failures=false; await list.retry(); assert.equal(list.items.value.length,5); assert.equal(list.error.value,''); assert.equal(list.autoplay.value,true)
})
test('hide rejects late responses and show refreshes revoked ads instead of retaining stale metadata', async () => {
  const requests=[]; const list=helpers.useAdvertising(()=>{const d=deferred();requests.push(d);return d.promise})
  const first=list.show(); list.hide(); requests[0].resolve({items:[ad(0)],total:1,hasMore:false}); await first
  assert.equal(list.items.value.length,0); assert.equal(list.autoplay.value,false)
  const second=list.show(); requests[1].resolve({items:[ad(1)],total:1,hasMore:false}); await second
  assert.equal(list.items.value[0].id,'1'); assert.equal(list.autoplay.value,false)
  const third=list.show(); requests[2].resolve({items:[],total:0,hasMore:false}); await third
  assert.equal(list.items.value.length,0)
})
test('append requests are single flight and invalid change callbacks cannot select outside loaded data', async () => {
  const append=deferred(); let count=0
  const list=helpers.useAdvertising(offset=>{count++;return offset?append.promise:Promise.resolve({items:[0,1,2,3].map(ad),total:6,hasMore:true})})
  await list.show(); list.change(2); list.change(3); list.change(-1); list.change(8)
  assert.equal(count,2); assert.equal(list.index.value,3); assert.equal(list.autoplay.value,false)
  append.resolve({items:[ad(4),ad(5)],total:6,hasMore:false}); await setImmediate(); assert.equal(list.autoplay.value,true)
})
class ApiError extends Error { constructor(status) {super('error');this.status=status} }
function pageHarness() {
  const hooks={}, requests=[], clipboard=[], calls=[], modals=[], captures=[]
  const page=compile('../src/pages/advertising/introduction.vue','content,loading,error,unavailable,acting,load,copy,call',{
    '@dcloudio/uni-app':Object.fromEntries(['onLoad','onShow','onHide','onUnload','onPullDownRefresh'].map(k=>[k,fn=>hooks[k]=fn])),
    '@/services/api': { api:{advertisingIntroduction:()=>{const d=deferred();requests.push(d);return d.promise}},ApiError,errorMessage:e=>e.message },
    '@/services/api/environment':{}, '@/services/navigation':{routes:{activity:'/pages/activity/index'}}, '@/stores/session':{useSessionStore:()=>({captureInvite:v=>captures.push(v)})}
  },{uni:{stopPullDownRefresh(){},setClipboardData:async v=>clipboard.push(v),showModal:()=>{const d=deferred();modals.push(d);return d.promise},makePhoneCall:async v=>calls.push(v),showToast(){}},getCurrentPages:()=>[]})
  return {page,hooks,requests,clipboard,calls,modals,captures}
}
const intro={id:'i',name:'项目',companyName:'公司',contactName:'联系人',phone:'13800000000',wechatId:'hello',blocks:[]}
test('introduction is public and handles unavailable content without retaining contact details', async () => {
  const h=pageHarness();h.hooks.onLoad({id:'i',inviteCode:'inv'});h.hooks.onShow();h.requests[0].resolve(intro);await setImmediate()
  assert.deepEqual(h.captures,['inv']);assert.equal(h.page.content.value.name,'项目')
  const next=h.page.load();h.requests[1].reject(new ApiError(404));await next
  assert.equal(h.page.content.value,null);assert.equal(h.page.unavailable.value,true)
})
test('phone requires confirmation, duplicate taps are ignored and leaving cancels a pending confirmation', async () => {
  const h=pageHarness();h.hooks.onLoad({id:'i'});h.hooks.onShow();h.requests[0].resolve(intro);await setImmediate()
  const call=h.page.call(); await h.page.call();assert.equal(h.modals.length,1)
  h.hooks.onHide();h.modals[0].resolve({confirm:true});await call;assert.equal(h.calls.length,0)
  h.hooks.onShow();h.requests[1].resolve(intro);await setImmediate()
  const retry=h.page.call();h.modals[1].resolve({confirm:true});await retry;assert.deepEqual(h.calls,[{phoneNumber:'13800000000'}])
})
test('copy only includes the public introduction fields and delayed reload cannot repopulate a hidden page', async () => {
  const h=pageHarness();h.hooks.onLoad({id:'i'});h.hooks.onShow();h.requests[0].resolve({...intro,privatePhone:'secret'});await setImmediate()
  await h.page.copy(true);assert.deepEqual(h.clipboard,[{data:'hello'}])
  await h.page.copy();assert.equal(h.clipboard[1].data.includes('secret'),false)
  const loading=h.page.load();h.hooks.onHide();h.requests[1].resolve(intro);await loading;assert.equal(h.page.content.value,null)
})
