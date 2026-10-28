import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { URL } from 'node:url'
import ts from 'typescript'
import * as vue from 'vue'

function harness(t) {
  const hooks = {}, session = vue.reactive({ token: '', epoch: 0, member: null })
  const source = readFileSync(new URL('../src/pages/member/profile.vue', import.meta.url), 'utf8').split('<script setup lang="ts">')[1].split('</script>')[0]
  const deps = {
    vue,
    '@dcloudio/uni-app': Object.fromEntries(['onShow', 'onHide', 'onUnload'].map(name => [name, fn => { hooks[name] = fn }])),
    '@/stores/session': { useSessionStore: () => session },
    '@/services/api': { api: {}, refreshMember: async () => null, errorMessage: e => e.message },
    '@/services/api/environment': { mediaUrl: value => value },
    '@/services/wechat': {},
    '@/services/navigation': { routes: {} },
  }
  const js = ts.transpileModule(source + '\nreturn { keyboardHeight, keyboardChanged, form }', { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText
  const scope = vue.effectScope()
  const page = scope.run(() => new Function('require', 'exports', js)(name => deps[name] || {}, {}))
  t.after(() => scope.stop())
  hooks.onShow()
  return { page, hooks }
}

test('keyboard changes track native height across field switches without changing draft text', t => {
  const { page } = harness(t)
  page.form.needs = '保留正在输入的资源需求'
  page.keyboardChanged({ detail: { height: 300 } })
  assert.equal(page.keyboardHeight.value, 300)
  page.keyboardChanged({ detail: { height: 356 } })
  assert.equal(page.keyboardHeight.value, 356)
  assert.equal(page.form.needs, '保留正在输入的资源需求')
  page.keyboardChanged({ detail: { height: 0 } })
  assert.equal(page.keyboardHeight.value, 0)
})

test('leaving restores layout and late keyboard events cannot recreate the gap', t => {
  const { page, hooks } = harness(t)
  page.keyboardChanged({ detail: { height: 300 } })
  hooks.onHide()
  assert.equal(page.keyboardHeight.value, 0)
  page.keyboardChanged({ detail: { height: 300 } })
  assert.equal(page.keyboardHeight.value, 0)
  hooks.onShow()
  page.keyboardChanged({ detail: { height: 280 } })
  assert.equal(page.keyboardHeight.value, 280)
  hooks.onUnload()
  page.keyboardChanged({ detail: { height: 300 } })
  assert.equal(page.keyboardHeight.value, 0)
})
