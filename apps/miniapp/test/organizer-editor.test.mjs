import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { URL } from 'node:url'
import { reactive } from 'vue'
import ts from 'typescript'

const require = createRequire(import.meta.url)
class ApiError extends Error {
  constructor(code, message, status = 0) { super(message); this.code = code; this.status = status }
}
function deferred() {
  let resolve, reject
  const promise = new Promise((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}
const activity = overrides => ({
  id: 'activity-a', title: '交流活动', description: '一起交流', location: '会议室', consultationContact: '组织者微信',
  coverUrl: null, startsAt: '2099-10-01T01:00:12.123Z', endsAt: '2099-10-01T03:00:12.123Z',
  registrationDeadline: '2099-10-01T01:00:12.123Z', capacity: null, feeType: 'free', feeAmountCents: null,
  lifecycle: 'draft', moderation: 'normal', hasRegistrationEver: false, questions: [], ...overrides,
})
const script = readFileSync(new URL('../src/pages/activity/editor.vue', import.meta.url), 'utf8').match(/<script setup lang="ts">([\s\S]*?)<\/script>/)[1]
function harness({ record = activity(), apiOverrides = {}, chooseCover = async () => null, DateClass = Date } = {}) {
  const session = reactive({ token: 'token-a', epoch: 1, member: { id: 'member-a' } })
  const navigations = [], creates = [], updates = [], publishes = []
  let onUnload
  const api = {
    managedActivity: async () => record,
    createActivity: async input => {
      creates.push(input)
      return activity({ ...input, registrationDeadline: input.registrationDeadline || input.startsAt, questions: input.questions.map((question, index) => ({ ...question, id: 'question-' + index })) })
    },
    updateActivity: async (id, input) => { updates.push([id, input]); return activity({ ...input, id, registrationDeadline: input.registrationDeadline || input.startsAt }) },
    publishActivity: async id => { publishes.push(id); return activity({ id, lifecycle: 'published' }) },
    ...apiOverrides,
  }
  const dependencies = {
    '@dcloudio/uni-app': { onLoad() {}, onShow() {}, onUnload(callback) { onUnload = callback } },
    '@/services/api': { api, ApiError, errorMessage: e => e.message },
    '@/services/presentation': { feeDisclaimer: '', activityTimeRangeWeekday: (start,end) => start + ' — ' + end },
    '@/services/wechat': { chooseCover },
    '@/services/api/environment': { mediaUrl: value => value },
    '@/services/navigation': {
      routes: { editor: '/pages/activity/editor', manage: '/pages/activity/manage' },
      requireProfile: async () => true, loginPage() {}, navigate: (...args) => navigations.push(args),
    },
    '@/stores/session': { useSessionStore: () => session },
  }
  const code = ts.transpileModule(script + '\nexport { changeCover, coverUrl, coverError, uploadingCover, load, submit, timestamp, dateParts, id, form, source, questions, locked, editable, started, payload, loading, busy, error, submitError, beginQuestion, saveQuestion, editingQuestion, questionError, removeQuestion, moveQuestion, setCapacityLimited, capacityLimited, startQuestionDrag, moveQuestionDrag, endQuestionDrag, step, changeStep, openDate, confirmDate, clearDeadline, pickerDate, pickerTime, dateField, customDeadline, reviewed, confirmPublish, previewTime, previewQuestionTypes };', {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText
  const page = {}
  new Function('require', 'exports', 'uni', 'Date', code)(
    name => name in dependencies ? dependencies[name] : require(name), page,
    { getSystemInfoSync: () => ({ windowWidth: 375 }), pageScrollTo() {}, showModal: options => options.success({ confirm: true }) }, DateClass,
  )
  function fill() {
    Object.assign(page.form, { title: '交流活动', description: '一起交流', location: '会议室', consultationContact: '组织者微信', startDate: '2099-10-01', startTime: '09:00', endDate: '2099-10-01', endTime: '11:00' })
  }
  return { page, session, api, creates, updates, publishes, navigations, fill, unload: () => onUnload() }
}

test('editor date conversion uses Beijing time independently of local date getters and preserves seconds', () => {
  class NoLocalDate extends Date {
    constructor(...args) { if (args.length > 1) throw new Error('local date constructor'); super(...args) }
    getFullYear() { throw new Error('local year') }
    getMonth() { throw new Error('local month') }
    getDate() { throw new Error('local date') }
    getHours() { throw new Error('local hours') }
    getMinutes() { throw new Error('local minutes') }
  }
  const { page, unload } = harness({ DateClass: NoLocalDate })
  assert.deepEqual(page.dateParts('2030-12-31T18:30:12.123Z'), { date: '2031-01-01', time: '02:30' })
  assert.equal(page.timestamp('2031-01-01', '02:30'), '2030-12-31T18:30:00.000Z')
  assert.equal(page.timestamp('2031-01-01', '02:30', '2030-12-31T18:30:12.123Z'), '2030-12-31T18:30:12.123Z')
  for (const [date, time] of [['2031-02-29', '12:00'], ['2032-02-30', '12:00'], ['2032-13-01', '12:00'], ['2032-01-01', '24:00'], ['2032-01-01', '12:60']]) assert.equal(page.timestamp(date, time), null)
  assert.equal(page.timestamp('2032-02-29', '00:00'), '2032-02-28T16:00:00.000Z')
  unload()
})

test('publish failure keeps created draft and question IDs, retry updates the same draft', async () => {
  const h = harness()
  let attempts = 0
  h.api.publishActivity = async id => { h.publishes.push(id); if (++attempts === 1) throw new ApiError('NETWORK_ERROR', '发布响应丢失'); return activity({ id, lifecycle: 'published' }) }
  await h.page.load()
  h.fill()
  h.page.beginQuestion()
  h.page.editingQuestion.value.prompt = '希望交流什么'
  h.page.saveQuestion()
  await h.page.submit(true)
  assert.equal(h.creates.length, 1)
  assert.equal(h.page.id.value, 'activity-a')
  assert.equal(h.page.questions.value[0].id, 'question-0')
  assert.equal(h.navigations.length, 0)
  assert.equal(h.page.busy.value, false)
  await h.page.submit(true)
  assert.equal(h.creates.length, 1)
  assert.equal(h.updates.length, 1)
  assert.equal(h.updates[0][1].questions[0].id, 'question-0')
  assert.deepEqual(h.publishes, ['activity-a', 'activity-a'])
  assert.deepEqual(h.navigations, [['/pages/activity/manage?id=activity-a', true]])
  h.unload()
})

test('changing identity clears the old form and prevents submitting it as the next member', async () => {
  const h = harness()
  await h.page.load()
  h.fill()
  h.session.member = { id: 'member-b' }
  h.session.token = 'token-b'
  h.session.epoch++
  await h.page.submit()
  assert.equal(h.creates.length, 0)
  assert.equal(h.page.form.title, '')
  assert.match(h.page.error.value, /身份已变更/)
  h.unload()
})

test('late managed-activity response cannot overwrite a newer reload', async () => {
  const first = deferred(), second = deferred()
  let calls = 0
  const h = harness({ apiOverrides: { managedActivity: () => ++calls === 1 ? first.promise : second.promise } })
  h.page.id.value = 'activity-a'
  const oldLoad = h.page.load()
  await Promise.resolve()
  const newLoad = h.page.load()
  await Promise.resolve()
  second.resolve(activity({ title: '最新活动' }))
  await newLoad
  first.resolve(activity({ title: '旧活动' }))
  await oldLoad
  assert.equal(h.page.form.title, '最新活动')
  assert.equal(h.page.loading.value, false)
  h.unload()
})

test('identity switch during create ignores its late result and never publishes under the new session', async () => {
  const pending = deferred(), started = deferred()
  const h = harness({ apiOverrides: { createActivity: () => { started.resolve(); return pending.promise } } })
  await h.page.load()
  h.fill()
  const submission = h.page.submit(true)
  await started.promise
  h.session.token = 'token-b'
  h.session.member = { id: 'member-b' }
  pending.resolve(activity())
  await submission
  assert.equal(h.page.id.value, '')
  assert.equal(h.page.source.value, null)
  assert.equal(h.page.form.title, '')
  assert.equal(h.publishes.length, 0)
  assert.equal(h.navigations.length, 0)
  h.unload()
})

test('unloaded editor ignores pending activity data', async () => {
  const pending = deferred()
  const h = harness({ apiOverrides: { managedActivity: () => pending.promise } })
  h.page.id.value = 'activity-a'
  const loading = h.page.load()
  await Promise.resolve()
  h.unload()
  pending.resolve(activity())
  await loading
  assert.equal(h.page.source.value, null)
  assert.equal(h.page.form.title, '')
})

test('expired draft remains editable so its date can be corrected', async () => {
  const h = harness({ record: activity({ startsAt: '2000-01-01T01:00:00Z', endsAt: '2000-01-01T03:00:00Z', registrationDeadline: '2000-01-01T01:00:00Z' }) })
  h.page.id.value = 'activity-a'
  await h.page.load()
  assert.equal(h.page.editable.value, true)
  assert.equal(h.page.started.value, false)
  h.fill()
  await h.page.submit()
  assert.equal(h.updates[0][1].startsAt, '2099-10-01T01:00:00.000Z')
  h.unload()
})

test('first registration refresh restores locked questions and fee from the server', async () => {
  const h = harness({ record: activity({ lifecycle: 'published', feeType: 'paid', feeAmountCents: 1000, questions: [{ id: 'q1', type: 'single', prompt: '原问题', required: true, options: ['唯一选项'] }] }) })
  h.page.id.value = 'activity-a'
  await h.page.load()
  h.page.form.amount = '20'
  h.page.questions.value[0].prompt = '未保存问题'
  h.api.managedActivity = async () => activity({ lifecycle: 'published', hasRegistrationEver: true, feeType: 'paid', feeAmountCents: 1000, questions: [{ id: 'q1', type: 'single', prompt: '原问题', required: true, options: ['唯一选项'] }] })
  await h.page.load()
  assert.equal(h.page.locked.value, true)
  assert.equal(h.page.form.amount, '10.00')
  assert.equal(h.page.questions.value[0].prompt, '原问题')
  h.page.beginQuestion()
  assert.equal(h.page.questions.value.length, 1)
  const input = h.page.payload()
  assert.equal(input.feeAmountCents, 1000)
  assert.deepEqual(input.questions, [{ id: 'q1', type: 'single', prompt: '原问题', required: true, options: ['唯一选项'] }])
  assert.equal(input.startsAt, '2099-10-01T01:00:12.123Z')
  h.unload()
})


test('moving between basic information and registration preserves unsaved input without writes', async () => {
  const h = harness()
  await h.page.load()
  h.fill()
  h.page.beginQuestion()
  h.page.editingQuestion.value.prompt = '想了解的问题'
  h.page.saveQuestion()
  h.page.changeStep(1)
  assert.equal(h.page.step.value, 1)
  h.page.changeStep(0)
  assert.equal(h.page.form.title, '交流活动')
  assert.equal(h.page.questions.value[0].prompt, '想了解的问题')
  assert.equal(h.creates.length, 0)
  assert.equal(h.publishes.length, 0)
  h.unload()
})

test('date sheet commits only on confirmation and can restore automatic deadline', async () => {
  const h = harness()
  await h.page.load()
  h.fill()
  h.page.openDate('start')
  h.page.pickerDate.value = '2099-10-02'
  assert.equal(h.page.form.startDate, '2099-10-01')
  h.page.confirmDate()
  assert.equal(h.page.form.startDate, '2099-10-02')
  h.page.form.endDate = '2099-10-02'
  h.page.openDate('deadline')
  h.page.pickerDate.value = '2099-09-30'
  h.page.pickerTime.value = '23:59'
  h.page.confirmDate()
  assert.equal(h.page.customDeadline.value, true)
  assert.equal(h.page.payload().registrationDeadline, '2099-09-30T15:59:00.000Z')
  h.page.clearDeadline()
  assert.equal(h.page.customDeadline.value, false)
  assert.equal(h.page.payload().registrationDeadline, null)
  h.unload()
})


test('question sheet isolates unsaved changes, validates choice options and preserves IDs when reordered', async () => {
  const h = harness({ record: activity({ questions: [{ id: 'q1', type: 'short_text', prompt: '原题', required: true, options: null }] }) })
  h.page.id.value = 'activity-a'
  await h.page.load()
  const first = h.page.questions.value[0]
  h.page.beginQuestion(first)
  h.page.editingQuestion.value.prompt = '未保存'
  assert.equal(first.prompt, '原题')
  h.page.editingQuestion.value = null
  h.page.beginQuestion()
  Object.assign(h.page.editingQuestion.value, { prompt: '多选问题', type: 'multiple', options: 'A\nA' })
  h.page.saveQuestion()
  assert.match(h.page.questionError.value, /不同选项/)
  assert.equal(h.page.questions.value.length, 1)
  h.page.editingQuestion.value.options = 'A\nB'
  h.page.saveQuestion()
  h.page.moveQuestion(1, 0)
  assert.equal(h.page.payload().questions[0].prompt, '多选问题')
  assert.equal(h.page.payload().questions[1].id, 'q1')
  h.page.removeQuestion(first.key)
  assert.equal(h.page.questions.value.length, 1)
  h.unload()
})

test('drag reorders only editable questions and locked actions cannot mutate the list', async () => {
  const record = activity({ questions: [{ id: 'q1', type: 'short_text', prompt: '题一', required: true, options: null },{ id: 'q2', type: 'short_text', prompt: '题二', required: false, options: null }] })
  const h = harness({ record })
  h.page.id.value = record.id
  await h.page.load()
  h.page.startQuestionDrag(0, { touches: [{ clientY: 100 }] })
  h.page.moveQuestionDrag({ touches: [{ clientY: 140 }] })
  h.page.endQuestionDrag()
  assert.deepEqual(h.page.questions.value.map(q => q.id), ['q2', 'q1'])
  h.page.source.value.hasRegistrationEver = true
  h.page.moveQuestion(1,0)
  h.page.removeQuestion(h.page.questions.value[0].key)
  h.page.beginQuestion(h.page.questions.value[0])
  assert.equal(h.page.editingQuestion.value, null)
  assert.deepEqual(h.page.questions.value.map(q => q.id), ['q2', 'q1'])
  h.unload()
})

test('capacity controls share the basic form value and do not save an empty explicit limit', async () => {
  const h = harness()
  await h.page.load(); h.fill(); h.page.changeStep(1)
  h.page.setCapacityLimited(true)
  assert.throws(() => h.page.payload(), /人数上限/)
  h.page.form.capacity = '12'
  assert.equal(h.page.payload().capacity, 12)
  h.page.setCapacityLimited(false)
  assert.equal(h.page.payload().capacity, null)
  assert.equal(h.page.form.capacity, '')
  h.unload()
})


test('confirmation preview reads unsaved fields without writes and edits invalidate acknowledgement', async () => {
  const h = harness()
  await h.page.load(); h.fill(); h.page.changeStep(2)
  assert.equal(h.creates.length,0)
  assert.equal(h.publishes.length,0)
  assert.match(h.page.previewTime.value,/2099-10-01T01:00/)
  await h.page.confirmPublish()
  assert.equal(h.creates.length,0)
  assert.match(h.page.submitError.value,/核对/)
  h.page.reviewed.value = true
  h.page.changeStep(0)
  h.page.form.title = '修改后标题'
  assert.equal(h.page.reviewed.value,false)
  h.page.changeStep(2)
  h.page.reviewed.value = true
  await h.page.confirmPublish()
  assert.equal(h.creates[0].title,'修改后标题')
  assert.equal(h.publishes.length,1)
  h.unload()
})

test('confirmation saves a published activity without republishing and clears acknowledgement on identity change', async () => {
  const h = harness({ record: activity({ lifecycle: 'published' }) })
  h.page.id.value='activity-a'
  await h.page.load(); h.page.changeStep(2)
  h.page.reviewed.value=true
  await h.page.confirmPublish()
  assert.equal(h.updates.length,1)
  assert.equal(h.publishes.length,0)
  h.page.reviewed.value=true
  h.session.epoch++
  assert.equal(h.page.reviewed.value,false)
  assert.equal(h.page.step.value,0)
  h.unload()
})


test('cover uploads persist in payload, invalidate review and preserve previous image on failure/cancel', async () => {
  let mode = 'success'
  const h = harness({ chooseCover: async () => mode === 'cancel' ? null : { base64: 'image', mimeType: 'image/png' }, apiOverrides: {
    uploadCover: async () => { if (mode === 'failure') throw new Error('上传失败'); return { coverUrl: '/api/v1/media/covers/new.png' } },
  } })
  await h.page.load(); h.fill(); h.page.reviewed.value = true
  await h.page.changeCover()
  assert.equal(h.page.payload().coverUrl, '/api/v1/media/covers/new.png')
  assert.equal(h.page.reviewed.value, false)
  mode = 'failure'; await h.page.changeCover()
  assert.equal(h.page.coverError.value, '上传失败')
  assert.equal(h.page.coverUrl.value, '/api/v1/media/covers/new.png')
  mode = 'cancel'; await h.page.changeCover()
  assert.equal(h.page.coverError.value, '')
  assert.equal(h.page.busy.value, false)
  await h.page.submit()
  assert.equal(h.creates[0].coverUrl, '/api/v1/media/covers/new.png')
  h.unload()
})

test('cover selection cannot upload after identity changes; late upload cannot repopulate reset form', async () => {
  for (const pendingAt of ['selection', 'upload']) {
    const pending = deferred()
    let uploads = 0
    const h = harness({ chooseCover: () => pendingAt === 'selection' ? pending.promise : Promise.resolve({ base64: 'image', mimeType: 'image/png' }), apiOverrides: {
      uploadCover: () => { uploads++; return pending.promise },
    } })
    await h.page.load()
    const operation = h.page.changeCover()
    await Promise.resolve()
    h.session.epoch++
    pending.resolve(pendingAt === 'selection' ? { base64: 'image', mimeType: 'image/png' } : { coverUrl: '/old.png' })
    await operation
    assert.equal(h.page.coverUrl.value, '')
    assert.equal(h.page.busy.value, false)
    assert.equal(uploads, pendingAt === 'selection' ? 0 : 1)
    h.unload()
  }
})
