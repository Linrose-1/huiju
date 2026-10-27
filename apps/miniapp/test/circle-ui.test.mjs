import assert from 'node:assert/strict'
import { setImmediate } from 'node:timers'
import { test } from 'node:test'
import { readFileSync, existsSync } from 'node:fs'
import { URL } from 'node:url'
import { createRequire } from 'node:module'
import ts from 'typescript'
import { loadPageShare } from './page-share-harness.mjs'
import { reactive } from 'vue'
const require = createRequire(import.meta.url)
const source = path => readFileSync(new URL('../src/'+path, import.meta.url),'utf8')
function evaluate(text,deps,globals={}) {
  const code=ts.transpileModule(text,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,exports={}
  new Function('require','exports',...Object.keys(globals),code)(name=>name in deps?deps[name]:require(name),exports,...Object.values(globals))
  return exports
}
function deferred(){let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b});return {promise,resolve,reject}}
const tick=()=>new Promise(resolve=>setImmediate(resolve))
const routes={circle:'/pages/circle/index',circleDetail:'/pages/circle/detail',circleEditor:'/pages/circle/editor',circleMine:'/pages/circle/mine',circleIntents:'/pages/circle/intents'}
const post=()=>({id:'post-a',category:'park',subtype:'rent',title:'园区资源',body:'说明',state:'open',isOwner:false,images:[],author:{id:'author-a',displayName:'作者'},createdAt:'2026-09-30T00:00:00Z'})
function harness(page='detail',overrides={}) {
  const session=reactive({token:'token-a',epoch:0,member:{profileComplete:true,boundPhone:'13800000000',inviteCode:'sharer-code'}}),hooks={},calls=[],sent=[],saved=[],uploaded=[]
  session.captureInvite=()=>{}
  const uni={hideShareMenu(){},showShareMenu(){},stopPullDownRefresh(){},showToast:options=>calls.push(['toast',options.title]),switchTab:options=>calls.push(['tab',options.url]),...overrides.uni}
  const api={circlePost:async()=>post(),circlePosts:async()=>({items:[],hasMore:false}),circleIntents:async()=>({items:[],hasMore:false}),endCirclePost:async id=>calls.push(['end',id]),submitCircleIntent:async(...args)=>{sent.push(args)},saveCirclePost:async(...args)=>{saved.push(args);return {...post(),isOwner:true}},uploadCircleImage:async(...args)=>{uploaded.push(args);return {id:'image-a'}},...overrides.api}
  const navigation={routes,navigate:(...args)=>calls.push(['navigate',...args]),loginPage:url=>calls.push(['login',url]),requireProfile:overrides.requireProfile||async function(){return session.member.profileComplete}}
  const deps={'@/stores/session':{useSessionStore:()=>session},'@/services/api':{api,errorMessage:e=>e.message,refreshMember:async()=>session.member},'@/services/wechat':{bootstrapIdentity:overrides.bootstrapIdentity||(async()=>{})},'@/services/api/environment':{mediaUrl:x=>x},'@/services/navigation':navigation,'@/services/circle-images':{chooseCircleImages:overrides.chooseCircleImages||(async()=>overrides.pictures||[])},'@dcloudio/uni-app':Object.fromEntries(['onLoad','onShow','onHide','onUnload','onShareAppMessage','onShareTimeline','onReachBottom','onPullDownRefresh'].map(name=>[name,fn=>hooks[name]=fn]))}
  deps['@/services/wechat/page-share']=loadPageShare(deps,uni)
  deps['@/services/circle']=evaluate(source('services/circle.ts'),deps,{uni})
  const text=source('pages/circle/'+page+'.vue').match(/<script setup lang="ts">([\s\S]*?)<\/script>/)[1]
  const expose={detail:'id,post,sheet,phone,sending,error,actionError,confirmIntent,submit,load,closeSheet',editor:'id,post,title,body,category,storeName,images,pendingWrite,readyToken,busy,picking,error,actionError,save,pick,load',mine:'items,loading,preparing,error,actionError,end,load',intents:'id,post,items,loading,preparing,error,thumbnail,thumbnailError,load'}[page]
  const result=evaluate(text+'\nexport {'+expose+'};\nexport function activate(){visible=true;return load()}',deps,{uni})
  hooks.onLoad?.({id:['detail','intents'].includes(page)?'post-a':''})
  return {page:result,session,hooks,calls,sent,saved,uploaded,api,circle:deps['@/services/circle']}
}
test('confirmation reads contact but never submits until explicit confirmation',async()=>{
  const h=harness();await h.page.activate();await h.page.confirmIntent()
  assert.equal(h.page.sheet.value,true);assert.equal(h.page.phone.value,'13800000000');assert.equal(h.sent.length,0)
  h.page.phone.value='13900000000';await h.page.submit();assert.equal(h.sent.length,1);assert.equal(h.sent[0][1],'13900000000');assert.equal(h.session.member.boundPhone,'13800000000');assert.equal(h.page.sheet.value,false)
})
test('profile completion returns to original post and reopens confirmation without automatic submission',async()=>{
  let target='';const h=harness('detail',{requireProfile:async url=>{target=url;h.hooks.onHide();return false}})
  h.session.member.profileComplete=false;await h.page.activate();await h.page.confirmIntent()
  assert.equal(target,'/pages/circle/detail?id=post-a&intent=1');assert.equal(h.sent.length,0)
  h.session.member.profileComplete=true;await h.page.activate();assert.equal(h.page.sheet.value,true);assert.equal(h.sent.length,0)
})
test('author and ended posts cannot open intent sheet or submit',async()=>{
  for(const flags of [{isOwner:true},{state:'ended'},{state:'removed'}]){
    const h=harness('detail',{api:{circlePost:async()=>({...post(),...flags})}});await h.page.activate();await h.page.confirmIntent();await h.page.submit();assert.equal(h.page.sheet.value,false);assert.equal(h.sent.length,0)
  }
})
test('invalid phone stays in confirmation and creates no intent',async()=>{
  const h=harness();await h.page.activate();await h.page.confirmIntent();h.page.phone.value='bad';await h.page.submit();assert.match(h.page.actionError.value,/联系电话/);assert.equal(h.sent.length,0)
})
test('double click and lost intent response reuse one request identifier',async()=>{
  const wait=deferred(),requests=[];const h=harness('detail',{api:{submitCircleIntent:async(...args)=>{requests.push(args);if(requests.length===1)return wait.promise}}})
  await h.page.activate();await h.page.confirmIntent();const first=h.page.submit();await tick();await h.page.submit();assert.equal(requests.length,1)
  wait.reject(new Error('响应超时'));await first;await h.page.submit();assert.equal(requests.length,2);assert.equal(requests[0][2],requests[1][2])
})
test('logout clears confirmation, contact and old response cannot restore content',async()=>{
  const wait=deferred(),h=harness('detail',{api:{circlePost:()=>wait.promise}});const reading=h.page.activate();h.session.token='';h.session.epoch++;wait.resolve(post());await reading;await tick();assert.equal(h.page.phone.value,'');assert.equal(h.page.sheet.value,false)
  const other=harness();await other.page.activate();await other.page.confirmIntent();other.session.token='token-b';assert.equal(other.page.sheet.value,false);assert.equal(other.page.phone.value,'')
})
test('share source is the actual sharer and return link omits submission flag',async()=>{
  const h=harness();h.hooks.onShow();await tick();await h.page.activate();assert.equal(h.hooks.onShareAppMessage().path,'/pages/circle/detail?id=post-a&inviteCode=sharer-code')
})
test('editor requires title/body and store name, supports zero images',async()=>{
  const h=harness('editor');await h.page.activate();await h.page.save();assert.equal(h.saved.length,0)
  h.page.title.value='标题';h.page.body.value='正文';h.page.category.value='store';await h.page.save();assert.equal(h.saved.length,0)
  h.page.storeName.value='园区门店';await h.page.save();assert.equal(h.saved.length,1);assert.deepEqual(h.saved[0][0].imageIds,[]);assert.equal(h.saved[0][0].storeName,'园区门店');assert.equal(h.saved[0][0].validUntil,null)
})
test('upload retries preserve already uploaded pictures and never create post on failed upload',async()=>{
  let attempt=0;const h=harness('editor',{api:{uploadCircleImage:async()=>{attempt++;if(attempt===2)throw new Error('图片失败');return {id:'image-'+attempt}}}})
  await h.page.activate();h.page.title.value='标题';h.page.body.value='正文';h.page.images.value=[{key:'a',path:'a',base64:'a',mimeType:'image/png'},{key:'b',path:'b',base64:'b',mimeType:'image/png'}]
  await h.page.save();assert.equal(h.saved.length,0);assert.equal(h.page.images.value[0].id,'image-1');assert.equal(h.page.images.value[1].failed,true)
  await h.page.save();assert.equal(attempt,3);assert.deepEqual(h.saved[0][0].imageIds,['image-1','image-3'])
})
test('editor retry uses exact content and request ID after response loss',async()=>{
  const writes=[],h=harness('editor',{api:{saveCirclePost:async input=>{writes.push(JSON.parse(JSON.stringify(input)));if(writes.length===1)throw new Error('响应丢失');return {...post(),isOwner:true}}}})
  await h.page.activate();h.page.title.value='原标题';h.page.body.value='原内容';await h.page.save();assert.ok(h.page.pendingWrite.value);h.page.title.value='不能改变重试快照';await h.page.save();assert.deepEqual(writes[1],writes[0])
})
test('account change during save discards old form and old result',async()=>{
  const wait=deferred(),h=harness('editor',{api:{uploadCircleImage:()=>wait.promise}});await h.page.activate();h.page.title.value='标题';h.page.body.value='正文';h.page.images.value=[{key:'a',path:'a',base64:'a',mimeType:'image/png'}]
  const saving=h.page.save();await tick();h.session.token='token-b';wait.resolve({id:'old-image'});await saving;assert.equal(h.saved.length,0);assert.equal(h.page.title.value,'');assert.equal(h.page.images.value.length,0)
})
test('edited removed post retains removed state and returns to owner list',async()=>{
  const h=harness('editor',{api:{circlePost:async()=>({...post(),state:'removed',isOwner:true}),saveCirclePost:async()=>({...post(),state:'removed',isOwner:true})}});h.page.id.value='post-a';await h.page.activate();await h.page.save();assert.ok(h.calls.some(x=>x[0]==='navigate'&&x[1]===routes.circleMine))
})
test('ended owner post stays read only',async()=>{
  const h=harness('editor',{api:{circlePost:async()=>({...post(),state:'ended',isOwner:true})}});h.page.id.value='post-a';await h.page.activate();await h.page.save();assert.equal(h.saved.length,0)
})
function listHarness(fetchPage){const session=reactive({token:'a',epoch:0});const circle=evaluate(source('services/circle.ts'),{'@/stores/session':{useSessionStore:()=>session},'@/services/api':{errorMessage:e=>e.message},'@/services/api/environment':{mediaUrl:x=>x}},{uni:{stopPullDownRefresh(){}}});return {session,list:circle.useCircleList(fetchPage)}}
test('pagination retries same raw offset, preserves rows and deduplicates',async()=>{
  const offsets=[];let fail=true;const h=listHarness(async offset=>{offsets.push(offset);if(offset===0)return {items:[{id:'a'},{id:'b'}],hasMore:true};if(fail){fail=false;throw new Error('弱网')}return {items:[{id:'b'},{id:'c'}],hasMore:false}})
  await h.list.load();await h.list.load(true);assert.deepEqual(h.list.items.value.map(x=>x.id),['a','b']);assert.equal(h.list.moreError.value,'弱网');await h.list.retryMore();assert.deepEqual(offsets,[0,2,2]);assert.deepEqual(h.list.items.value.map(x=>x.id),['a','b','c']);assert.equal(h.list.hasMore.value,false)
})
test('refresh discards previous page response and identity change clears private rows',async()=>{
  const wait=deferred();let count=0;const h=listHarness(()=>++count===1?wait.promise:Promise.resolve({items:[{id:'new'}],hasMore:false}));const old=h.list.load();await h.list.load();wait.resolve({items:[{id:'old'}],hasMore:true});await old;assert.deepEqual(h.list.items.value.map(x=>x.id),['new']);h.session.epoch++;assert.equal(h.list.items.value.length,0)
})
test('navigation restores original circle detail, respects post id and circle tab',()=>{
  const calls=[],uni=Object.fromEntries(['navigateBack','switchTab','redirectTo','navigateTo'].map(method=>[method,options=>{calls.push([method,options?.url]);options?.complete?.()}]));let previous={route:'pages/circle/detail',options:{id:'a'}}
  const nav=evaluate(source('services/navigation.ts'),{'@/services/api':{},'@/services/wechat':{},'@/stores/session':{}},{uni,getCurrentPages:()=>[previous,{route:'pages/login/index'}]})
  nav.finishProfile('/pages/circle/detail?id=a&intent=1');assert.equal(calls.pop()[0],'navigateBack');nav.finishProfile('/pages/circle/detail?id=b&intent=1');assert.equal(calls.pop()[1],'/pages/circle/detail?id=b&intent=1');previous={route:'pages/other'};nav.finishProfile('/pages/circle/index');assert.deepEqual(calls.pop(),['switchTab','/pages/circle/index'])
  previous={route:'pages/circle/editor',options:{id:'a'}};nav.finishProfile('/pages/circle/editor?id=a');assert.equal(calls.pop()[0],'navigateBack')
})
test('all five routes and four tabs have real page and image files',()=>{
  const config=JSON.parse(source('pages.json'));assert.deepEqual(config.tabBar.list.map(x=>x.text),['活动','学友圈','助手','我的'])
  for(const path of Object.values(routes)){assert.ok(config.pages.some(x=>'/'+x.path===path));assert.ok(existsSync(new URL('../src'+path+'.vue',import.meta.url)))}
  for(const tab of config.tabBar.list){for(const path of [tab.iconPath,tab.selectedIconPath])assert.ok(existsSync(new URL('../src/'+path,import.meta.url)))}
})

test('submission after removal immediately clears public body and confirmation before refreshing',async()=>{
  let removed=false
  const h=harness('detail',{api:{circlePost:async()=>removed?{...post(),state:'removed',body:'',title:'',images:[],author:null}:post(),submitCircleIntent:async()=>{removed=true;throw Object.assign(new Error('帖子已下架'),{code:'POST_UNAVAILABLE',status:409})}}})
  await h.page.activate();await h.page.confirmIntent();await h.page.submit()
  assert.equal(h.page.sheet.value,false);assert.equal(h.page.phone.value,'');assert.equal(h.page.post.value.state,'removed');assert.equal(h.page.post.value.body,'');assert.equal(h.page.sending.value,false)
})

test('expired session during profile gate preserves original intent context through relogin',async()=>{
  const h=harness('detail',{requireProfile:async()=>{
    h.session.token='';h.session.epoch++;h.session.member.profileComplete=false;h.hooks.onHide();return false
  }})
  await h.page.activate();await h.page.confirmIntent();assert.equal(h.sent.length,0)
  h.session.token='replacement-token';h.session.member.profileComplete=true;await h.page.activate()
  assert.equal(h.page.sheet.value,true);assert.equal(h.page.phone.value,'13800000000');assert.equal(h.sent.length,0)
})

test('cancelled confirmation does not reopen on return or submit',async()=>{
  const h=harness();await h.page.activate();await h.page.confirmIntent();h.page.phone.value='13900000000';h.page.closeSheet()
  h.hooks.onHide();await h.page.activate();await h.page.submit()
  assert.equal(h.page.sheet.value,false);assert.equal(h.page.phone.value,'');assert.equal(h.sent.length,0)
})

test('editor ignores old-account load failure while new account form loads',async()=>{
  const old=deferred();let count=0
  const h=harness('editor',{api:{circlePost:()=>++count===1?old.promise:Promise.resolve({...post(),isOwner:true,title:'新账号帖子'})}})
  h.page.id.value='post-a';const first=h.page.activate();await tick();h.session.token='token-b';await tick()
  old.reject(new Error('旧账号请求失败'));await first
  assert.equal(h.page.title.value,'新账号帖子');assert.equal(h.page.error.value,'');assert.equal(h.page.readyToken.value,'token-b')
})

test('editor preserves native picker selection across hide and show',async()=>{
  const selected=deferred(),h=harness('editor',{chooseCircleImages:()=>selected.promise});await h.page.activate()
  const picking=h.page.pick();h.hooks.onHide();h.hooks.onShow()
  assert.equal(h.page.picking.value,true)
  selected.resolve([{path:'chosen',base64:'iVBOR',mimeType:'image/png'}]);await picking
  assert.equal(h.page.picking.value,false);assert.equal(h.page.images.value[0].path,'chosen')
})

test('editor releases image-picker lock after unloading and ignores late selection',async()=>{
  const selected=deferred(),h=harness('editor',{chooseCircleImages:()=>selected.promise});await h.page.activate()
  const picking=h.page.pick();assert.equal(h.page.picking.value,true);h.hooks.onUnload()
  selected.resolve([{path:'late',base64:'iVBOR',mimeType:'image/png'}]);await picking;await h.page.activate()
  assert.equal(h.page.picking.value,false);assert.equal(h.page.images.value.length,0)
})

test('cancelled native picker leaves text intact and allows another selection',async()=>{
  const selected=deferred(),h=harness('editor',{chooseCircleImages:()=>selected.promise});await h.page.activate()
  h.page.title.value='保留标题';const picking=h.page.pick();h.hooks.onHide();h.hooks.onShow()
  selected.resolve([]);await picking
  assert.equal(h.page.picking.value,false);assert.equal(h.page.images.value.length,0);assert.equal(h.page.title.value,'保留标题');assert.equal(h.page.actionError.value,'')
})

test('editor caps selected images at six and ignores further selection',async()=>{
  let count=0;const h=harness('editor',{chooseCircleImages:async()=>{count++;return Array.from({length:7},(_,i)=>({path:String(i),base64:'iVBOR',mimeType:'image/png'}))}})
  await h.page.activate();await h.page.pick();await h.page.pick();assert.equal(h.page.images.value.length,6);assert.equal(count,1)
})

test('owner lists show loading during identity preparation and stop refresh on failure',async()=>{
  for(const page of ['mine','intents']){
    const identity=deferred();let stopped=0
    const h=harness(page,{bootstrapIdentity:()=>identity.promise,uni:{stopPullDownRefresh:()=>stopped++}})
    const loading=h.page.activate();assert.equal(h.page.preparing.value,true)
    identity.reject(new Error('身份检查失败'));await loading
    assert.equal(h.page.preparing.value,false);assert.equal(h.page.error.value,'身份检查失败');assert.ok(stopped>0)
  }
})

test('owner lists resume after expired identity is replaced on the visible page',async()=>{
  for(const page of ['mine','intents']){
    let renewed=false,reads=0
    const h=harness(page,{bootstrapIdentity:async()=>{
      if(renewed)return
      renewed=true;h.session.epoch++;h.session.token='';await tick();h.session.token='renewed-token'
    },api:{circlePosts:async()=>{reads++;return {items:[{...post(),isOwner:true}],hasMore:false}},circleIntents:async()=>{reads++;return {items:[{id:'intent-a',phone:'13900000000'}],hasMore:false}}}})
    await h.page.activate();await tick();await tick()
    assert.equal(h.page.items.value.length,1);assert.equal(h.page.preparing.value,false);assert.ok(reads>0)
  }
})

test('hidden owner pages do not reload private data after account change',async()=>{
  for(const page of ['mine','intents']){
    let reads=0
    const h=harness(page,{api:{circlePosts:async()=>{reads++;return {items:[],hasMore:false}},circleIntents:async()=>{reads++;return {items:[],hasMore:false}}}})
    await h.page.activate();const initial=reads;h.hooks.onHide();h.session.token='other-token';await tick()
    assert.equal(reads,initial);assert.equal(h.page.items.value.length,0)
  }
})

test('intent contacts remain readable when removed-post thumbnail fails',async()=>{
  const h=harness('intents',{api:{circlePost:async()=>({...post(),state:'removed',isOwner:true,images:[{id:'image-a',url:'/private-image'}]}),circleIntents:async()=>({items:[{id:'intent-a',phone:'13900000000',member:{displayName:'学友'}}],hasMore:false})},uni:{downloadFile:options=>options.fail()}})
  await h.page.activate();assert.equal(h.page.items.value[0].phone,'13900000000');assert.equal(h.page.thumbnailError.value,true);assert.equal(h.page.error.value,'')
})

test('leaving intent page during identity preparation prevents late owner requests',async()=>{
  const identity=deferred();let reads=0
  const h=harness('intents',{bootstrapIdentity:()=>identity.promise,api:{circlePost:async()=>{reads++;return post()}}})
  const loading=h.page.activate();h.hooks.onHide();identity.resolve();await loading
  assert.equal(reads,0);assert.equal(h.page.post.value,null);assert.equal(h.page.items.value.length,0)
})

test('account change while end confirmation is open prevents ending previous owner post',async()=>{
  let modal
  const h=harness('mine',{uni:{showModal:options=>{modal=options}}});await h.page.activate()
  const ending=h.page.end({...post(),isOwner:true});h.session.token='token-b';modal.success({confirm:true});await ending
  assert.ok(!h.calls.some(call=>call[0]==='end'));assert.equal(h.page.actionError.value,'')
})

test('login cancellation returns to original post without calling login or saving profile',async()=>{
  const calls=[],session={token:'',pendingInvite:'',member:null};let onLoad
  const uni=Object.fromEntries(['navigateBack','switchTab','redirectTo','navigateTo'].map(method=>[method,options=>{calls.push([method,options?.url]);options?.complete?.()}]))
  const deps={'@/services/api':{api:{profile:()=>assert.fail('cancel must not save profile'),legalDocuments:async()=>({development:true,terms:{version:'dev'},privacy:{version:'dev'}})},errorMessage:e=>e.message,refreshMember:()=>assert.fail('cancel must not request profile')},'@/services/wechat':{bootstrapIdentity:async()=>{}},'@/stores/session':{useSessionStore:()=>session},'@/services/api/environment':{LOCAL_TEST:false,mediaUrl:x=>x},'@dcloudio/uni-app':{onLoad:fn=>onLoad=fn,onUnload:()=>{}}}
  deps['@/services/navigation']=evaluate(source('services/navigation.ts'),deps,{uni,getCurrentPages:()=>[{route:'pages/circle/detail',options:{id:'post-a'}},{route:'pages/login/index'}]})
  const script=source('pages/login/index.vue').match(/<script setup lang="ts">([\s\S]*?)<\/script>/)[1]
  const page=evaluate(script+'\nexport {cancel,cancelText,busy};',deps,{uni})
  await onLoad({returnTo:'/pages/circle/detail?id=post-a&intent=1'});assert.equal(page.cancelText.value,'暂不继续，返回帖子');page.cancel()
  assert.deepEqual(calls,[['navigateBack',undefined]])
  page.busy.value=true;page.cancel();assert.equal(calls.length,1);page.busy.value=false
  for(const [returnTo,method,target] of [
    ['/pages/circle/editor','switchTab','/pages/circle/index'],
    ['/pages/circle/editor?id=post-a','switchTab','/pages/circle/index'],
    ['/pages/activity/editor?id=activity-a','switchTab','/pages/activity/index'],
    ['/pages/assistant/activity-draft','switchTab','/pages/assistant/index'],
    ['/pages/registration/form?id=activity-a&edit=1','redirectTo','/pages/activity/detail?id=activity-a&edit=1']
  ]){
    await onLoad({returnTo});page.cancel();assert.deepEqual(calls.pop(),[method,target])
  }
  for(const returnTo of ['', '/pages/login/index', 'https://example.test', '/pages/circle/detail-unknown?id=post-a']){
    await onLoad({returnTo});assert.equal(page.cancelText.value,'暂不完善，先看看活动');page.cancel();assert.deepEqual(calls.pop(),['switchTab','/pages/activity/index'])
  }
})

test('detail pull refresh reloads server state and stops on success or failure',async()=>{
  let reads=0,stopped=0,fail=false
  const h=harness('detail',{api:{circlePost:async()=>{reads++;if(fail)throw new Error('refresh failed');return {...post(),state:reads>1?'ended':'open'}}},uni:{stopPullDownRefresh:()=>stopped++}})
  await h.page.activate();assert.equal(h.page.post.value.state,'open')
  const before=stopped
  assert.equal(typeof h.hooks.onPullDownRefresh,'function')
  await h.hooks.onPullDownRefresh();assert.equal(reads,2);assert.equal(h.page.post.value.state,'ended');assert.equal(stopped,before+1)
  fail=true;await h.hooks.onPullDownRefresh();assert.equal(h.page.error.value,'refresh failed');assert.equal(stopped,before+2)
})

test('late detail refresh cannot restore hidden content or overwrite a new identity',async()=>{
  for(const change of ['hide','identity']){
    const pending=deferred();let reads=0,stopped=0
    const h=harness('detail',{api:{circlePost:()=>++reads===2?pending.promise:Promise.resolve({...post(),title:reads>2?'new identity':'initial'})},uni:{stopPullDownRefresh:()=>stopped++}})
    await h.page.activate();assert.equal(typeof h.hooks.onPullDownRefresh,'function')
    const refresh=h.hooks.onPullDownRefresh()
    if(change==='hide')h.hooks.onHide();else h.session.token='token-b'
    await tick();pending.resolve({...post(),title:'old response'});await refresh
    assert.equal(h.page.post.value?.title,change==='hide'?undefined:'new identity')
    assert.ok(stopped>0)
  }
})

test('pull refresh during intent submission preserves the confirmation and completes refresh',async()=>{
  const pending=deferred();let stopped=0,reads=0
  const h=harness('detail',{api:{circlePost:async()=>{reads++;return post()},submitCircleIntent:()=>pending.promise},uni:{stopPullDownRefresh:()=>stopped++}})
  await h.page.activate();await h.page.confirmIntent();const submitting=h.page.submit();await tick()
  const before=reads;await h.hooks.onPullDownRefresh()
  assert.equal(reads,before);assert.equal(stopped,1);assert.equal(h.page.sending.value,true)
  pending.resolve();await submitting;assert.equal(h.page.sending.value,false);assert.equal(h.page.sheet.value,false)
})
