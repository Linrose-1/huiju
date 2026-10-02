import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { URL } from 'node:url'
import { setImmediate } from 'node:timers/promises'
import ts from 'typescript'
const require=createRequire(import.meta.url),vue=require('vue')
const source=path=>readFileSync(new URL('../src/'+path,import.meta.url),'utf8')
class ApiError extends Error {constructor(code,status=0){super(code);this.code=code;this.status=status}}
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b});return {promise,resolve,reject}}
const routes={activitySearch:'/pages/assistant/activity-search',detail:'/pages/activity/detail',form:'/pages/registration/form',result:'/pages/registration/detail',activity:'/pages/activity/index',profile:'/pages/member/profile'}
const item=id=>({id,title:id,location:'深圳',startsAt:'2026-10-04',endsAt:'2026-10-05',feeType:'free',feeAmountCents:null,reason:'主题相关',differences:[],coverUrl:null})
const result=(ids=['a','b','c'])=>({status:'results',searchId:'search-a',conditions:['深圳'],question:null,items:ids.map(item),cursor:'next',hasMore:true,remainingToday:9,expiresAt:'2026-10-02T12:30:00Z'})
function evaluate(code,deps,globals={}){const out={};new Function('require','exports',...Object.keys(globals),ts.transpileModule(code,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText)(name=>name in deps?deps[name]:require(name),out,...Object.values(globals));return out}
function harness(t,page='assistant/activity-search',overrides={}){
 const session=vue.reactive({token:'member-a',epoch:0,member:{id:'member-a',profileComplete:false,boundPhone:'13800000000'}}),hooks={},calls=[],observers=[]
 const api={searchActivities:async x=>{calls.push(['search',JSON.parse(JSON.stringify(x))]);return result()},moreActivitySearch:async()=>result(['d','e','f']),searchImpressions:async(...x)=>{calls.push(['impression',...x])},searchView:async(...x)=>{calls.push(['view',...x]);return {sourceToken:'direct-token'}},activity:async()=>({id:'a',registrationState:'open',questions:[]}),roster:async()=>({items:[],hasMore:false}),activityReaders:async()=>({items:[],total:0,hasMore:false}),myRegistration:async()=>{throw new ApiError('NOT_FOUND',404)},register:async(...x)=>{calls.push(['register',...x]);return {}},...overrides.api}
 const uni={stopPullDownRefresh(){},showToast(){},switchTab:x=>calls.push(['tab',x.url]),createIntersectionObserver:()=>{const observer={disconnect(){},relativeToViewport(){return this},observe(selector,fn){observers.push(fn)}};return observer}}
 let gate=true
 const deps={'vue':{...vue,getCurrentInstance:()=>null},'@dcloudio/uni-app':Object.fromEntries(['onLoad','onShow','onHide','onUnload','onShareAppMessage','onReachBottom','onPullDownRefresh'].map(name=>[name,fn=>hooks[name]=fn])),'@/services/api':{api,ApiError,errorMessage:e=>e.message,refreshMember:async()=>session.member},'@/stores/session':{useSessionStore:()=>session},'@/services/api/environment':{API_BASE_URL:'test',mediaUrl:x=>x},'@/services/navigation':{routes,navigate:(...x)=>calls.push(['navigate',...x]),requireLogin:async()=>!!session.token,searchLogin:()=>calls.push(['login']),requireProfile:async target=>{calls.push(['gate',target]);return gate},loginPage:target=>calls.push(['login',target])},'@/services/circle':{newRequestId:()=>`request-${Math.random()}`},'@/services/reading':{createReadingVisit:()=>({record:async()=>{}})},'@/services/presentation':{canEdit:()=>true}}
 const exports=page.includes('activity-search')?'input,messages,result,items,busy,error,moreError,remaining,search,more,open,profile,ready':page==='activity/detail'?'id,searchId,recommendationToken,load,register,activity':'id,recommendationToken,load,submit,phone,allowed,returnTarget'
 const scope=vue.effectScope(),code=source('pages/'+page+'.vue').match(/<script setup lang="ts">([\s\S]*?)<\/script>/)[1]
 const output=scope.run(()=>evaluate(code+'\nexport {'+exports+'}',deps,{uni}));t.after(()=>scope.stop())
 return {page:output,session,hooks,calls,observers,api,setGate:value=>{gate=value},async show(options={id:'a'}){hooks.onLoad?.(options);hooks.onShow?.();await setImmediate()}}
}
test('incomplete profiles search, three results and visible cards alone produce impressions',async t=>{
 const h=harness(t);await h.show();h.page.input.value='深圳免费';await h.page.search();await setImmediate()
 assert.equal(h.page.items.value.length,3);assert.equal(h.calls.filter(x=>x[0]==='search').length,1);assert.equal(h.calls.filter(x=>x[0]==='impression').length,0)
 h.observers[0]({intersectionRatio:0});await setImmediate();assert.equal(h.calls.filter(x=>x[0]==='impression').length,0)
 h.observers[0]({intersectionRatio:1});await setImmediate();assert.deepEqual(h.calls.find(x=>x[0]==='impression'),['impression','search-a',['a']])
})
test('missing login never sends a search and opening the page does not automatically consume quota',async t=>{
 const h=harness(t);h.session.token='';await h.show();h.page.input.value='深圳';await h.page.search();assert.equal(h.page.ready.value,false);assert.equal(h.calls.length,0)
})
test('clarification and empty results are displayed without automatic relaxation or retry',async t=>{
 const h=harness(t);await h.show();let calls=0;h.api.searchActivities=async()=>{calls++;return {...result([]),status:'clarify',searchId:null,question:'你希望周六还是周日？',hasMore:false,cursor:null}};h.page.input.value='周六但仅周日';await h.page.search();assert.equal(h.page.result.value.status,'clarify');assert.equal(h.page.result.value.question,'你希望周六还是周日？');assert.equal(calls,1)
 h.api.searchActivities=async()=>{calls++;return {...result([]),hasMore:false,cursor:null}};h.page.input.value='周六';await h.page.search();assert.equal(h.page.items.value.length,0);assert.equal(h.page.result.value.status,'results');assert.equal(calls,2)
})
test('pagination appends deduplicated results without AI; failures retain prior results',async t=>{
 const h=harness(t);await h.show();h.page.input.value='找活动';await h.page.search()
 h.api.moreActivitySearch=async()=>{throw new Error('more failed')};await h.page.more();assert.equal(h.page.items.value.length,3);assert.equal(h.page.moreError.value,'more failed')
 h.api.moreActivitySearch=async()=>({...result(['c','d','e']),hasMore:false,cursor:null});await h.page.more();assert.deepEqual(h.page.items.value.map(x=>x.id),['a','b','c','d','e']);assert.equal(h.calls.filter(x=>x[0]==='search').length,1)
})
test('network uncertainty reuses request identifier, definitive failure allows a fresh attempt',async t=>{
 const h=harness(t),attempts=[];await h.show();h.page.input.value='找活动'
 h.api.searchActivities=async input=>{attempts.push(input.requestId);throw new ApiError(attempts.length===2?'SEARCH_TIMEOUT':'NETWORK_ERROR')}
 await h.page.search();await h.page.search();await h.page.search();assert.equal(attempts[0],attempts[1]);assert.notEqual(attempts[1],attempts[2]);assert.equal(h.page.input.value,'找活动')
})
test('expired response-loss retry starts a fresh request only after another explicit retry',async t=>{
 const h=harness(t),ids=[];await h.show();h.page.input.value='深圳'
 h.api.searchActivities=async input=>{ids.push(input.requestId);if(ids.length===1)throw new ApiError('NETWORK_ERROR');if(ids.length===2)throw new ApiError('SEARCH_EXPIRED',410);return result()}
 await h.page.search();await h.page.search();assert.equal(ids.length,2);assert.equal(ids[0],ids[1]);assert.equal(h.page.input.value,'深圳')
 await h.page.search();assert.notEqual(ids[1],ids[2]);assert.equal(h.page.items.value.length,3)
})
test('failed new search reconnects exposure observation for retained old results',async t=>{
 const h=harness(t);await h.show();h.page.input.value='深圳';await h.page.search();await setImmediate()
 const oldObserver=h.observers[0];h.page.input.value='免费';h.api.searchActivities=async()=>{throw new ApiError('RECOMMENDATION_AI_FAILED')};await h.page.search();await setImmediate()
 oldObserver({intersectionRatio:1});await setImmediate();assert.equal(h.calls.filter(x=>x[0]==='impression').length,0)
 h.observers.at(-3)({intersectionRatio:1});await setImmediate();assert.deepEqual(h.calls.find(x=>x[0]==='impression'),['impression','search-a',['a']]);assert.equal(h.page.items.value.length,3)
})
test('new conditions replace results and keep only explicit messages',async t=>{
 const h=harness(t);await h.show();h.page.input.value='深圳';await h.page.search();h.page.input.value='只看免费';h.api.searchActivities=async input=>{assert.deepEqual(input.messages,['深圳','只看免费']);return result(['free'])};await h.page.search();assert.deepEqual(h.page.items.value.map(x=>x.id),['free'])
})
test('profile and detail return preserve conversation; identity change and unload clear it',async t=>{
 const h=harness(t);await h.show();h.page.input.value='深圳';await h.page.search();h.page.profile();h.hooks.onHide();h.session.member.profileComplete=true;h.hooks.onShow();await setImmediate();assert.deepEqual(h.page.messages.value,['深圳']);assert.equal(h.calls.filter(x=>x[0]==='search').length,1)
 h.session.token='member-b';assert.equal(h.page.items.value.length,0);assert.equal(h.page.messages.value.length,0);h.page.input.value='new';h.hooks.onUnload();assert.equal(h.page.input.value,'')
})
test('late results after hiding or identity switch cannot restore private content',async t=>{
 for(const action of ['hide','identity']){const h=harness(t),pending=deferred();await h.show();h.page.input.value='深圳';h.api.searchActivities=()=>pending.promise;const request=h.page.search();if(action==='hide')h.hooks.onHide();else h.session.epoch++;pending.resolve(result());await request;assert.equal(h.page.items.value.length,0)}
})
test('hidden in-flight search returns unlocked with manual same-request recovery',async t=>{
 const h=harness(t),pending=deferred(),ids=[];await h.show();h.page.input.value='深圳';h.api.searchActivities=async input=>{ids.push(input.requestId);if(ids.length===1)return pending.promise;return result()}
 const searching=h.page.search();h.hooks.onHide();pending.resolve(result());await searching;h.hooks.onShow();await setImmediate();assert.equal(h.page.busy.value,false);assert.match(h.page.error.value,/重试/);assert.equal(ids.length,1);await h.page.search();assert.equal(ids[0],ids[1]);assert.equal(h.page.items.value.length,3)
})
test('twelve messages retain conditions and prevent sending a silently truncated conversation',async t=>{
 const h=harness(t);await h.show();h.page.messages.value=Array.from({length:12},(_,i)=>'条件'+i);h.page.input.value='补充';await h.page.search();assert.equal(h.calls.length,0);assert.equal(h.page.messages.value.length,12);assert.match(h.page.error.value,/12/)
})
test('conversation input above 8000 characters offers an actionable local recovery without requesting',async t=>{
 const h=harness(t);await h.show();h.page.messages.value=Array.from({length:4},()=> '条'.repeat(1999));h.page.input.value='本次补充六个字';await h.page.search()
 assert.equal(h.calls.length,0);assert.match(h.page.error.value,/8000/);assert.match(h.page.error.value,/缩短本次输入/);assert.match(h.page.error.value,/返回助手/);assert.equal(h.page.messages.value.length,4);assert.equal(h.page.input.value,'本次补充六个字')
 h.page.input.value='免费';await h.page.search();assert.equal(h.calls.filter(x=>x[0]==='search').length,1)
})
test('card click records its impression before navigating with searchId',async t=>{
 const h=harness(t);await h.show();h.page.input.value='深圳';await h.page.search();await h.page.open(item('b'));assert.deepEqual(h.calls.slice(-2),[['impression','search-a',['b']],['navigate','/pages/activity/detail?id=b&searchId=search-a']])
})
test('recommended detail confirms view only after loading and forwards source through profile gate; share is clean',async t=>{
 const h=harness(t,'activity/detail');await h.show({id:'a',searchId:'search-a'});assert.deepEqual(h.calls.find(x=>x[0]==='view'),['view','search-a','a']);h.setGate(false);await h.page.register();assert.deepEqual(h.calls.at(-1),['gate','/pages/registration/form?id=a&recommendationToken=direct-token']);assert.ok(!h.hooks.onShareAppMessage().path.includes('searchId'));assert.ok(!h.hooks.onShareAppMessage().path.includes('direct-token'))
})
test('ordinary detail never confirms a recommendation view',async t=>{const h=harness(t,'activity/detail');await h.show();assert.equal(h.calls.some(x=>x[0]==='view'),false);await h.page.register();assert.deepEqual(h.calls.at(-1),['navigate','/pages/registration/form?id=a'])})
test('failed attribution never blocks the real activity or ordinary registration path',async t=>{const h=harness(t,'activity/detail',{api:{searchView:async()=>{throw new Error('expired')}}});await h.show({id:'a',searchId:'old'});assert.equal(h.page.activity.value.id,'a');await h.page.register();assert.deepEqual(h.calls.at(-1),['navigate','/pages/registration/form?id=a'])})
test('registration carries token through profile return and submission, but edit ignores token',async t=>{
 const h=harness(t,'registration/form');h.setGate(false);await h.show({id:'a',recommendationToken:'direct-token'});assert.equal(h.page.returnTarget(),'/pages/registration/form?id=a&recommendationToken=direct-token');h.setGate(true);await h.page.load();await h.page.submit();assert.equal(h.calls.find(x=>x[0]==='register')[2].recommendationToken,'direct-token')
 h.hooks.onLoad({id:'a',edit:'1',recommendationToken:'direct-token'});assert.equal(h.page.recommendationToken.value,'')
})
test('login-only returns incomplete member without mutating profile and ordinary mode stays gated',async()=>{
 const calls=[],session={token:'',member:{profileComplete:false},pendingInvite:''};let onLoad
 const deps={'@dcloudio/uni-app':{onLoad:f=>{onLoad=f}},'@/stores/session':{useSessionStore:()=>session},'@/services/api':{api:{profile:async()=>calls.push('profile')},errorMessage:e=>e.message,refreshMember:async()=>session.member},'@/services/wechat':{loginWithWechat:async()=>{session.token='t'}},'@/services/api/environment':{},'@/services/navigation':{routes:{...routes,login:'/pages/login/index'},finishProfile:x=>calls.push(x)}}
 const page=evaluate(source('pages/login/index.vue').match(/<script setup lang="ts">([\s\S]*?)<\/script>/)[1]+'\nexport {submit,loginOnly};',deps)
 await onLoad({mode:'login',returnTo:routes.activitySearch});await page.submit();assert.deepEqual(calls,[routes.activitySearch]);assert.equal(page.loginOnly.value,true)
 await onLoad({mode:'login',returnTo:routes.form+'?id=a'});assert.equal(page.loginOnly.value,false)
})
test('navigation does not reuse same activity with a different source context',()=>{
 const calls=[],uni=Object.fromEntries(['navigateBack','redirectTo','navigateTo','switchTab'].map(key=>[key,options=>{calls.push(key);options?.complete?.()}]))
 const nav=evaluate(source('services/navigation.ts'),{'@/services/api':{},'@/services/wechat':{},'@/stores/session':{}},{uni,getCurrentPages:()=>[{route:'pages/registration/form',options:{id:'a',recommendationToken:'old'}},{route:'pages/login/index'}]})
 nav.finishProfile('/pages/registration/form?id=a&recommendationToken=new');assert.deepEqual(calls,['redirectTo'])
})
