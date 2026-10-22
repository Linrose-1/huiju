import assert from 'node:assert/strict'
import { test } from 'node:test'
import { setImmediate } from 'node:timers/promises'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { URL } from 'node:url'
import ts from 'typescript'
const require = createRequire(import.meta.url)
const vue = require('vue')
const actors = ['owner', 'planner', 'operator', 'provider', 'member', 'peer', 'visitor'].map(key => ({ key, label: key + '（测试）' }))
function page(t, localTest = true) {
  const hooks = {}, sheets = [], switched = []
  const session = vue.reactive({ token: 'owner', epoch: 0, member: { profileComplete: true } })
  const totals = { owner: 2, visitor: 0, peer: 4 }
  const deps = {
    vue,
    '@dcloudio/uni-app': Object.fromEntries(['onShow', 'onHide', 'onUnload'].map(key => [key, fn => { hooks[key] = fn }])),
    '@/stores/session': { useSessionStore: () => session },
    '@/services/api/environment': { LOCAL_TEST: localTest },
    '@/services/navigation': {},
    '@/services/api': { errorMessage: e => e.message, api: {
      platformContent: async () => ({ canEdit: false }),
      registrations: async () => ({ activeCount: totals[session.token] }),
      organizedActivities: async () => ({ total: totals[session.token] }),
      notifications: async () => ({ unreadCount: 0 }),
    } },
    '@/services/wechat': {
      bootstrapIdentity: async () => {}, getLocalTestActor: () => actors[0], localTestActors: actors,
      switchLocalTestActor: async key => { switched.push(key); session.epoch++; session.token = key; session.member = { profileComplete: key !== 'visitor' } },
    },
  }
  const source = readFileSync(new URL('../src/pages/mine/index.vue', import.meta.url), 'utf8').match(/<script setup lang="ts">([\s\S]*?)<\/script>/)[1]
  const code = ts.transpileModule(source + '\nexport { chooseTestActor, switching, testActorLabel, count, error };', { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
  const result = {}, scope = vue.effectScope()
  t.after(() => scope.stop())
  scope.run(() => new Function('require', 'exports', 'uni', code)(name => deps[name] ?? require(name), result, {
    showActionSheet: options => new Promise((resolve, reject) => sheets.push({ ...options, resolve, reject })),
  }))
  return { ...result, hooks, session, switched, sheets }
}

test('local actor menu locks duplicate taps, exposes seven actors within native six-item limit and reloads counts', async t => {
  const h = page(t)
  h.hooks.onShow(); await setImmediate()
  assert.equal(h.count.value, 2)
  const switching = h.chooseTestActor()
  await h.chooseTestActor()
  assert.equal(h.sheets.length, 1)
  assert.equal(h.sheets[0].itemList.length, 6)
  h.sheets.shift().resolve({ tapIndex: 5 }); await setImmediate()
  assert.equal(h.sheets[0].itemList.length, 2)
  h.sheets.shift().resolve({ tapIndex: 0 }); await switching
  assert.deepEqual(h.switched, ['peer'])
  assert.equal(h.testActorLabel.value, 'peer（测试）')
  assert.equal(h.count.value, 4)
  assert.equal(h.switching.value, false)
})

test('cancelled or hidden actor menu never changes identity and permits a later retry', async t => {
  const h = page(t)
  h.hooks.onShow(); await setImmediate()
  const cancelled = h.chooseTestActor()
  h.sheets.shift().reject({ errMsg: 'showActionSheet:fail cancel' }); await cancelled
  assert.equal(h.error.value, '')
  assert.equal(h.switching.value, false)
  const hidden = h.chooseTestActor()
  h.hooks.onHide()
  h.sheets.shift().resolve({ tapIndex: 1 }); await hidden
  assert.deepEqual(h.switched, [])
})

test('ordinary mode never opens a local actor menu', async t => {
  const h = page(t, false)
  h.hooks.onShow(); await setImmediate()
  await h.chooseTestActor()
  assert.deepEqual(h.sheets, [])
  assert.deepEqual(h.switched, [])
})
