import activityImages from './activity-images-fixture.mjs'
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { setImmediate } from 'node:timers'
import { URL } from 'node:url'
import ts from 'typescript'

const require = createRequire(import.meta.url)
const { reactive, effectScope } = require('vue')

function script(path, exported) {
  const source = readFileSync(new URL(path, import.meta.url), 'utf8').match(/<script setup lang="ts">([\s\S]*?)<\/script>/)[1]
  return ts.transpileModule(source + `\nexport { ${exported} };`, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
}

function loadGatherService(name, deps = {}) {
  const source = readFileSync(new URL('../src/services/' + name + '.ts', import.meta.url), 'utf8')
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
  const exports = {}
  new Function('exports','require', code)(exports, id => deps[id] || require(id))
  return exports
}

const blankDraft = {
  title:'聚会',description:'讨论社群运营',location:null,startsAt:null,endsAt:null,registrationDeadline:null,
  capacity:null,feeType:null,feeAmountCents:null,questions:[]
}
function card(field) {
  return field ? {field,prompt:'模型生成的' + field + '问题',options:[]} : null
}
function makePage(t, storage = new Map()) {
  const session = reactive({ token:'token', epoch:1, member:{id:'a'} })
  const requests = [], navigation = [], lifecycle = {}, decisions = [], modals = [], staged = []
  const wechat = {}
  const api = { communityAccess: async () => ({isRegistered:true}), interpretActivityReply: async (_answer,_field,_date,_period,context) => ({ draft:{...blankDraft,title:null,description:null}, nextQuestion:card(context.pending[0]) }), generateActivityDraft: (idea,context) => new Promise((resolve, reject) => requests.push({idea, context, resolve, reject})) }
  const uni = {
    setStorageSync:(k,v) => storage.set(k,v), getStorageSync:k => storage.get(k), removeStorageSync:k => storage.delete(k),
    hideKeyboard() {}, pageScrollTo() {}, showModal(options) {
      assert.ok([...options.confirmText || '确定'].length <= 4, '微信弹窗确认按钮最多4个字符')
      modals.push(options.title)
      const choice = decisions.shift()
      if (choice === undefined) throw new Error('unexpected modal: ' + options.title)
      if (choice === null) options.fail()
      else options.success({confirm:choice,cancel:!choice})
    }
  }
  const historySource = readFileSync(new URL('../src/services/gather-history.ts', import.meta.url), 'utf8')
  const historyModule = {}
  new Function('exports','uni',ts.transpileModule(historySource,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText)(historyModule,uni)
  const dialog = loadGatherService('gather-dialog')
  const deps = {
    '@dcloudio/uni-app': {onShow:fn=>lifecycle.show=fn,onUnload:fn=>lifecycle.unload=fn,onHide:fn=>lifecycle.hide=fn},
    '@/services/gather-history':historyModule,
    '@/services/gather-dialog':dialog,
    '@/services/gather-edits':loadGatherService('gather-edits', {'./gather-dialog':dialog}),
    '@/services/wechat':wechat, '@/services/presentation':{activityTimeRangeWeekday:(start,end)=>start+' 至 '+end}, '@/services/api/environment':{API_BASE_URL:'local',mediaUrl:value=>value},
    '@/services/api':{api, errorMessage:e=>e.message, ApiError:class extends Error {}}, '@/services/ai-draft':{stageActivityDraft:(...args)=>staged.push(args)},
    '@/services/navigation':{ routes:{manage:'/manage'}, requireProfile: async()=>true, navigate:url=>navigation.push(url) },
    '@/stores/session':{useSessionStore:()=>session}
  }
  const page = {}, scope = effectScope()
  scope.run(() => new Function('require','exports','uni', script('../src/pages/assistant/activity-draft.vue',
    'inputDescription,acceptDescription,writingDescription,finishImages,skipSettings,stage,settingsDecision,selectDate,selectTime,selectLocation,recordSelection,writeDescription,descriptionCandidate,confirmedDescription,imagesDecided,addGatherImages,removeGatherImage,cropper,inputForPublish,moreSettings,newConversation,checking,canInitiate,invitedFriend,accessError,generate,idea,busy,error,draft,answer,question,publish,createdId,reply,chooseStarter,message,sendMessage,sendCard,writeAnswer,cancelAnswer,customControl,custom,exchanges,previewReady,options,requestQuestion,outgoing,sentIdea,openingFacts,openHistory,resumeHistory,history'))(name=>deps[name]||require(name),page,uni))
  t.after(()=>{lifecycle.unload();scope.stop()})
  return {page,session,api,requests,navigation,lifecycle,decisions,storage,modals,wechat,staged}
}

test('gather dialog preserves failed input, suppresses duplicate generation and late responses for another session', async t=>{
  const {page,session,requests,lifecycle}=makePage(t)
  await lifecycle.show()
  page.idea.value='  交流园区经验  '
  const pending=page.generate()
  await page.generate()
  assert.equal(requests.length,1)
  assert.equal(requests[0].idea,'交流园区经验')
  requests[0].reject(new Error('网络中断'))
  await pending
  assert.equal(page.idea.value,'  交流园区经验  ')
  assert.equal(page.error.value,'网络中断')
  const stale=page.generate()
  session.epoch++
  requests[1].resolve({draft:blankDraft,nextQuestion:card('time')})
  await stale
  assert.equal(page.draft.value,null)
})

test('complete conversation produces preview, publishes only after confirmation and retries same draft', async t=>{
  const {page,requests,lifecycle,decisions,api,navigation}=makePage(t)
  await lifecycle.show()
  page.idea.value='明天下午讨论社群运营'
  const pending=page.generate()
  requests[0].resolve({draft:blankDraft,nextQuestion:card('time')})
  await pending
  assert.equal(page.question.value.field,'time')
  await page.answer('14:00–16:00',true)
  assert.equal(page.question.value.field,'location')
  await page.answer('线上聚会')
  await page.answer('报名后发会议链接')
  await page.answer('免费',true)
  await page.answer('群内联系发起人')
  assert.equal(page.question.value,null)
  page.confirmedDescription.value=page.draft.value.description; page.imagesDecided.value=true
  assert.equal(page.stage.value,'settings')
  page.skipSettings()
  assert.equal(page.stage.value,'preview')
  let creates=0, publishes=0
  api.createActivity=async input=>{creates++;assert.equal(input.location,'线上聚会 · 报名后发会议链接');assert.equal(input.registrationScope,'all');return {id:'existing'}}
  api.managedActivity=async()=>({lifecycle:'draft'})
  api.publishActivity=async()=>{if (++publishes===1) throw new Error('稍后再试')}
  decisions.push(false,true,true)
  await page.publish()
  assert.equal(creates,0)
  await page.publish()
  assert.equal(page.createdId.value,'existing')
  await page.publish()
  assert.equal(creates,1)
  assert.equal(publishes,2)
  assert.deepEqual(navigation,['/manage?id=existing'])
  page.openHistory()
  const published=page.history.value.find(item=>item.idea==='明天下午讨论社群运营')
  assert.ok(published)
  assert.equal(published.snapshot,undefined)
  page.resumeHistory(published.id)
  assert.equal(page.draft.value,null)
  assert.equal(page.idea.value,'')
})

test('compound text can supply place, fee and capacity in one turn, contact stays local',async t=>{
  const {page,requests,lifecycle,decisions,api}=makePage(t)
  await lifecycle.show()
  page.idea.value='明天讲社群运营'
  const pending=page.generate()
  requests[0].resolve({draft:blankDraft,nextQuestion:card('time')})
  await pending
  await page.answer('14:00–16:00',true)
  const input='在创客厅，免费，限20人'
  const calls=[]
  api.interpretActivityReply=async(...args)=>{
    calls.push(args)
    return {draft:{...blankDraft,title:null,description:null,location:'创客厅',feeType:'free',capacity:20},nextQuestion:card('contact')}
  }
  decisions.push(true)
  await page.answer(input)
  assert.equal(page.draft.value.location,'创客厅')
  assert.equal(page.draft.value.capacity,20)
  assert.equal(page.question.value.field,'contact')
  await page.answer('联系发起人')
  assert.equal(calls.length,1)
  assert.equal(calls[0][0],input)
  assert.equal(page.draft.value.consultationContact,'联系发起人')
  assert.equal(page.question.value,null)
})

function resumeChat(page, idea) {
  assert.equal(page.idea.value, idea, 'unfinished conversation should restore automatically')
}

test('leaving and re-entering automatically restores unsent input without archiving it', async t => {
  const first=makePage(t)
  await first.lifecycle.show()
  first.page.idea.value='上次未提交的想法'
  first.lifecycle.hide()
  first.lifecycle.unload()
  const next=makePage(t,first.storage)
  await next.lifecycle.show()
  assert.equal(next.page.idea.value,'上次未提交的想法')
  next.page.openHistory()
  assert.equal(next.page.history.value.length,0)
  assert.equal(next.requests.length,0)
  assert.deepEqual(next.modals,[])
})

test('editor applies explicit AI fields but requires a fee choice when unknown', t => {
  const session = reactive({ token: 'token-a', epoch: 1, member: { id: 'member-a' } })
  const deps = {
    '@dcloudio/uni-app': { onLoad(fn) { fn({ aiDraft: '1' }) }, onShow() {}, onHide() {}, onUnload() {} },
    '@/services/api': { api: {}, errorMessage: e => e.message, ApiError: class extends Error {} },
    '@/services/activity-images': activityImages,
    '@/services/ai-draft': { takeActivityDraft: () => null },
    '@/services/navigation': { routes: { editor: '/pages/activity/editor' }, requireProfile: async () => true },
    '@/services/api/environment': { mediaUrl: value => value }, '@/services/presentation': { feeDisclaimer: '' },
    '@/stores/session': { useSessionStore: () => session }, '@/services/wechat': {}, '@/components/base/RequestState.vue': {}
  }
  const page = {}, scope = effectScope()
  scope.run(() => new Function('require', 'exports', script('../src/pages/activity/editor.vue', 'applyAiDraft, form, questions, payload, aiDraftApplied'))(name => deps[name] || require(name), page))
  t.after(() => scope.stop())
  page.applyAiDraft({ title: '园区分享会', description: '交流活动', location: '上海园区', startsAt: null, endsAt: null, registrationDeadline: null, capacity: null, feeType: null, feeAmountCents: null, questions: [{ prompt: '所属企业', type: null, required: null, options: null }] })
  assert.equal(page.form.title, '园区分享会')
  assert.equal(page.form.feeType, '')
  assert.equal(page.questions.value[0].prompt, '所属企业')
  assert.equal(page.aiDraftApplied.value, true)
  page.form.consultationContact = '活动群'
  assert.throws(() => page.payload(), /请选择免费活动或收费活动/)
})

test('chat starter can be edited before sending and the same composer answers the next card', async t => {
  const { page, requests, lifecycle } = makePage(t)
  await lifecycle.show()
  page.chooseStarter('周末办一场十来人的读书会')
  assert.equal(requests.length, 0)
  page.message.value = '明天下午办读书会'
  page.sendMessage()
  assert.equal(requests[0].idea, '明天下午办读书会')
  requests[0].resolve({ draft: blankDraft, nextQuestion:card('time') })
  await new Promise(resolve => setImmediate(resolve))
  page.writeAnswer()
  page.message.value = '三点到五点，免费，最多20人'
  page.sendMessage()
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(page.exchanges.value[0].answer, '三点到五点，免费，最多20人')
  assert.equal(page.idea.value, '明天下午办读书会')
  assert.equal(page.message.value, '')
  assert.equal(page.question.value.field, 'location')
  assert.equal(requests.length, 1)
})

test('venue card hides generic venue suggestions and can open the map before manual entry', async t => {
  const {page, requests, lifecycle, wechat} = makePage(t)
  await lifecycle.show()
  page.idea.value = '想约几位同行聊聊 AI 应用'
  const generation = page.generate()
  requests[0].resolve({draft:blankDraft,nextQuestion:{...card('location'),options:['线下聚会','安静的咖啡馆（填地址）','共享会议室']}})
  await generation
  assert.deepEqual(page.options.value,[])
  page.writeAnswer()
  assert.equal(page.customControl.value,null)
  let opened = false
  wechat.chooseActivityLocation = async () => { opened = true; return null }
  await page.selectLocation()
  assert.equal(opened,true)
  assert.equal(page.draft.value.location,null)
  assert.equal(page.question.value.field,'location')
})

test('online venue completes location and unsolicited joining details are kept without another card', async t => {
  const { page, requests, lifecycle, api } = makePage(t)
  await lifecycle.show()
  page.idea.value = '明天聊 AI'
  const pending = page.generate()
  requests[0].resolve({ draft:blankDraft,
    nextQuestion:{field:'location',prompt:'同行们准备在哪里交流 AI？',options:['线下聚会','行业园区','线上聚会']} })
  await pending
  assert.equal(page.question.value.field, 'location')
  assert.equal(page.question.value.prompt,'同行们准备在哪里交流 AI？')
  assert.deepEqual(page.options.value,['线上聚会'])
  assert.equal(page.draft.value.location,null)
  const calls = []
  api.interpretActivityReply = async (...args) => {
    calls.push(args)
    return {draft:{...blankDraft,title:null,description:null},
      nextQuestion:calls.length === 1 ? {field:'joining',prompt:'大家怎样进入这次线上交流？',options:['填写会议链接','报名后发会议链接','自己填写']}
        : {field:'fee',prompt:'明天的 AI 沙龙如何收费？',options:['免费参与','收费']} }
  }
  await page.answer(page.options.value[0],true)
  assert.equal(page.draft.value.location, '线上聚会')
  assert.equal(calls[0][4].known.find(item=>item.field==='location').value,'线上聚会')
  assert.equal(calls[0][4].recent.at(-1).prompt,'同行们准备在哪里交流 AI？')
  assert.equal(calls[0][4].recent.at(-1).answer, '线上聚会')
  assert.equal(page.question.value,null)
  assert.equal(page.previewReady.value,false)
  assert.ok(!calls[0][4].pending.includes('joining'))
  await page.answer('报名后发腾讯会议链接，免费，最多十人')
  assert.equal(page.draft.value.location,'线上聚会 · 报名后发腾讯会议链接')
  assert.equal(page.draft.value.feeType,'free')
  assert.equal(page.draft.value.capacity,10)
  assert.equal(page.question.value,null)
  assert.equal(page.previewReady.value,false)
})

test('AI outage preserves answers until an explicit question retry and prevents premature publish', async t => {
  const { page, requests, lifecycle, api } = makePage(t)
  await lifecycle.show()
  page.idea.value = '明天下午读书会'
  const pending = page.generate()
  requests[0].resolve({draft:blankDraft,nextQuestion:{field:'fee',prompt:'这次读书会要分摊费用吗？',options:['免费']}})
  await pending
  let calls=0
  api.interpretActivityReply = async () => {calls++;throw Error('服务暂时不可用')}
  await page.answer('免费',true)
  assert.equal(page.draft.value.feeType,'free')
  assert.equal(page.exchanges.value.at(-1).answer,'免费')
  assert.equal(page.question.value,null)
  assert.equal(page.previewReady.value,false)
  await page.publish()
  assert.equal(page.createdId.value,'')
  const retry = page.requestQuestion()
  await page.requestQuestion()
  assert.equal(requests.length,2)
  assert.equal(requests[1].context.known.find(row => row.field === 'fee').value,'free')
  requests[1].resolve({draft:{...blankDraft,title:'不应该覆盖的标题'},nextQuestion:card('time')})
  await retry
  assert.equal(page.question.value.prompt,'模型生成的time问题')
  assert.equal(page.draft.value.title,blankDraft.title)
  assert.equal(calls,1)
})
test('a clarification without a patch restores automatically after leaving', async t => {
  const first=makePage(t)
  const {page,lifecycle,requests,api}=first
  await lifecycle.show()
  page.idea.value='明天下午的 AI 聚会'
  const pending=page.generate()
  requests[0].resolve({draft:blankDraft,nextQuestion:{field:'time',prompt:'想几点开始？',options:['14:00–16:00']}})
  await pending
  api.interpretActivityReply=async(...args)=>{
    assert.match(args[4].known.find(f=>f.field==='time').value,/下午/)
    assert.ok(args[4].pending.includes('time'))
    return {draft:{...blankDraft,title:null,description:null},nextQuestion:{field:'time',prompt:'大家下班时间不同，傍晚哪段更合适？',options:['18:00–20:00','19:00–21:00']}}
  }
  await page.answer('等大家下班以后')
  assert.equal(page.exchanges.value.at(-1).answer,'等大家下班以后')
  assert.equal(page.reply.value,'')
  assert.equal(page.question.value.prompt,'大家下班时间不同，傍晚哪段更合适？')
  lifecycle.unload()
  const second=makePage(t,first.storage)
  await second.lifecycle.show()
  resumeChat(second.page,'明天下午的 AI 聚会')
  assert.deepEqual(second.page.question.value,page.question.value)
  const legacyRaw = {idea:'明天下午的 AI 聚会',draft:page.draft.value,exchanges:page.exchanges.value,reply:'',remaining:0}
  const legacy=makePage(t,new Map([['gather-dialog:v1:local:a',JSON.stringify(legacyRaw)]]))
  await legacy.lifecycle.show()
  resumeChat(legacy.page,legacyRaw.idea)
  assert.equal(legacy.page.question.value,null)
  assert.equal(legacy.page.previewReady.value,false)
  let followups = 0
  legacy.api.interpretActivityReply = async () => {
    followups++
    return { draft:{...blankDraft,title:null,description:null}, nextQuestion:null }
  }
  await legacy.page.answer('15:00–17:00')
  assert.equal(followups,1)
  assert.equal(legacy.page.previewReady.value,false)
})

test('messages appear before the API responds and each reply keeps its own confirmed facts', async t => {
  const { page, requests, lifecycle, api, storage } = makePage(t)
  await lifecycle.show()
  page.message.value = '明天下午办读书会'
  page.sendMessage()
  assert.equal(page.sentIdea.value, '明天下午办读书会')
  assert.equal(page.message.value, '')
  assert.deepEqual(page.openingFacts.value, [])
  requests[0].resolve({ draft: blankDraft, nextQuestion:card('time') })
  await new Promise(resolve => setImmediate(resolve))
  assert.ok(page.openingFacts.value.some(fact => fact.startsWith('时间')))
  let resolveReply, calls = 0
  api.interpretActivityReply = () => new Promise(resolve => { calls++; resolveReply = resolve })
  const text = '下午三点到五点，免费，最多20人'
  page.message.value = text
  page.sendMessage()
  assert.equal(page.outgoing.value.answer, text)
  assert.equal(page.message.value, '')
  assert.equal(page.exchanges.value.length, 0)
  await page.answer(text)
  assert.equal(calls, 1)
  lifecycle.hide()
  const interrupted = makePage(t, new Map(storage))
  await interrupted.lifecycle.show()
  resumeChat(interrupted.page,'明天下午办读书会')
  assert.equal(interrupted.page.message.value,text)
  assert.equal(interrupted.requests.length,0)
  resolveReply({ draft: { ...blankDraft, title: null, description: null } })
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(page.outgoing.value, null)
  assert.equal(page.exchanges.value.length, 1)
  const [turn] = page.exchanges.value
  assert.equal(turn.answer, text)
  assert.deepEqual(turn.facts.map(fact => fact.slice(0, 2)), ['时间', '费用', '人数'])
  lifecycle.unload()
  const resumed = makePage(t, storage)
  await resumed.lifecycle.show()
  resumeChat(resumed.page,'明天下午办读书会')
  assert.deepEqual(resumed.page.openingFacts.value, page.openingFacts.value)
  assert.deepEqual(resumed.page.exchanges.value[0].facts, turn.facts)
})

test('unfinished conversation survives beyond seven days and keeps both input fields', async t => {
  const key='gather-dialog:v1:local:a'
  const saved={idea:'读书会',draft:null,exchanges:[],reply:'卡内未发内容',dockReply:'聊天未发内容',custom:true,chatId:'active-1',updatedAt:Date.now()-8*86400000}
  const next=makePage(t,new Map([[key,JSON.stringify(saved)]]))
  await next.lifecycle.show()
  assert.equal(next.page.idea.value,'读书会')
  assert.equal(next.page.reply.value,saved.reply)
  assert.equal(next.page.message.value,'读书会')
  next.lifecycle.hide()
  assert.equal(next.storage.has(key),true)
  assert.equal(JSON.parse(next.storage.get(key)).dockReply,saved.dockReply)
})

test('old unfinished history is recovered as the active conversation', async t => {
  const key='gather-dialog:v1:local:a'
  const saved={idea:'园区读书会',draft:null,exchanges:[],reply:'',createdId:''}
  const storage=new Map([[key+':history',JSON.stringify([{id:'old',updatedAt:Date.now(),idea:saved.idea,openingFacts:[],exchanges:[],snapshot:saved}])]])
  const next=makePage(t,storage)
  await next.lifecycle.show()
  assert.equal(next.page.idea.value,saved.idea)
  assert.equal(JSON.parse(storage.get(key)).idea,saved.idea)
  next.page.openHistory()
  assert.equal(next.page.history.value.length,0)
})

test('community status is checked again before returning to the AI gathering conversation', async t => {
  const h = makePage(t)
  await h.lifecycle.show(); assert.equal(h.page.canInitiate.value, true)
  h.api.communityAccess = async () => ({isRegistered:false})
  await h.lifecycle.show()
  assert.equal(h.page.canInitiate.value, false); assert.equal(h.page.invitedFriend.value, true); assert.equal(h.page.accessError.value, '')
  assert.equal(h.requests.length, 0)
})

test('card and chat keep separate unsent text, including after restoring the conversation', async t => {
  const h = makePage(t)
  await h.lifecycle.show()
  h.page.idea.value = '明天下午交流'
  const pending = h.page.generate()
  h.requests[0].resolve({draft:blankDraft, nextQuestion:card('contact')})
  await pending
  h.page.writeAnswer()
  h.page.reply.value = '联系发起人'
  h.page.message.value = '人数改成15人'
  assert.equal(h.page.reply.value, '联系发起人')
  h.lifecycle.unload()
  const restored = makePage(t, h.storage)
  await restored.lifecycle.show()
  resumeChat(restored.page, '明天下午交流')
  assert.equal(restored.page.reply.value, '联系发起人')
  assert.equal(restored.page.message.value, '人数改成15人')
  restored.page.sendCard()
  restored.requests[0].resolve({nextQuestion:card('location')})
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(restored.page.draft.value.consultationContact, '联系发起人')
  assert.equal(restored.page.draft.value.capacity, null)
  assert.equal(restored.page.message.value, '人数改成15人')
})

test('chat changes capacity while location is pending and again from preview, preserving other confirmed values', async t => {
  const h = makePage(t)
  await h.lifecycle.show()
  h.page.idea.value = '一场免费聚会'
  const generating = h.page.generate()
  const initial = {...blankDraft,startsAt:'2099-12-01T14:00:00+08:00',endsAt:'2099-12-01T16:00:00+08:00',feeType:'free',capacity:20}
  h.requests[0].resolve({draft:initial,nextQuestion:card('location')})
  await generating
  assert.equal(h.page.question.value.field, 'location')
  const initialState = JSON.parse(JSON.stringify(h.page.draft.value))
  h.api.interpretActivityReply = async (_a,_f,_d,_p,context) => ({
    nextQuestion:card(context.pending[0]),
    draft:{...initial,title:'新主题',description:'新介绍',location:'模型补写的地点',feeType:'paid',feeAmountCents:5000,capacity:15}
  })
  h.page.message.value = '人数改成15人'
  h.page.sendMessage()
  await new Promise(resolve => setImmediate(resolve))
  assert.deepEqual(h.page.draft.value, {...initialState,capacity:15})
  assert.equal(h.page.question.value.field,'location')
  h.page.message.value = '地点改到珠江书房'
  h.page.sendMessage()
  await new Promise(resolve => setImmediate(resolve))
  assert.deepEqual(h.page.draft.value, {...initialState,capacity:15,location:'珠江书房'})
  assert.equal(h.page.question.value.field,'contact')
  h.page.writeAnswer()
  h.page.reply.value = '联系发起人'
  h.page.sendCard()
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(h.page.question.value,null)
  const preview = JSON.parse(JSON.stringify(h.page.draft.value))
  h.api.interpretActivityReply = async () => ({draft:{...initial,location:'模型补写的地点',capacity:12}})
  h.page.message.value = '人数改成12人，其他照旧'
  h.page.sendMessage()
  await new Promise(resolve => setImmediate(resolve))
  assert.deepEqual(h.page.draft.value, {...preview,capacity:12})
  assert.equal(h.page.question.value,null)
  assert.deepEqual(h.page.exchanges.value.at(-1).facts,['人数 最多 12 人'])
  assert.deepEqual(h.modals,[])
})

test('repeating a known start keeps the draft, records the message once and allows a question retry', async t => {
  const {page,requests,lifecycle,api} = makePage(t)
  await lifecycle.show()
  page.idea.value = '晚上约同行聊 AI'
  const generating = page.generate()
  requests[0].resolve({draft:{...blankDraft,startsAt:'2099-11-18T21:00:00+08:00'},nextQuestion:null})
  await generating
  const before = JSON.parse(JSON.stringify(page.draft.value))
  api.interpretActivityReply = async () => ({draft:{...blankDraft,title:null,description:null},nextQuestion:null})
  page.message.value = '晚上 9 点，约几位同行聊 AI'
  await page.answer(page.message.value)
  assert.deepEqual(page.draft.value,before)
  assert.equal(page.error.value,'')
  assert.equal(page.outgoing.value,null)
  assert.equal(page.message.value,'')
  assert.equal(page.exchanges.value.length,1)
  assert.equal(page.previewReady.value,false)
  const retry = page.requestQuestion()
  requests[1].resolve({draft:blankDraft,nextQuestion:card('time')})
  await retry
  assert.equal(page.question.value.field,'time')
})

test('refreshing the same member while checking community access finishes and keeps the conversation', async t => {
  const h = makePage(t)
  await h.lifecycle.show()
  h.page.idea.value = '继续交流 AI 应用'
  let resolveAccess
  h.api.communityAccess = () => new Promise(resolve => { resolveAccess = resolve })
  const checking = h.lifecycle.show()
  await new Promise(resolve => setImmediate(resolve))
  h.session.member = {...h.session.member}
  resolveAccess({isRegistered:true})
  await checking
  assert.equal(h.page.checking.value, false)
  assert.equal(h.page.canInitiate.value, true)
  assert.equal(h.page.idea.value, '继续交流 AI 应用')
})

test('identity change during community check drops the old result and offers a retry', async t => {
  const h = makePage(t)
  await h.lifecycle.show()
  let resolveAccess
  h.api.communityAccess = () => new Promise(resolve => { resolveAccess = resolve })
  const checking = h.lifecycle.show()
  await new Promise(resolve => setImmediate(resolve))
  h.session.member = {id:'b'}
  resolveAccess({isRegistered:true})
  await checking
  assert.equal(h.page.checking.value, false)
  assert.equal(h.page.canInitiate.value, false)
  assert.match(h.page.accessError.value, /身份已变更/)
  h.api.communityAccess = async () => ({isRegistered:true})
  await h.lifecycle.show()
  assert.equal(h.page.checking.value, false)
  assert.equal(h.page.canInitiate.value, true)
})

test('saved activity draft keeps its conversation until publication is confirmed by the server', async t => {
  const key='gather-dialog:v1:local:a'
  const saved={idea:'等待发布的聚会',draft:loadGatherService('gather-dialog').createGatherDraft('等待发布的聚会',blankDraft),exchanges:[],reply:'',createdId:'saved-draft',chatId:'active',updatedAt:Date.now()}
  const h=makePage(t,new Map([[key,JSON.stringify(saved)]]))
  h.api.managedActivity=async()=>({lifecycle:'draft'})
  await h.lifecycle.show()
  assert.equal(h.page.idea.value,saved.idea)
  assert.equal(h.page.createdId.value,'saved-draft')
  assert.equal(h.storage.has(key),true)
  h.api.managedActivity=async()=>{throw new Error('查询失败')}
  await h.lifecycle.show()
  assert.equal(h.page.idea.value,saved.idea)
  assert.equal(h.storage.has(key),true)
  h.storage.set(key+':history',JSON.stringify([{id:'paused-before',updatedAt:Date.now(),idea:'更早的未发布对话',openingFacts:[],exchanges:[],snapshot:{idea:'更早的未发布对话',draft:null,exchanges:[],reply:''}}]))
  h.api.managedActivity=async()=>({lifecycle:'published'})
  await h.lifecycle.show()
  assert.equal(h.page.idea.value,'')
  assert.equal(JSON.parse(h.storage.get(key)).idea,'')
  h.page.openHistory()
  assert.equal(h.page.history.value.length,2)
  assert.equal(h.page.history.value[0].idea,saved.idea)
  assert.equal(h.page.history.value[0].snapshot,undefined)
  const reopened=makePage(t,h.storage)
  await reopened.lifecycle.show()
  assert.equal(reopened.page.idea.value,'')
})

test('unfinished conversation is isolated by account and uncertain creation is retained', async t => {
  const key='gather-dialog:v1:local:a'
  const saved={idea:'尚未确认创建结果',draft:loadGatherService('gather-dialog').createGatherDraft('尚未确认创建结果',blankDraft),exchanges:[],reply:'',createdId:'',uncertainCreate:true,chatId:'uncertain',updatedAt:Date.now()}
  const h=makePage(t,new Map([[key,JSON.stringify(saved)]]))
  await h.lifecycle.show()
  assert.equal(h.page.idea.value,saved.idea)
  h.session.member={id:'b'}
  await h.lifecycle.show()
  assert.equal(h.page.idea.value,'')
  assert.equal(JSON.parse(h.storage.get(key)).uncertainCreate,true)
  h.session.member={id:'a'}
  await h.lifecycle.show()
  assert.equal(h.page.idea.value,saved.idea)
})

test('new conversation cancels safely, archives on confirmation and stays blank after reopening', async t => {
  const h=makePage(t)
  await h.lifecycle.show()
  h.page.idea.value='未发布的原对话'
  h.decisions.push(false)
  await h.page.newConversation()
  assert.equal(h.page.idea.value,'未发布的原对话')
  h.decisions.push(true)
  await h.page.newConversation()
  assert.equal(h.page.idea.value,'')
  h.lifecycle.unload()
  const next=makePage(t,h.storage)
  await next.lifecycle.show()
  assert.equal(next.page.idea.value,'')
  next.page.openHistory()
  const saved=next.page.history.value.find(item=>item.idea==='未发布的原对话')
  assert.ok(saved.snapshot)
  next.page.resumeHistory(saved.id)
  assert.equal(next.page.idea.value,'未发布的原对话')
})

function completedDraft() {
  return {...loadGatherService('gather-dialog').createGatherDraft('AI交流', {...blankDraft,startsAt:'2099-12-01T14:00:00+08:00',endsAt:'2099-12-01T16:00:00+08:00',location:'交流中心',feeType:'free'}),consultationContact:'联系发起人'}
}

test('date and time suggestions stay available until a custom picker is requested', async t => {
  const {page, requests, lifecycle} = makePage(t)
  await lifecycle.show()
  page.idea.value = '想办一场聚会'
  const generating = page.generate()
  requests[0].resolve({draft:blankDraft,nextQuestion:{...card('date'),options:['2099-12-01','2099-12-02']}})
  await generating
  assert.equal(page.customControl.value,null)
  assert.deepEqual(page.options.value,['2099-12-01','2099-12-02'])
  page.writeAnswer()
  assert.equal(page.customControl.value,'date')
  await page.selectDate('2099-02-30')
  assert.equal(page.draft.value.date,'')
  const selection = page.selectDate('2099-12-03')
  assert.equal(page.draft.value.date,'2099-12-03')
  assert.equal(page.draft.value.startsAt,null)
  assert.equal(page.draft.value.endsAt,null)
  requests[1].resolve({draft:blankDraft,nextQuestion:{...card('time'),options:['14:00—16:00']}})
  await selection
  assert.equal(page.customControl.value,null)
  page.writeAnswer()
  assert.equal(page.customControl.value,'time')
  page.cancelAnswer()
  assert.equal(page.customControl.value,null)
  await page.answer(page.options.value[0],true)
  assert.equal(page.draft.value.startsAt,'2099-12-03T14:00:00+08:00')
  assert.equal(page.customControl.value,null)
  page.cancelAnswer()
  assert.equal(page.draft.value.date,'2099-12-03')
})

test('native time and map selections preserve unrelated facts and cancellation or stale map cannot overwrite them', async t => {
  const h=makePage(t)
  await h.lifecycle.show()
  h.page.draft.value=completedDraft()
  await h.page.selectTime({startsAt:'2099-12-02T23:00:00+08:00',endsAt:'2099-12-03T01:00:00+08:00'})
  assert.equal(h.page.draft.value.date,'2099-12-02')
  assert.equal(h.page.draft.value.location,'交流中心')
  h.wechat.chooseActivityLocation=async()=>({location:'广州 · 创客空间',latitude:23.1,longitude:113.2})
  await h.page.selectLocation()
  assert.equal(h.page.draft.value.latitude,23.1)
  assert.equal(h.page.inputForPublish(h.page.draft.value).locationLongitude,113.2)
  h.wechat.chooseActivityLocation=async()=>null
  await h.page.selectLocation()
  assert.equal(h.page.draft.value.location,'广州 · 创客空间')
  let resolveLocation
  h.wechat.chooseActivityLocation=()=>new Promise(resolve=>{resolveLocation=resolve})
  const map=h.page.selectLocation()
  h.session.epoch++
  resolveLocation({location:'迟到地点',latitude:1,longitude:2})
  await map
  assert.equal(h.page.draft.value,null)
})

test('images require continue, then AI introduction and optional settings gate the only preview', async t => {
  const h=makePage(t)
  await h.lifecycle.show()
  h.page.idea.value='AI交流'; h.page.draft.value=completedDraft()
  const before=h.page.draft.value.description
  assert.equal(h.page.stage.value,'images')
  h.wechat.chooseActivityImagePaths=async()=>['one','two']
  h.wechat.readActivityImage=async path=>({base64:path,mimeType:'image/jpeg'})
  h.page.cropper.value={open:async()=> 'cropped',cancel(){}}
  let uploads=0
  h.api.uploadCover=async()=>({coverUrl:'/image-'+(++uploads)})
  await h.page.addGatherImages()
  assert.deepEqual(h.page.draft.value.imageUrls,['/image-2','/image-3'])
  assert.equal(h.page.draft.value.coverSourceUrl,'/image-1')
  assert.equal(h.page.stage.value,'images')
  assert.equal(h.requests.length,0)
  const generating=h.page.finishImages()
  assert.equal(h.page.stage.value,'description')
  assert.equal(h.page.writingDescription.value,true)
  assert.match(h.requests[0].idea,/100–200字/)
  assert.match(h.requests[0].idea,/不要逐项复述/)
  assert.doesNotMatch(h.requests[0].idea,/\/image-2|联系发起人/)
  assert.match(h.requests[0].idea,/"imageCount":2/)
  h.requests[0].resolve({draft:{...blankDraft,description:'围绕AI应用交流实践经验，欢迎带着实际问题参与讨论。'}})
  await generating
  assert.equal(h.page.writingDescription.value,false)
  const candidate=h.page.descriptionCandidate.value
  const rewriting=h.page.writeDescription()
  assert.equal(h.page.writingDescription.value,true)
  h.requests[1].reject(new Error('生成失败'))
  await rewriting
  assert.equal(h.page.writingDescription.value,false)
  assert.equal(h.page.descriptionCandidate.value,candidate)
  assert.equal(h.page.draft.value.description,before)
  await h.page.acceptDescription()
  assert.match(h.page.draft.value.description,/实践经验/)
  assert.equal(h.page.stage.value,'settings')
  assert.equal(h.page.exchanges.value.length,0)
  const payload=h.page.inputForPublish(h.page.draft.value)
  assert.equal(payload.coverUrl,'/image-2')
  h.lifecycle.unload()
  const next=makePage(t,h.storage)
  await next.lifecycle.show()
  assert.deepEqual(next.page.draft.value.imageUrls,payload.imageUrls)
  assert.equal(next.page.confirmedDescription.value,next.page.draft.value.description)
  assert.equal(next.page.imagesDecided.value,true)
  next.page.moreSettings(true)
  assert.match(next.navigation[0],/optionalOnly=1/)
  assert.deepEqual(next.staged[0][2].imageUrls,payload.imageUrls)
  assert.equal(next.page.previewReady.value,false)
  next.staged[0][4]('saved-draft')
  assert.equal(next.page.stage.value,'preview')
  next.api.managedActivity = async () => ({ ...payload, registrationScope:'unregistered', lifecycle:'draft' })
  await next.lifecycle.show()
  assert.equal(next.page.draft.value.registrationScope,'unregistered')
  const publications = []
  next.api.publishActivity = async id => publications.push(id)
  next.decisions.push(true)
  await next.page.publish()
  assert.deepEqual(publications,['saved-draft'])
})

test('publish requires explicit introduction and image decisions, failed uploads preserve uploaded images', async t => {
  const h=makePage(t)
  await h.lifecycle.show()
  h.page.idea.value='AI交流'; h.page.draft.value=completedDraft()
  let creates=0
  h.api.createActivity=async()=>{creates++;return {id:'unexpected'}}
  await h.page.publish()
  assert.equal(creates,0)
  assert.equal(h.page.stage.value,'images')
  h.wechat.chooseActivityImagePaths=async()=>['one','bad']
  h.wechat.readActivityImage=async path=>{if(path==='bad')throw new Error('读取失败');return {base64:path,mimeType:'image/jpeg'}}
  h.page.cropper.value={open:async()=> 'cropped',cancel(){}}
  let uploads=0
  h.api.uploadCover=async()=>({coverUrl:'/uploaded-'+(++uploads)})
  await h.page.addGatherImages()
  assert.deepEqual(h.page.draft.value.imageUrls,['/uploaded-2'])
  assert.match(h.page.error.value,/已上传的图片已保留/)
})

test('editing a confirmed introduction revokes approval and cannot bypass review via optional settings', async t => {
  const h=makePage(t)
  await h.lifecycle.show()
  h.page.idea.value='AI交流'; h.page.draft.value=completedDraft()
  h.page.confirmedDescription.value=h.page.draft.value.description;h.page.imagesDecided.value=true
  h.page.inputDescription({detail:{value:'尚未确认的新介绍'}})
  assert.equal(h.page.stage.value,'description')
  h.page.moreSettings(true)
  assert.equal(h.navigation.length,0)
  await h.page.publish()
  assert.equal(h.page.previewReady.value,false)
  await h.page.acceptDescription()
  h.page.moreSettings(true)
  assert.equal(h.navigation.length,1)
  assert.equal(h.staged[0][2].description,'尚未确认的新介绍')
})

test('returning from saved optional settings refreshes the exact server draft before reviewing', async t => {
  const h=makePage(t)
  await h.lifecycle.show()
  h.page.idea.value='AI交流'; h.page.draft.value=completedDraft();h.page.createdId.value='saved'
  h.page.imagesDecided.value=true;h.page.settingsDecision.value='saved'
  const record={...completedDraft(),title:'服务端草稿',description:'更新后的介绍',lifecycle:'draft',capacity:16,imageUrls:['/saved-cover'],coverUrl:'/saved-cover',coverSourceUrl:'/original',locationLatitude:23.1,locationLongitude:113.2,questions:[]}
  h.api.managedActivity=async()=>record
  await h.lifecycle.show()
  assert.equal(h.page.draft.value.capacity,16)
  assert.deepEqual(h.page.draft.value.imageUrls,['/saved-cover'])
  assert.equal(h.page.draft.value.latitude,23.1)
  assert.equal(h.page.draft.value.description,'更新后的介绍')
  assert.equal(h.page.stage.value,'description')
  await h.page.acceptDescription()
  assert.equal(h.page.confirmedDescription.value,'更新后的介绍')
  assert.equal(h.page.imagesDecided.value,true)
  assert.equal(h.page.stage.value,'preview')
})
