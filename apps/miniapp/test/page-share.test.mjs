import assert from 'node:assert/strict'
import { test } from 'node:test'
import { URLSearchParams } from 'node:url'
import { setImmediate } from 'node:timers/promises'
import { reactive, ref, effectScope } from 'vue'
import { loadPageShare } from './page-share-harness.mjs'

const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b }); return { promise, resolve, reject } }
function harness(t, { timeline = true, identify = async () => {} } = {}) {
  const session = reactive({ token: 'token-a', epoch: 0, member: { inviteCode: 'my-code', profileComplete: false }, captureInvite(value) { this.pendingInvite = value } })
  const target = ref({ path: '/pages/activity/detail', title: '公开活动', id: 'a/b&x=1', contactPhone: 'private', answers: ['secret'], searchId: 'tracking' })
  const hooks = {}, menus = [], scope = effectScope()
  let attempts = 0, identifyNext = identify
  const deps = {
    '@dcloudio/uni-app': Object.fromEntries(['onLoad', 'onShow', 'onHide', 'onUnload', 'onShareAppMessage', 'onShareTimeline'].map(name => [name, callback => { hooks[name] = callback }])),
    '@/stores/session': { useSessionStore: () => session },
    '@/services/wechat': { bootstrapIdentity: () => { attempts++; return identifyNext(session) } },
  }
  const uni = { hideShareMenu: options => menus.push(['hide', options]), showShareMenu: options => menus.push(['show', options]) }
  const helper = loadPageShare(deps, uni)
  const page = scope.run(() => helper.usePageShare(() => target.value, timeline))
  t.after(() => scope.stop())
  return { page, session, target, hooks, menus, get attempts() { return attempts }, identify: next => { identifyNext = next }, async show() { hooks.onShow(); await setImmediate() } }
}

test('identified incomplete-profile visitors can share with only their own invite and public target', async t => {
  const h = harness(t); h.hooks.onLoad({ inviteCode: 'original-source' }); await h.show()
  assert.equal(h.page.shareReady.value, true)
  const friend = h.page.shareMessage(), timeline = h.page.shareTimeline()
  assert.equal(friend.title, '公开活动')
  assert.deepEqual(Object.fromEntries(new URLSearchParams(timeline.query)), { id: 'a/b&x=1', inviteCode: 'my-code' })
  assert.equal(friend.path, '/pages/activity/detail?' + timeline.query)
  assert.deepEqual(Object.keys(friend), ['title', 'path', 'imageUrl'])
  assert.equal(friend.imageUrl, '/static/huiju/campus.jpg')
  assert.equal(timeline.imageUrl, '/static/huiju/campus.jpg')
  assert.deepEqual(h.menus.at(-1), ['show', { menus: ['shareAppMessage', 'shareTimeline'] }])
})

test('identity is gated while resolving; repeated retries share the in-flight operation', async t => {
  const wait = deferred(), h = harness(t, { identify: () => wait.promise })
  h.hooks.onShow(); await h.page.retryShare(); await h.page.retryShare()
  assert.equal(h.attempts, 1); assert.equal(h.page.shareReady.value, false)
  assert.equal(h.menus.some(([kind]) => kind === 'show'), false)
  assert.throws(() => h.page.shareMessage(), /尚未就绪/)
  wait.resolve(); await setImmediate(); assert.equal(h.page.shareReady.value, true)
})

test('missing identity and failures remain unavailable and explicit retry can recover', async t => {
  const h = harness(t, { identify: async () => { throw new Error('offline') } }); h.session.token = ''; h.session.member = null
  await h.show(); assert.equal(h.page.shareReady.value, false); assert.match(h.page.shareError.value, /重试/)
  h.identify(async () => {}); await h.page.retryShare(); assert.equal(h.page.shareReady.value, false)
  h.identify(async session => { session.token = 'visitor'; session.member = { inviteCode: 'visitor-code', profileComplete: false } })
  await h.page.retryShare(); assert.equal(h.page.shareReady.value, true); assert.equal(h.page.shareError.value, '')
})

test('epoch or invite changes revoke an otherwise identical token and require fresh verification', async t => {
  for (const change of ['epoch', 'invite']) {
    const h = harness(t); await h.show()
    if (change === 'epoch') h.session.epoch++; else h.session.member.inviteCode = 'new-code'
    assert.equal(h.page.shareReady.value, false); assert.equal(h.menus.at(-1)[0], 'hide')
    assert.match(h.page.shareError.value, /重试/)
    await h.page.retryShare(); assert.equal(h.page.shareReady.value, true)
  }
})

test('identity completion after switching account or leaving cannot reopen share menus', async t => {
  for (const action of ['epoch', 'hide', 'unload']) {
    const wait = deferred(), h = harness(t, { identify: () => wait.promise }); h.hooks.onShow()
    if (action === 'epoch') h.session.epoch++; else h.hooks[action === 'hide' ? 'onHide' : 'onUnload']()
    wait.resolve(); await setImmediate(); assert.equal(h.page.shareReady.value, false)
    assert.equal(h.menus.some(([kind]) => kind === 'show'), false)
    if (action === 'epoch') assert.match(h.page.shareError.value, /重试/)
  }
})

test('private-page share uses a fixed public image rather than a screenshot, redirects to public activity and never registers timeline', async t => {
  const h = harness(t, { timeline: false }); await h.show()
  assert.equal(h.hooks.onShareTimeline, undefined)
  assert.deepEqual(h.menus.at(-1), ['show', { menus: ['shareAppMessage'] }])
  assert.match(h.page.shareMessage().path, /^\/pages\/activity\/detail\?/)
  assert.equal(h.page.shareMessage().imageUrl, '/static/huiju/campus.jpg')
  assert.doesNotMatch(JSON.stringify(h.page.shareMessage()), /private|secret|tracking/)
})

test('unavailable content closes sharing and homepage sharing carries no stale content id', async t => {
  const h = harness(t); await h.show(); h.target.value = null
  assert.equal(h.page.shareReady.value, false); assert.equal(h.menus.at(-1)[0], 'hide')
  h.target.value = { path: '/pages/assistant/index', title: '助手' }
  assert.equal(h.page.shareReady.value, true)
  assert.equal(h.page.shareMessage().path, '/pages/assistant/index?inviteCode=my-code')
})
