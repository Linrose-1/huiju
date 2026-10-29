import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { URL } from 'node:url'
import { setImmediate } from 'node:timers'
import ts from 'typescript'
const require = createRequire(import.meta.url)
const vue = require('vue')
class ApiError extends Error { constructor(code, message, status = 0) { super(message); this.code = code; this.status = status } }
function deferred() { let resolve, reject; const promise = new Promise((a,b) => { resolve=a; reject=b }); return {promise,resolve,reject} }
function harness(name, apiOverrides = {}) {
  const hooks = {}, submissions = [], navigations = [], clipboard = []
  const session = vue.reactive({token:'a',epoch:0,member:{id:'member-a',boundPhone:'13800000000'}})
  const detail = {feeType:'paid',lifecycle:'published',moderation:'normal',registrationState:'open',questions:[],title:'活动'}
  const api = {
    activity:async()=>detail, managedActivity:async()=>detail,
    myRegistration:async()=>{ throw new ApiError('REGISTRATION_NOT_FOUND','未报名',404) },
    verifySpecialInvite:async()=>({valid:true}), register:async(id,payload)=>{submissions.push(payload)},
    specialInviteCodes:async()=>({items:[],total:0,hasMore:false}),
    ...apiOverrides,
  }
  const exports = {}
  const source = readFileSync(new URL(`../src/pages/${name}.vue`,import.meta.url),'utf8').match(/<script setup lang="ts">([\s\S]*?)<\/script>/)[1]
  const names = name==='registration/form' ? 'load,submit,id,phone,answers,inviteCode,verifiedCode,inviteError,submitError,verifyInvite,removeInvite,verifying' : 'load,loadList,id,phone,filter,items,hasMore,moreError,selectFilter,retryMore,create,created,actionError,copy'
  const dependencies = {
    '@dcloudio/uni-app':Object.fromEntries(['onLoad','onShow','onHide','onUnload','onReachBottom','onPullDownRefresh'].map(k=>[k,f=>{hooks[k]=f}])),
    '@/services/api':{api,ApiError,errorMessage:e=>e.message},
    '@/services/navigation':{routes:{form:'/form',result:'/result',specialInvites:'/invites'},requireProfile:async()=>true,loginPage(){},navigate:(...args)=>navigations.push(args)},
    '@/stores/session':{useSessionStore:()=>session},
    '@/services/presentation':{canEdit:()=>true,dateTime:x=>x},
  }
  const code=ts.transpileModule(source+`\nexport {${names}}`,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText
  new Function('require','exports','uni',code)(k=>k in dependencies?dependencies[k]:require(k),exports,{stopPullDownRefresh(){},setClipboardData:x=>clipboard.push(x.data)})
  exports.id.value='activity-a'
  return {page:exports,hooks,session,submissions,navigations,clipboard,api}
}
test('unverified code blocks ordinary fallback; verified code is normalized and submitted',async()=>{
  const h=harness('registration/form'); await h.page.load()
  h.page.inviteCode.value='abcdefgh2345'; await h.page.submit()
  assert.equal(h.submissions.length,0)
  await h.page.verifyInvite(); await h.page.submit()
  assert.equal(h.submissions[0].specialInviteCode,'ABCDEFGH2345')
})
test('removing a code invalidates an outstanding verification and permits ordinary registration',async()=>{
  const pending=deferred(); const h=harness('registration/form',{verifySpecialInvite:()=>pending.promise}); await h.page.load()
  h.page.inviteCode.value='ABCDEFGH2345'; const work=h.page.verifyInvite(); h.page.removeInvite(); pending.resolve({valid:true}); await work
  assert.equal(h.page.verifiedCode.value,''); await h.page.submit(); assert.equal(h.submissions[0].specialInviteCode,undefined)
})
test('failed invite submission preserves phone, answers and entered code, requiring revalidation',async()=>{
  const h=harness('registration/form',{register:async()=>{throw new ApiError('SPECIAL_INVITE_USED','特邀码已使用')}}); await h.page.load()
  h.page.phone.value='13900000000'; h.page.answers.value={q:'保留内容'}; h.page.inviteCode.value='ABCDEFGH2345'; await h.page.verifyInvite(); await h.page.submit()
  assert.equal(h.page.phone.value,'13900000000'); assert.equal(h.page.answers.value.q,'保留内容'); assert.equal(h.page.inviteCode.value,'ABCDEFGH2345'); assert.equal(h.page.verifiedCode.value,'')
  assert.equal(h.navigations.length,0)
})
test('identity change and page hide discard late verification',async()=>{
  for(const hide of [false,true]) {
    const pending=deferred(); const h=harness('registration/form',{verifySpecialInvite:()=>pending.promise}); await h.page.load()
    h.page.inviteCode.value='ABCDEFGH2345'; const work=h.page.verifyInvite()
    if(hide) h.hooks.onHide(); else h.session.epoch++
    pending.resolve({valid:true}); await work; assert.equal(h.page.verifiedCode.value,'')
  }
})
test('management list rejects late old-filter results and append failure preserves rows',async()=>{
  const old=deferred(); const h=harness('activity/special-invites'); h.hooks.onShow(); await new Promise(r=>setImmediate(r))
  h.api.specialInviteCodes=()=>old.promise; const work=h.page.loadList()
  h.api.specialInviteCodes=async()=>({items:[{id:'used-a'}],total:2,hasMore:true}); h.page.selectFilter('used'); await new Promise(r=>setImmediate(r))
  old.resolve({items:[{id:'old'}],total:1,hasMore:false}); await work
  assert.deepEqual(h.page.items.value.map(x=>x.id),['used-a'])
  h.api.specialInviteCodes=async()=>{throw new Error('网络失败')}; await h.page.loadList(true)
  assert.deepEqual(h.page.items.value.map(x=>x.id),['used-a']); assert.equal(h.page.moreError.value,'网络失败')
})
test('failed issuance preserves phone and copy is unavailable for consumed codes',async()=>{
  const h=harness('activity/special-invites',{createSpecialInvite:async()=>{throw new Error('网络失败')}}); h.hooks.onShow(); await new Promise(r=>setImmediate(r))
  h.page.phone.value='13800000000'; await h.page.create(); assert.equal(h.page.phone.value,'13800000000'); assert.equal(h.page.actionError.value,'网络失败')
  h.page.copy({status:'used',code:'ABCDEFGH2345'}); assert.equal(h.clipboard.length,0)
  h.page.copy({status:'unused',code:'ABCDEFGH2345'}); assert.match(h.clipboard[0],/ABCDEFGH2345/)
})
