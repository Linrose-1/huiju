import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { URL } from 'node:url'
import ts from 'typescript'

const require = createRequire(import.meta.url)
const { reactive, effectScope } = require('vue')

function script(path, exported) {
  const source = readFileSync(new URL(path, import.meta.url), 'utf8').match(/<script setup lang="ts">([\s\S]*?)<\/script>/)[1]
  return ts.transpileModule(source + `\nexport { ${exported} };`, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
}

function draftStore() {
  const source = readFileSync(new URL('../src/services/ai-draft.ts', import.meta.url), 'utf8')
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
  const module = { exports: {} }
  new Function('require', 'module', 'exports', code)(require, module, module.exports)
  return module.exports
}

test('AI draft input locks duplicate requests, preserves input on failure and stages only current identity', async t => {
  const staged = draftStore()
  const session = reactive({ token: 'token-a', epoch: 1, member: { id: 'member-a' } })
  const requests = [], navigation = []
  let show
  const deps = {
    '@dcloudio/uni-app': { onShow(fn) { show = fn }, onUnload() {} },
    '@/services/api': { api: { generateActivityDraft: idea => new Promise((resolve, reject) => requests.push({ idea, resolve, reject })) }, errorMessage: e => e.message, ApiError: class extends Error {} },
    '@/services/ai-draft': staged,
    '@/services/navigation': { routes: { activityDraft: '/pages/assistant/activity-draft', editor: '/pages/activity/editor' }, requireProfile: async () => true, navigate: url => navigation.push(url), loginPage() {} },
    '@/stores/session': { useSessionStore: () => session }
  }
  const page = {}, scope = effectScope()
  scope.run(() => new Function('require', 'exports', script('../src/pages/assistant/activity-draft.vue', 'generate, idea, busy, error, checking'))(name => deps[name] || require(name), page))
  t.after(() => scope.stop())
  await show()
  page.idea.value = '  举办一场园区分享会  '
  const failed = page.generate()
  await page.generate()
  assert.equal(requests.length, 1)
  assert.equal(requests[0].idea, '举办一场园区分享会')
  requests[0].reject(new Error('网络中断'))
  await failed
  assert.equal(page.idea.value, '  举办一场园区分享会  ')
  assert.equal(page.error.value, '网络中断')
  const stale = page.generate()
  session.epoch++
  requests[1].resolve({ draft: { title: '旧草稿' } })
  await stale
  assert.equal(staged.takeActivityDraft('member-a', 1), null)
  assert.deepEqual(navigation, [])
  const current = page.generate()
  requests[2].resolve({ draft: { title: '新草稿' } })
  await current
  assert.deepEqual(navigation, ['/pages/activity/editor?aiDraft=1'])
  assert.deepEqual(staged.takeActivityDraft('member-a', 2), { title: '新草稿' })
})

test('editor applies explicit AI fields but requires a fee choice when unknown', t => {
  const session = reactive({ token: 'token-a', epoch: 1, member: { id: 'member-a' } })
  const deps = {
    '@dcloudio/uni-app': { onLoad(fn) { fn({ aiDraft: '1' }) }, onShow() {}, onUnload() {} },
    '@/services/api': { api: {}, errorMessage: e => e.message, ApiError: class extends Error {} },
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
