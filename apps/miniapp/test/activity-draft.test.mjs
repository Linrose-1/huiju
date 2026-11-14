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

function loadDialog() {
  const source = readFileSync(new URL('../src/services/gather-dialog.ts', import.meta.url), 'utf8')
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
  const exports = {}
  new Function('exports', code)(exports)
  return exports
}

const blankDraft = {
  title:'聚会',description:'讨论社群运营',location:null,startsAt:null,endsAt:null,registrationDeadline:null,
  capacity:null,feeType:null,feeAmountCents:null,questions:[]
}
function makePage(t, storage = new Map()) {
  const session = reactive({ token:'token', epoch:1, member:{id:'a'} })
  const requests = [], navigation = [], lifecycle = {}, decisions = []
  const api = { interpretActivityReply: async () => ({ draft:{...blankDraft,title:null,description:null}, nextQuestion:null }), generateActivityDraft: idea => new Promise((resolve, reject) => requests.push({idea, resolve, reject})) }
  const uni = {
    setStorageSync:(k,v) => storage.set(k,v), getStorageSync:k => storage.get(k), removeStorageSync:k => storage.delete(k),
    hideKeyboard() {}, pageScrollTo() {}, showModal(options) {
      const choice = decisions.shift()
      if (choice === undefined) throw new Error('unexpected modal: ' + options.title)
      if (choice === null) options.fail()
      else options.success({confirm:choice,cancel:!choice})
    }
  }
  const deps = {
    '@dcloudio/uni-app': {onShow:fn=>lifecycle.show=fn,onUnload:fn=>lifecycle.unload=fn,onHide:fn=>lifecycle.hide=fn},
    '@/services/gather-dialog':loadDialog(), '@/services/presentation':{}, '@/services/api/environment':{API_BASE_URL:'local'},
    '@/services/api':{api, errorMessage:e=>e.message, ApiError:class extends Error {}}, '@/services/ai-draft':{},
    '@/services/navigation':{ routes:{manage:'/manage'}, requireProfile: async()=>true, navigate:url=>navigation.push(url) },
    '@/stores/session':{useSessionStore:()=>session}
  }
  const page = {}, scope = effectScope()
  scope.run(() => new Function('require','exports','uni', script('../src/pages/assistant/activity-draft.vue',
    'generate,idea,busy,error,draft,answer,question,publish,createdId,reply,chooseStarter,message,sendMessage,writeAnswer,custom,exchanges,manual,options,useManual'))(name=>deps[name]||require(name),page,uni))
  t.after(()=>{lifecycle.unload();scope.stop()})
  return {page,session,api,requests,navigation,lifecycle,decisions,storage}
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
  requests[1].resolve({draft:blankDraft})
  await stale
  assert.equal(page.draft.value,null)
})

test('complete conversation produces preview, publishes only after confirmation and retries same draft', async t=>{
  const {page,requests,lifecycle,decisions,api,navigation}=makePage(t)
  await lifecycle.show()
  page.idea.value='明天下午讨论社群运营'
  const pending=page.generate()
  requests[0].resolve({draft:blankDraft})
  await pending
  assert.equal(page.question.value.field,'time')
  await page.answer('14:00–16:00',true)
  assert.equal(page.question.value.field,'location')
  await page.answer('线上聚会',true)
  await page.answer('报名后发会议链接',true)
  await page.answer('免费',true)
  await page.answer('群内联系发起人')
  assert.equal(page.question.value,null)
  let creates=0, publishes=0
  api.createActivity=async input=>{creates++;assert.equal(input.location,'线上聚会 · 报名后发会议链接');return {id:'existing'}}
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
})

test('compound text can supply place, fee and capacity in one turn, contact stays local',async t=>{
  const {page,requests,lifecycle,decisions,api}=makePage(t)
  await lifecycle.show()
  page.idea.value='明天讲社群运营'
  const pending=page.generate()
  requests[0].resolve({draft:blankDraft})
  await pending
  await page.answer('14:00–16:00',true)
  const input='在创客厅，免费，限20人'
  const calls=[]
  api.interpretActivityReply=async(...args)=>{
    calls.push(args)
    return {draft:{...blankDraft,title:null,description:null,location:'创客厅',feeType:'free',capacity:20}}
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

test('restore is opt-in and modal failure keeps the saved draft until the choice is made',async t=>{
  const first=makePage(t)
  await first.lifecycle.show()
  first.page.idea.value='上次未提交的想法'
  first.lifecycle.unload()
  const second=makePage(t,first.storage)
  second.decisions.push(null,true)
  await second.lifecycle.show()
  assert.equal(second.page.idea.value,'')
  assert.equal(second.storage.size,1)
  await second.lifecycle.show()
  assert.equal(second.page.idea.value,'上次未提交的想法')
  second.lifecycle.unload()
  const third=makePage(t,first.storage)
  third.decisions.push(false)
  await third.lifecycle.show()
  assert.equal(third.page.idea.value,'')
  assert.equal(third.storage.size,0)
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
  requests[0].resolve({ draft: blankDraft })
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

test('model can ask about venue before time, then tailor its next card to an online meeting', async t => {
  const { page, requests, lifecycle, api } = makePage(t)
  await lifecycle.show()
  page.idea.value = '明天聊 AI'
  const pending = page.generate()
  requests[0].resolve({ draft:blankDraft,
    nextQuestion:{field:'location',prompt:'同行们准备在哪里交流 AI？',options:['线上聚会','行业园区']} })
  await pending
  assert.equal(page.question.value.prompt, '同行们准备在哪里交流 AI？')
  const calls = []
  api.interpretActivityReply = async (...args) => {
    calls.push(args)
    return {draft:{...blankDraft,title:null,description:null},
      nextQuestion:calls.length === 1 ? {field:'joining',prompt:'大家怎样进入这次线上交流？',options:['填写会议链接','报名后发会议链接','自己填写']}
        : {field:'fee',prompt:'明天的 AI 沙龙如何收费？',options:['免费参与','收费']} }
  }
  await page.answer('线上聚会',true)
  assert.equal(calls[0][4].known.find(item=>item.field==='location').value,'线上聚会')
  assert.equal(calls[0][4].recent.at(-1).prompt,'同行们准备在哪里交流 AI？')
  assert.deepEqual(page.options.value,['填写会议链接','报名后发会议链接'])
  await page.answer('填写会议链接',true)
  assert.equal(page.custom.value,true)
  assert.equal(calls.length,1)
  await page.answer('报名后发腾讯会议链接，免费，最多十人')
  assert.equal(page.draft.value.location,'线上聚会 · 报名后发腾讯会议链接')
  assert.equal(page.draft.value.feeType,'free')
  assert.equal(page.draft.value.capacity,10)
  assert.equal(page.question.value.field,'time')
})

test('AI outage preserves answers and offers local completion', async t => {
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
  assert.equal(page.manual.value,true)
  await page.answer('14:00–16:00',true)
  assert.equal(calls,1)
  await page.answer('创客厅')
  assert.equal(page.draft.value.location,'创客厅')
  assert.equal(calls,1)
})
test('a clarification without a patch remains in history and survives opt-in restore', async t => {
  const first=makePage(t)
  const {page,lifecycle,requests,api}=first
  await lifecycle.show()
  page.idea.value='明天下午的 AI 聚会'
  const pending=page.generate()
  requests[0].resolve({draft:blankDraft,nextQuestion:{field:'time',prompt:'想几点开始？',options:['14:00–16:00']}})
  await pending
  api.interpretActivityReply=async(...args)=>{
    assert.equal(args[4].known.some(f=>f.field==='time'),false)
    assert.ok(args[4].pending.includes('time'))
    return {draft:{...blankDraft,title:null,description:null},nextQuestion:{field:'time',prompt:'大家下班时间不同，傍晚哪段更合适？',options:['18:00–20:00','19:00–21:00']}}
  }
  await page.answer('等大家下班以后')
  assert.equal(page.exchanges.value.at(-1).answer,'等大家下班以后')
  assert.equal(page.reply.value,'')
  assert.equal(page.question.value.prompt,'大家下班时间不同，傍晚哪段更合适？')
  lifecycle.unload()
  const second=makePage(t,first.storage)
  second.decisions.push(true)
  await second.lifecycle.show()
  assert.deepEqual(second.page.question.value,page.question.value)
  for (const [key,raw] of first.storage) {
    const saved=JSON.parse(raw)
    delete saved.modelCard
    delete saved.manual
    saved.remaining = 0
    first.storage.set(key,JSON.stringify(saved))
  }
  const legacy=makePage(t,first.storage)
  legacy.decisions.push(true)
  await legacy.lifecycle.show()
  assert.equal(legacy.page.question.value.field,'time')
  let followups = 0
  legacy.api.interpretActivityReply = async () => {
    followups++
    return { draft:{...blankDraft,title:null,description:null}, nextQuestion:null }
  }
  await legacy.page.answer('15:00–17:00',true)
  assert.equal(followups,1)
  assert.equal(legacy.page.manual.value,false)
})
