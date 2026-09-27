import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { setImmediate } from 'node:timers/promises'
import ts from 'typescript'
import { URL } from 'node:url'
const require = createRequire(import.meta.url)
const { reactive, effectScope } = require('vue')
function compile(path, exports, deps, uni = {}) {
  const file = readFileSync(new URL(path, import.meta.url), 'utf8')
  const source = path.endsWith('.vue') ? file.match(/<script setup lang="ts">([\s\S]*?)<\/script>/)[1] : file
  const code = ts.transpileModule(source + (exports ? '\nexport { ' + exports + ' };' : ''), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
  const out = {}
  new Function('require', 'exports', 'uni', code)(name => deps[name] || (name.endsWith('.vue') ? {} : require(name)), out, uni)
  return out
}
const cardHelpers = compile('../src/services/member-card.ts', '', {})
function deferred() { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no }); return { promise, resolve, reject } }
function harness(t, pageName, names) {
  const member = { displayName: '甲', memberNumber: '001', avatarUrl: '/a.png', boundPhone: '13800000001', profileComplete: true }
  const session = reactive({ token: 'a', epoch: 0, member })
  const refreshes = [], cards = [], details = [], settings = [], saves = [], namesSaved = [], toasts = [], hooks = {}
  const queue = list => () => { const call = deferred(); list.push(call); return call.promise }
  const deps = {
    '@dcloudio/uni-app': Object.fromEntries(['onShow', 'onHide', 'onLoad', 'onUnload'].map(name => [name, fn => { hooks[name] = fn }])),
    '@/stores/session': { useSessionStore: () => session },
    '@/services/api': { api: { memberCard: queue(cards), profileDetails: queue(details), cardSettings: queue(settings), saveCardSettings: queue(saves), saveProfileDetails: queue(saves), profile: queue(namesSaved) }, refreshMember: queue(refreshes), errorMessage: e => e.message, ApiError: class extends Error {} },
    '@/services/member-card': cardHelpers, '@/services/wechat': {}, '@/services/navigation': {}, '@/services/api/environment': {}
  }
  const scope = effectScope()
  let page
  scope.run(() => { page = compile('../src/pages/member/' + pageName + '.vue', names, deps, { showToast: v => toasts.push(v) }) })
  t.after(() => scope.stop())
  return { page, session, hooks, refreshes, cards, details, settings, saves, namesSaved, toasts, member }
}
const privateDetails = { realName: '真实姓名', email: 'private@example.com', hometown: '深圳', bio: '简介', resources: '资源', needs: '需求' }
test('preview defaults to avatar/name only and whitelists independently selected fields', () => {
  const member = { profileComplete: true, avatarUrl: '/a.png', displayName: '甲', boundPhone: '13800000001', memberNumber: '001', inviteCode: 'private-invite' }
  const settings = cardHelpers.emptySettings()
  assert.deepEqual(cardHelpers.previewCard(member, privateDetails, settings), { avatarUrl: '/a.png', displayName: '甲' })
  for (const field of cardHelpers.cardFields) {
    const card = cardHelpers.previewCard(member, privateDetails, { ...settings, [field.setting]: true })
    assert.deepEqual(Object.keys(card).sort(), ['avatarUrl', 'displayName', field.key].sort())
  }
})
test('direct card route blocks incomplete profiles and discards a late card after account change', async t => {
  const h = harness(t, 'card', 'load,card,needsProfile,error')
  h.hooks.onLoad({ id: 'member-id' }); h.hooks.onShow()
  h.refreshes[0].resolve({ ...h.member, profileComplete: false }); await setImmediate()
  assert.equal(h.cards.length, 0); assert.equal(h.page.needsProfile.value, true)
  const load = h.page.load(); h.refreshes[1].resolve(h.member); await setImmediate()
  assert.equal(h.cards.length, 1)
  h.session.token = ''; h.session.member = null
  h.cards[0].resolve({ displayName: '迟到的私密名片', boundPhone: 'private' }); await load
  assert.equal(h.page.card.value, null); assert.equal(h.page.needsProfile.value, true)
})
test('settings save is locked and account changes erase private draft and preview', async t => {
  const h = harness(t, 'card-settings', 'load,save,details,settings,preview,card,loaded')
  const load = h.page.load(); h.refreshes[0].resolve(h.member); h.details[0].resolve(privateDetails); h.settings[0].resolve(cardHelpers.emptySettings()); await load
  h.page.settings.showEmail = true; h.page.preview.value = true
  assert.equal(h.page.card.value.email, 'private@example.com')
  const save = h.page.save(); await h.page.save(); assert.equal(h.saves.length, 1)
  h.session.token = ''; h.session.member = null
  assert.equal(h.page.details.value, null); assert.equal(h.page.preview.value, false); assert.equal(h.page.settings.showEmail, false)
  h.saves[0].resolve({}); await save; assert.equal(h.toasts.length, 0)
})
test('profile explains partial save and does not continue saving under a changed account', async t => {
  const h = harness(t, 'profile', 'load,save,name,form,actionError')
  const load = h.page.load(); h.refreshes[0].resolve(h.member); h.details[0].resolve(privateDetails); await load
  h.page.name.value = '新名字'
  const save = h.page.save(); h.saves[0].resolve(privateDetails); await setImmediate(); h.namesSaved[0].reject(new Error('网络失败')); await save
  assert.match(h.page.actionError.value, /补充资料已保存，用户名称未保存/)
  const again = h.page.save(); h.session.token = ''; h.session.member = null; h.saves[1].resolve(privateDetails); await again
  assert.equal(h.namesSaved.length, 1); assert.equal(h.page.form.email, '')
})
test('avatar file read cannot upload under a replacement account', async () => {
  const session = { token: 'a', epoch: 0 }, uploads = []
  let read
  const service = compile('../src/services/wechat/index.ts', '', {
    '@/services/api': { api: { avatar: (...args) => uploads.push(args) }, ApiError: class extends Error {} },
    '@/stores/session': { useSessionStore: () => session }, '@/services/api/environment': {}
  }, { getFileSystemManager: () => ({ readFile: options => { read = options } }) })
  const upload = service.uploadAvatar('/tmp/avatar.png')
  session.token = 'b'; read.success({ data: 'iVBORtest' })
  await assert.rejects(upload); assert.equal(uploads.length, 0)
})


test('new member routes keep activity as the cold-start page', () => {
  const config = JSON.parse(readFileSync(new URL('../src/pages.json', import.meta.url), 'utf8'))
  assert.equal(config.pages[0].path, 'pages/activity/index')
  for (const path of ['pages/member/profile', 'pages/member/card-settings', 'pages/member/card']) {
    assert.equal(config.pages.filter(page => page.path === path).length, 1)
  }
})
