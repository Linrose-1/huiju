import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { URL } from 'node:url'
import { setImmediate } from 'node:timers/promises'
import ts from 'typescript'
const require = createRequire(import.meta.url)
const vue = require('vue')
const documents = { development: true, terms: { version: 'terms-dev' }, privacy: { version: 'privacy-dev' } }
function page(file, api, session = { token: '', epoch: 0, pendingInvite: '', member: null }, wechat = {}) {
  const hooks = {}, logins = [], navigations = [], toasts = [], consents = []
  const client = { acceptLegal: async value => { consents.push(value) }, ...api }
  const deps = { vue, '@dcloudio/uni-app': Object.fromEntries(['onLoad','onShow','onHide','onUnload'].map(key => [key, fn => { hooks[key] = fn }])),
    '@/stores/session': { useSessionStore: () => session }, '@/services/api': { api: client, refreshMember: async () => session.member, errorMessage: e => e.message },
    '@/services/wechat': { bootstrapIdentity: async () => { logins.push('identify'); if (!session.token) { session.token = 'new'; session.member = { displayName: '', profileComplete: false } } }, uploadAvatar: async () => {}, ...wechat },
    '@/services/api/environment': { LOCAL_TEST: !!wechat.localTestCode },
    '@/services/navigation': { routes: { terms: '/terms', privacy: '/privacy', login: '/login', contentSettings: '/content', activitySearch: '/search' }, navigate: x => navigations.push(x), loginPage: x => navigations.push(x), finishProfile: x => navigations.push(x) } }
  const script = readFileSync(new URL('../src/pages/' + file + '.vue', import.meta.url), 'utf8').match(/<script setup lang="ts">([\s\S]*?)<\/script>/)[1]
  const names = file === 'login/index' ? 'submit,phone,testPhone,avatar,editName,selectedAvatar,name,invite,busy,agreed,documents,error,loadLegal,legalError,remindPhoneConsent' : 'save,ready,error,activityText,assistantText'
  const code = ts.transpileModule(script + '\nexport {' + names + '};', { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
  const exports = {}
  new Function('require','exports','uni',code)(name => deps[name] ?? require(name), exports, { showToast: x => toasts.push(x) })
  return { hooks, state: exports, logins, navigations, toasts, consents, session }
}
test('silent identification and failed legal fetch never imply consent or save profile', async () => {
  let fail = true, profiles = 0
  const h = page('login/index', { legalDocuments: async () => { if (fail) throw new Error('读取失败'); return documents }, profile: async () => { profiles++ } })
  await h.hooks.onLoad({}); await setImmediate()
  assert.equal(h.logins.length, 1); assert.equal(h.consents.length, 0); assert.equal(h.state.agreed.value, false)
  await h.state.submit(); assert.equal(profiles, 0)
  fail = false; await h.state.loadLegal(); await h.state.submit()
  assert.equal(h.consents.length, 0); assert.equal(h.state.agreed.value, false)
  h.state.agreed.value = true; h.state.editName({ detail: { value: '新名称' } }); await h.state.submit()
  assert.deepEqual(h.consents, [{ termsVersion: 'terms-dev', privacyVersion: 'privacy-dev' }]); assert.equal(profiles, 1)
})

test('local completion binds the selected visitor phone credential after explicit consent', async () => {
  const phones = []
  const h = page('login/index', { legalDocuments: async () => documents, phone: async code => phones.push(code) }, undefined, { localTestCode: () => 'huiju-local-test:visitor' })
  await h.hooks.onLoad({}); await setImmediate()
  h.state.testPhone(); await setImmediate()
  assert.deepEqual(phones, [])
  h.state.agreed.value = true
  h.state.testPhone(); await setImmediate()
  assert.deepEqual(phones, ['huiju-local-test:visitor'])
  assert.equal(h.consents.length, 1)
})

test('leaving login discards late document response and never preselects consent', async () => {
  let resolve
  const h = page('login/index', { legalDocuments: () => new Promise(r => { resolve = r }) })
  await h.hooks.onLoad({}); h.hooks.onUnload(); resolve(documents); await setImmediate()
  assert.equal(h.state.documents.value, null); assert.equal(h.state.agreed.value, false)
})

for (const edit of ['新昵称', '', '原昵称']) {
  test(`late identity refresh preserves input including clearing or returning to original: ${edit}`, async () => {
    const session = vue.reactive({ token: 'visitor', epoch: 0, pendingInvite: '', member: { displayName: '原昵称', profileComplete: false } })
    let resolve
    const h = page('login/index', { legalDocuments: async () => documents }, session, { bootstrapIdentity: () => new Promise(r => { resolve = r }) })
    const loading = h.hooks.onLoad({})
    h.state.editName({ detail: { value: '临时输入' } }); h.state.editName({ detail: { value: edit } })
    session.member.displayName = '接口旧昵称'; resolve(); await loading
    assert.equal(h.state.name.value, edit)
  })
}

test('unloaded or switched identity cannot apply an old refresh name', async () => {
  for (const kind of ['unload', 'switch']) {
    const session = vue.reactive({ token: 'first', epoch: 0, pendingInvite: '', member: { displayName: '初始', profileComplete: false } })
    let resolve
    const h = page('login/index', { legalDocuments: async () => documents }, session, { bootstrapIdentity: () => new Promise(r => { resolve = r }) })
    const loading = h.hooks.onLoad({})
    if (kind === 'unload') h.hooks.onUnload()
    else { session.token = 'second'; session.epoch++ }
    h.state.editName({ detail: { value: '保留的输入' } }); session.member.displayName = '旧返回'; resolve(); await loading
    assert.equal(h.state.name.value, '保留的输入'); assert.equal(h.navigations.length, 0)
  }
})

test('complete member returns without form writes or a new agreement', async () => {
  const session = { token: 'member', epoch: 0, pendingInvite: '', member: { displayName: '会员', profileComplete: true } }
  const h = page('login/index', { legalDocuments: async () => documents, profile: () => assert.fail('must not save') }, session)
  await h.hooks.onLoad({ returnTo: '/search' }); await setImmediate()
  assert.deepEqual(h.navigations, ['/search']); assert.equal(h.consents.length, 0); assert.equal(h.state.agreed.value, false)
})

test('completion consumes encoded WeChat return context once and rejects malformed encoding', async () => {
  const target = '/pages/registration/form?id=activity&edit=1'
  for (const [input, expected] of [[encodeURIComponent(target), target], [target, target], ['%E0%A4%A', '']]) {
    const session = { token: 'member', epoch: 0, pendingInvite: '', member: { displayName: '会员', profileComplete: true } }
    const h = page('login/index', { legalDocuments: async () => documents }, session)
    await h.hooks.onLoad({ returnTo: input })
    assert.deepEqual(h.navigations, [expected])
    assert.equal(h.consents.length, 0)
  }
})

test('avatar choice remains local before consent even when silently identified', async () => {
  const uploads = []
  const h = page('login/index', { legalDocuments: async () => documents }, undefined, { uploadAvatar: async path => uploads.push(path) })
  await h.hooks.onLoad({}); await h.state.avatar({ detail: { avatarUrl: 'wxfile://selected' } })
  assert.equal(h.state.selectedAvatar.value, 'wxfile://selected'); assert.equal(uploads.length, 0); assert.equal(h.consents.length, 0)
  await h.state.submit(); assert.match(h.state.error.value, /同意/); assert.equal(uploads.length, 0)
})

test('phone CTA explains missing agreement without consent, phone binding or another identity request', async () => {
  let resolveLegal, binds = 0
  const h = page('login/index', { legalDocuments: () => new Promise(resolve => { resolveLegal = resolve }), phone: async () => { binds++ } })
  await h.hooks.onLoad({})
  const identities = h.logins.length
  h.state.remindPhoneConsent()
  assert.match(h.toasts.at(-1).title, /协议尚未就绪/)
  resolveLegal(documents); await setImmediate()
  h.state.remindPhoneConsent()
  assert.match(h.toasts.at(-1).title, /请先阅读并同意用户协议和隐私政策/)
  assert.equal(h.state.agreed.value, false)
  assert.equal(h.consents.length, 0); assert.equal(binds, 0); assert.equal(h.logins.length, identities)
  const prompts = h.toasts.length
  h.state.busy.value = true; h.state.remindPhoneConsent()
  assert.equal(h.toasts.length, prompts)
  h.state.busy.value = false; h.hooks.onUnload(); h.state.remindPhoneConsent()
  assert.equal(h.toasts.length, prompts)
})

test('phone refusal or missing consent never binds a number or records agreement', async () => {
  let binds = 0
  const h = page('login/index', { legalDocuments: async () => documents, phone: async () => { binds++ } })
  await h.hooks.onLoad({}); await h.state.phone({ detail: { errMsg: 'getPhoneNumber:fail user deny' } })
  assert.match(h.state.error.value, /授权未完成/)
  await h.state.phone({ detail: { code: 'phone-code' } }); assert.match(h.state.error.value, /同意/)
  assert.equal(binds, 0); assert.equal(h.consents.length, 0)
})

test('explicit phone and form actions record agreement once, retain drafts and native final nickname', async () => {
  const session = { token: 'visitor', epoch: 0, pendingInvite: '', member: { displayName: '', boundPhone: null, avatarUrl: null, profileComplete: false } }, calls = []
  const h = page('login/index', {
    legalDocuments: async () => documents,
    phone: async code => { calls.push(['phone', code]); session.member.boundPhone = '13800000000' },
    profile: async name => { calls.push(['profile', name]); session.member.displayName = name; session.member.profileComplete = !!session.member.avatarUrl && !!session.member.boundPhone }
  }, session, { uploadAvatar: async path => { calls.push(['avatar', path]); session.member.avatarUrl = '/avatar.png' } })
  await h.hooks.onLoad({ returnTo: '/activity' }); h.state.editName({ detail: { value: '手动名称' } })
  await h.state.avatar({ detail: { avatarUrl: 'wxfile://draft' } }); h.state.agreed.value = true
  await h.state.phone({ detail: { code: 'phone-code' } })
  assert.equal(h.state.name.value, '手动名称'); assert.equal(h.state.selectedAvatar.value, 'wxfile://draft'); assert.equal(h.navigations.length, 0)
  await h.state.submit({ detail: { value: { displayName: '微信最终昵称' } } })
  assert.deepEqual(calls, [['phone', 'phone-code'], ['avatar', 'wxfile://draft'], ['profile', '微信最终昵称']])
  assert.equal(h.consents.length, 1); assert.deepEqual(h.navigations, ['/activity'])
})

test('failed avatar upload keeps selection for manual retry and prevents later profile write', async () => {
  const session = { token: 'visitor', epoch: 0, pendingInvite: '', member: { displayName: '昵称', profileComplete: false } }
  let fail = true, profiles = 0
  const h = page('login/index', { legalDocuments: async () => documents, profile: async () => { profiles++; session.member.profileComplete = true } }, session,
    { uploadAvatar: async () => { if (fail) throw new Error('头像上传失败') } })
  await h.hooks.onLoad({}); await h.state.avatar({ detail: { avatarUrl: 'wxfile://draft' } }); h.state.agreed.value = true
  await h.state.submit(); assert.equal(h.state.selectedAvatar.value, 'wxfile://draft'); assert.equal(profiles, 0)
  fail = false; await h.state.submit(); assert.equal(profiles, 1); assert.equal(h.consents.length, 1); assert.equal(h.navigations.length, 1)
})

test('duplicate actions share a page lock and late consent after leaving cannot bind phone', async () => {
  let resolve, binds = 0
  const h = page('login/index', { legalDocuments: async () => documents, acceptLegal: () => new Promise(r => { resolve = r }), phone: async () => { binds++ } })
  await h.hooks.onLoad({}); h.state.agreed.value = true
  const first = h.state.phone({ detail: { code: 'first' } }); await h.state.phone({ detail: { code: 'second' } })
  h.hooks.onUnload(); resolve(); await first; assert.equal(binds, 0); assert.equal(h.navigations.length, 0)
})

test('session expiry resets agreement and late legal reload can be retried', async () => {
  const session = vue.reactive({ token: 'visitor', epoch: 0, pendingInvite: '', member: { displayName: '名称', profileComplete: false } })
  let reads = 0
  const h = page('login/index', { legalDocuments: async () => { reads++; return documents }, profile: async () => { session.token = ''; session.epoch++; throw new Error('登录已失效') } }, session)
  await h.hooks.onLoad({}); h.state.agreed.value = true; await h.state.submit(); await setImmediate()
  assert.equal(reads, 2); assert.equal(h.state.agreed.value, false); assert.equal(h.state.documents.value.terms.version, 'terms-dev')
})

test('member without content permission cannot edit; revocation error preserves draft without success', async () => {
  const session = vue.reactive({ token: 'member', epoch: 0 })
  let enabled = false, calls = 0
  const h = page('platform/content', { platformContent: async () => ({ activityText: '活动', assistantText: '助手', canEdit: enabled }), savePlatformContent: async () => { calls++; throw new Error('权限已撤销') } }, session)
  await h.hooks.onShow(); await h.state.save(); assert.equal(calls, 0)
  enabled = true; await h.hooks.onShow(); h.state.activityText.value = '保留草稿'; await h.state.save()
  assert.equal(calls, 1); assert.equal(h.state.activityText.value, '保留草稿'); assert.equal(h.toasts.length, 0)
  assert.match(h.state.error.value, /权限已撤销/)
  session.token = ''; session.epoch++; await vue.nextTick(); assert.equal(h.state.ready.value, false); assert.equal(h.state.activityText.value, '')
})
