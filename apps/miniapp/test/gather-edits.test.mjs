import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { URL } from 'node:url'
import ts from 'typescript'

function load(name, dependencies = {}) {
  const source = readFileSync(new URL('../src/services/' + name + '.ts',import.meta.url),'utf8')
  const {outputText} = ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}})
  const exports = {}
  new Function('exports','require',outputText)(exports,path => dependencies[path])
  return exports
}
const {applyGatherEdit} = load('gather-edits',{'./gather-dialog':load('gather-dialog')})
const draft = {
  title:'读书会', description:'交流读书心得', date:'2027-02-20', period:'下午',
  startsAt:'2027-02-20T15:00:00+08:00', endsAt:'2027-02-20T18:00:00+08:00',
  capacity:20, feeType:'free', feeAmountCents:null, location:null,
  consultationContact:'联系发起人', registrationDeadline:null, questions:[]
}
const unrelatedModel = {...draft, title:'别的主题', description:'别的介绍', location:'不应出现的地点', capacity:1, feeType:'paid', feeAmountCents:100}

test('chat changes attendance during a venue question and again at invitation preview', () => {
  const first = applyGatherEdit(draft,'人数改成 15 人，还是免费','location','chat',unrelatedModel)
  assert.deepEqual(first,{...draft,capacity:15})
  const venue = applyGatherEdit(first,'天河区图书馆','location','card',unrelatedModel)
  const preview = applyGatherEdit(venue,'人数改成 12 人，其他照旧',null,'chat',unrelatedModel)
  assert.deepEqual(preview,{...draft,capacity:12,location:'天河区图书馆'})
})
test('card applies only its own field, chat can change multiple fields', () => {
  const text = '每人 30 元，限 8 人'
  assert.deepEqual(applyGatherEdit(draft,text,'fee','card',unrelatedModel),{...draft,feeType:'paid',feeAmountCents:3000})
  assert.deepEqual(applyGatherEdit(draft,text,'location','chat',unrelatedModel),{...draft,feeType:'paid',feeAmountCents:3000,capacity:8})
})
test('single clock at preview changes only the explicitly edited endpoint', () => {
  assert.deepEqual(applyGatherEdit(draft,'改到下午四点，结束时间照旧',null,'chat',unrelatedModel),{...draft,startsAt:'2027-02-20T16:00:00+08:00'})
  assert.deepEqual(applyGatherEdit(draft,'改为晚上七点半结束',null,'chat'),{...draft,endsAt:'2027-02-20T19:30:00+08:00'})
})
test('changing day preserves time and cross-day span', () => {
  const late = {...draft,endsAt:'2027-02-21T01:00:00+08:00'}
  const next = applyGatherEdit(late,'改到2027年2月21日',null,'chat')
  assert.equal(next.date,'2027-02-21')
  assert.equal(Date.parse(next.startsAt)-Date.parse(late.startsAt),86400000)
  assert.equal(Date.parse(next.endsAt)-Date.parse(late.endsAt),86400000)
})
test('named fields and consultation can be changed directly, including names containing numbers', () => {
  const next = applyGatherEdit(draft,'地点改为五人书屋，标题改成十人谈，咨询方式：联系小李',null,'chat',unrelatedModel)
  assert.deepEqual(next,{...draft,location:'五人书屋',title:'十人谈',consultationContact:'联系小李'})
  assert.deepEqual(applyGatherEdit(next,'人数不限',null,'chat'),{...next,capacity:null})
})
test('adjacent changes and keep clauses are handled independently', () => {
  assert.deepEqual(applyGatherEdit(draft,'地点改为创客厅人数改成15人费用不变',null,'chat'),{...draft,location:'创客厅',capacity:15})
  assert.deepEqual(applyGatherEdit(draft,'可以给我建议吗','location','chat',unrelatedModel),draft)
})
test('a date card moves the day without replacing clock times or other fields', () => {
  const next = applyGatherEdit(draft,'2027年2月21日下午四点，限10人','date','card')
  assert.equal(Date.parse(next.startsAt)-Date.parse(draft.startsAt),86400000)
  assert.equal(Date.parse(next.endsAt)-Date.parse(draft.endsAt),86400000)
  assert.equal(next.capacity,20)
  assert.deepEqual(applyGatherEdit(draft,'报名截止时间改为2027年2月19日下午三点',null,'chat',{...unrelatedModel,registrationDeadline:'2027-02-19T15:00:00+08:00'}),{...draft,registrationDeadline:'2027-02-19T15:00:00+08:00'})
})
test('Chinese fee and previously confirmed amount survive a general fee statement', () => {
  const paid = applyGatherEdit(draft,'每人三十元',null,'chat',unrelatedModel)
  assert.deepEqual(paid,{...draft,feeType:'paid',feeAmountCents:3000})
  assert.deepEqual(applyGatherEdit(paid,'收费',null,'chat',unrelatedModel),paid)
})

test('after 21:00 ask only for the end and accept a choice or a bare clock', () => {
  const partial = {...draft, date:'2099-11-18', period:'晚上', startsAt:'2099-11-18T21:00:00+08:00', endsAt:null}
  const dialog = load('gather-dialog')
  const generated = {field:'time',prompt:'九点开始交流，打算聊到几点？',options:['22:10 结束']}
  assert.deepEqual(dialog.usableModelQuestion(generated, partial), generated)
  const ctx = dialog.gatherContext(partial, [])
  assert.ok(ctx.pending.includes('time'))
  assert.ok(ctx.known.some(row => row.field === 'time' && row.value === '2099-11-18 21:00 开始'))
  for (const text of ['22:00 结束', '晚上十点吧']) {
    assert.deepEqual(applyGatherEdit(partial,text,'time','card'), {...partial,endsAt:'2099-11-18T22:00:00+08:00'})
  }
  const duration = applyGatherEdit(partial,'一个小时', 'time','card')
  assert.equal(duration.startsAt, partial.startsAt)
  assert.equal(Date.parse(duration.endsAt) - Date.parse(duration.startsAt), 3600000)
  const late = {...partial,startsAt:'2099-11-18T23:30:00+08:00'}
  const nextDay = '次日 00:00 结束'
  assert.equal(applyGatherEdit(late,nextDay,'time','card').endsAt,'2099-11-19T00:00:00+08:00')
})
