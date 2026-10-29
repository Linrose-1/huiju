import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { URL } from 'node:url'
import { setImmediate } from 'node:timers/promises'
import ts from 'typescript'
const require = createRequire(import.meta.url)
const { reactive, effectScope } = require('vue')
class ApiError extends Error { constructor(code,message,status=0) { super(message); this.code=code; this.status=status } }
function compile(path,names,deps,globals={}) {
  let source=readFileSync(new URL(path,import.meta.url),'utf8')
  if(path.endsWith('.vue')) source=source.match(/<script setup lang="ts">([\s\S]*?)<\/script>/)[1]
  const code=ts.transpileModule(source+(names?`\nexport {${names}}`:''),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText
  const output={}
  new Function('require','exports',...Object.keys(globals),code)(name=>deps[name]||(name.endsWith('.vue')?{}:require(name)),output,...Object.values(globals))
  return output
}
const helpers=compile('../src/services/connection-path.ts','',{})
const person = index => ({memberId:`member-${index}`,displayName:`学友${index}`,avatarUrl:null,canOpenCard:true})
const anonymous = {memberId:null,displayName:'待完善资料的学友',avatarUrl:null,canOpenCard:false}
function segment(cursor,total=37) {
  const end=Math.min(cursor+20,total)
  return {source:person(0),target:person(total-1),connected:true,totalNodes:total,
    nodes:Array.from({length:end-cursor},(_,i)=>({index:cursor+i,member:person(cursor+i)})),
    edges:Array.from({length:end-Math.max(cursor,1)},(_,i)=>{const index=Math.max(cursor,1)+i;return index<25?{fromIndex:index,toIndex:index-1}:{fromIndex:index-1,toIndex:index}}),
    nextCursor:end<total?end:null}
}
function harness(t,path) {
  const session=reactive({token:'a',epoch:0,member:{id:'member-0',profileComplete:true}}), hooks={}, requests=[], navigations=[]
  const pending=(...args)=>new Promise((resolve,reject)=>requests.push({args,resolve,reject}))
  const deps={
    '@dcloudio/uni-app':Object.fromEntries(['onLoad','onShow','onHide','onUnload','onReachBottom','onPullDownRefresh'].map(name=>[name,fn=>{hooks[name]=fn}])),
    '@/stores/session':{useSessionStore:()=>session},
    '@/services/api':{api:{fellows:pending,connectionPath:pending},ApiError,errorMessage:e=>e.message},
    '@/services/navigation':{requireProfile:async()=>true,navigate:(...args)=>navigations.push(args),returnToMemberCard:id=>navigations.push(['return',id]),routes:{fellows:'/fellows',connection:'/connection',memberCard:'/pages/member/card',invitation:'/invitation'}},
    '@/services/connection-path':helpers,
  }
  const scope=effectScope(); let page
  const names=path==='fellows'?'load,more,retryMore,open,items,inviter,total,hasMore,moreError':'load,more,retryMore,open,nodes,edges,source,target,nextCursor,total,connected,ready,complete,error,moreError,edgeText,returnToCard'
  scope.run(()=>{page=compile(`../src/pages/member/${path}.vue`,names,deps,{uni:{stopPullDownRefresh(){},navigateBack:()=>navigations.push(['back'])},getCurrentPages:()=>[{route:'pages/member/card',options:{id:'member-36'}},{}]})})
  t.after(()=>scope.stop())
  hooks.onLoad?.({id:'member-36'})
  return {page,hooks,requests,session,navigations}
}
test('path segments keep cross-page invitation direction and never accept missing or repeated edges',()=>{
  helpers.validateConnectionSegment(segment(0),0)
  helpers.validateConnectionSegment(segment(20),20,37)
  const missing=segment(20); missing.edges.shift(); assert.throws(()=>helpers.validateConnectionSegment(missing,20,37),/不完整/)
  const duplicate=segment(20); duplicate.edges[1]=duplicate.edges[0]; assert.throws(()=>helpers.validateConnectionSegment(duplicate,20,37),/不完整/)
  const truncated=segment(0); truncated.nextCursor=null; assert.throws(()=>helpers.validateConnectionSegment(truncated,0),/不完整/)
})
test('37-node chain appends full second page, shows progress and actual direction',async t=>{
  const h=harness(t,'connection'); h.hooks.onShow(); await setImmediate()
  assert.deepEqual(h.requests[0].args,['member-36']); h.requests[0].resolve(segment(0)); await setImmediate()
  assert.equal(h.page.nodes.value.length,20); assert.equal(h.page.complete.value,false)
  const more=h.page.more(); h.page.more(); assert.equal(h.requests.length,2); assert.deepEqual(h.requests[1].args,['member-36',20])
  h.requests[1].resolve(segment(20)); await more
  assert.equal(h.page.nodes.value.length,37); assert.equal(h.page.complete.value,true)
  assert.equal(h.page.edgeText(20),'↑ 学友20邀请了学友19')
  assert.equal(h.page.edgeText(25),'↓ 学友24邀请了学友25')
})
test('append failure keeps nodes and retries same cursor; incomplete data never declares complete',async t=>{
  const h=harness(t,'connection'); h.hooks.onShow(); await setImmediate(); h.requests[0].resolve(segment(0)); await setImmediate()
  const more=h.page.more(); h.requests[1].reject(new Error('网络失败')); await more
  assert.equal(h.page.nodes.value.length,20); assert.equal(h.page.moreError.value,'网络失败'); assert.equal(h.page.complete.value,false)
  h.page.retryMore(); assert.equal(h.requests[2].args[1],20)
  const broken=segment(20); broken.edges.shift(); h.requests[2].resolve(broken); await setImmediate()
  assert.equal(h.page.nodes.value.length,20); assert.match(h.page.moreError.value,/不完整/); assert.equal(h.page.complete.value,false)
})
test('no path and relationship exception remain distinct from loading or complete',async t=>{
  const h=harness(t,'connection'); h.hooks.onShow(); await setImmediate()
  h.requests[0].resolve({source:person(0),target:person(36),connected:false,totalNodes:0,nodes:[],edges:[],nextCursor:null}); await setImmediate()
  assert.equal(h.page.ready.value,true); assert.equal(h.page.connected.value,false); assert.equal(h.page.error.value,''); assert.equal(h.page.complete.value,false)
  const load=h.page.load(); await setImmediate(); h.requests[1].reject(new ApiError('RELATIONSHIP_INCOMPLETE','异常',409)); await load
  assert.equal(h.page.ready.value,false); assert.match(h.page.error.value,/关系数据异常/)
})
test('anonymous path nodes stay in order and cannot open cards; fixed target returns to its card',async t=>{
  const h=harness(t,'connection'); h.hooks.onShow(); await setImmediate()
  const data=segment(0,3); data.nodes[1].member=anonymous; h.requests[0].resolve(data); await setImmediate()
  assert.equal(h.page.nodes.value.length,3); h.page.open(anonymous); assert.equal(h.navigations.length,0)
  h.page.open(person(2)); assert.deepEqual(h.navigations[0],['/pages/member/card?id=member-2'])
  h.page.returnToCard(); assert.deepEqual(h.navigations[1],['return','member-36'])
})
for(const path of ['fellows','connection']) {
  test(path+': refresh, hide and identity changes discard late private results',async t=>{
    const h=harness(t,path); h.hooks.onShow(); await setImmediate()
    h.hooks.onHide(); h.requests[0].resolve(path==='fellows'?{inviter:person(1),items:[person(2)],total:1,hasMore:false}:segment(0)); await setImmediate()
    assert.equal((h.page.items||h.page.nodes).value.length,0)
    h.hooks.onShow(); await setImmediate(); h.session.epoch++; await setImmediate()
    h.requests[1].resolve(path==='fellows'?{inviter:person(1),items:[person(2)],total:1,hasMore:false}:segment(0)); await setImmediate()
    assert.equal((h.page.items||h.page.nodes).value.length,0)
    h.hooks.onHide()
  })
}
test('direct fellows preserve distinct anonymous members, deduplicate named members and retry pagination',async t=>{
  const h=harness(t,'fellows'); h.hooks.onShow(); await setImmediate()
  h.requests[0].resolve({inviter:null,items:[person(1),anonymous],total:4,hasMore:true}); await setImmediate()
  const more=h.page.more(); assert.equal(h.requests[1].args[0].offset,2); h.requests[1].reject(new Error('断网')); await more
  assert.equal(h.page.items.value.length,2); h.page.retryMore(); assert.equal(h.requests[2].args[0].offset,2)
  h.requests[2].resolve({inviter:null,items:[person(1),anonymous,person(3)],total:4,hasMore:false}); await setImmediate()
  assert.equal(h.page.items.value.length,4); assert.equal(h.page.items.value.filter(x=>x.memberId===null).length,2)
  h.page.open(anonymous); assert.equal(h.navigations.length,0)
})
