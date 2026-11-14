import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readFileSync } from 'node:fs'
import { URL } from 'node:url'
import ts from 'typescript'

const source = readFileSync(new URL('../src/services/gather-dialog.ts', import.meta.url), 'utf8')
const methods = {}
new Function('exports', ts.transpileModule(source, {compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText)(methods)
const {createGatherDraft,applyGatherAnswer,nextGatherQuestion} = methods
const now = new Date('2026-11-14T02:00:00Z')
const model = {title:'AI 聚会',description:'交流空间运营经验',startsAt:null,endsAt:null,location:'猩球创客',feeType:null,capacity:null,feeAmountCents:null,questions:[],registrationDeadline:null}

test('one contextual reply supplies the time range, fee and capacity while preserving previous details', () => {
  const before=createGatherDraft('本周六下午在猩球创客',model,now)
  assert.equal(before.date,'2026-11-14')
  assert.equal(nextGatherQuestion(before,now).field,'time')
  const after=applyGatherAnswer(before,'time','三点到五点，免费，最多 20 人',now)
  assert.equal(after.startsAt,'2026-11-14T15:00:00+08:00')
  assert.equal(after.endsAt,'2026-11-14T17:00:00+08:00')
  assert.equal(after.capacity,20)
  assert.equal(after.location,model.location)
  assert.equal(after.feeType,'free')
  assert.deepEqual(methods.gatherFacts(before, after), [
    '时间 2026-11-14 15:00–17:00', '费用 免费', '人数 最多 20 人'
  ])
  assert.deepEqual(methods.gatherFacts(after, {...after, startsAt: new Date(after.startsAt).toISOString()}), [])
  assert.equal(nextGatherQuestion(after,now).field,'contact')
  assert.equal(nextGatherQuestion(applyGatherAnswer(after,'contact','向值班室咨询',now),now),null)
  assert.equal(before.feeType,null)
})
test('opening facts omit unknown fee and capacity; cross-day times and later changes remain explicit', () => {
  const first = createGatherDraft('下周六', model, now)
  assert.deepEqual(methods.gatherFacts(null, first), ['时间 2026-11-21', '地点 猩球创客', '主题 AI 聚会', '活动介绍已整理'])
  const second = {...first, startsAt:'2026-11-21T21:00:00+08:00', endsAt:'2026-11-22T01:00:00+08:00', capacity:12}
  assert.deepEqual(methods.gatherFacts(first, second), ['时间 2026-11-21 21:00–2026-11-22 01:00', '人数 最多 12 人'])
  const last = applyGatherAnswer(second, 'capacity', '人数不限，每人19.9元', now)
  assert.deepEqual(methods.gatherFacts(second, last), ['费用 19.9 元/人', '人数 不限'])
})
test('paid registration asks for the amount, missing time never silently uses a suggested slot', () => {
  const before=createGatherDraft('下周六上午',model,now)
  assert.equal(before.date,'2026-11-21')
  assert.equal(before.startsAt,null)
  const timed=applyGatherAnswer(before,'time','09:00–11:00',now)
  const paid=applyGatherAnswer(timed,'fee','收费',now)
  assert.equal(paid.feeAmountCents,null)
  assert.equal(nextGatherQuestion(paid,now).field,'amount')
  assert.equal(applyGatherAnswer(paid,'amount','19.9',now).feeAmountCents,1990)
})
test('longer relative dates and afternoon clock notation retain their meaning', () => {
  assert.equal(createGatherDraft('下下周二上午',model,now).date,'2026-11-24')
  const before=createGatherDraft('大后天下午',model,now)
  assert.equal(before.date,'2026-11-17')
  const timed=applyGatherAnswer(before,'time','下午3:00到5:00',now)
  assert.equal(timed.startsAt,'2026-11-17T15:00:00+08:00')
  assert.equal(timed.endsAt,'2026-11-17T17:00:00+08:00')
  const paid=applyGatherAnswer(timed,'fee','不是免费，每人50元',now)
  assert.equal(paid.feeType,'paid')
  assert.equal(paid.feeAmountCents,5000)
})
test('expired suggested slots allow a new day and suggested prices require selection', () => {
  const late=new Date('2026-11-14T14:30:00Z')
  const before=createGatherDraft('今天下午',model,late)
  const q=nextGatherQuestion(before,late)
  assert.ok(q.options.includes('改到明天'))
  const tomorrow=applyGatherAnswer(before,q.field,'改到明天',late)
  assert.equal(nextGatherQuestion(tomorrow,late).field,'time')
  const paid=applyGatherAnswer(applyGatherAnswer(tomorrow,'time','15:00–17:00',late),'fee','收费',late)
  const prices=nextGatherQuestion(paid,late)
  assert.ok(prices.options.length)
  assert.equal(paid.feeAmountCents,null)
  assert.equal(applyGatherAnswer(paid,prices.field,prices.options[0],late).feeAmountCents,3000)
})
test('only public activity context and the six most recent non-contact turns reach the planner', () => {
  const draft=createGatherDraft('明天下午', model, now)
  draft.consultationContact='private-person'
  draft.location='线上聚会 · https://example.invalid/room-private'
  const turns=Array.from({length:8},(_,i)=>({field:'fee',prompt:'收费吗？',answer:'example-'+i}))
  turns.push({field:'contact',prompt:'联系方式',answer:'private-handle'})
  turns.push({field:'joining',prompt:'怎么加入？',answer:'会议号 123 456 789，口令 abcd'})
  const context=methods.gatherContext(draft,turns)
  assert.equal(context.recent.length,6)
  assert.doesNotMatch(JSON.stringify(context),/private-|room-private|123|456|789|abcd|example-0/)
})

test('online venue needs no joining card; volunteered access and contact stay in their own fields', () => {
  const link = 'https://example.invalid/room'
  const d = createGatherDraft('明天下午三点到五点线上读书会，会议链接 ' + link, {...model, location:'线上聚会',feeType:'free'}, now)
  assert.equal(d.location, '线上聚会 · 会议链接 ' + link)
  assert.equal(nextGatherQuestion(d, now).field,'contact')
  const extra = applyGatherAnswer(d,'contact','报名后在群里通知',now)
  assert.equal(extra.consultationContact,'')
  assert.ok(extra.location.endsWith('报名后在群里通知'))
  assert.equal(nextGatherQuestion(applyGatherAnswer(extra,'contact','咨询请联系班长',now),now),null)
  assert.ok(!JSON.stringify(methods.gatherContext(extra, [])).includes(link))
})
