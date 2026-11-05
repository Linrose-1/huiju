import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { URL } from 'node:url'
import ts from 'typescript'
const require = createRequire(import.meta.url)
function harness() {
  const calls = [], hooks = {}
  const source = readFileSync(new URL('../src/services/platform-brand.ts', import.meta.url), 'utf8')
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText
  const deps = {
    vue: require('vue'),
    '@dcloudio/uni-app': Object.fromEntries(['onShow', 'onHide', 'onUnload'].map(key => [key, fn => { hooks[key] = fn }])),
    '@/services/api': { api: { platformBrand: () => new Promise((resolve, reject) => calls.push({ resolve, reject })) } },
  }
  const result = {}
  new Function('require', 'exports', code)(name => deps[name], result)
  return { brand: result.usePlatformBrand(), calls, hooks }
}
test('brand refresh applies saved name and hidden state, preserving last value on failure', async () => {
  const h = harness()
  assert.deepEqual(h.brand.value, { displayName: '有聚点', visible: true })
  const refresh = h.hooks.onShow()
  h.calls[0].resolve({ displayName: '新品牌', visible: false })
  await refresh
  assert.deepEqual(h.brand.value, { displayName: '新品牌', visible: false })
  const failed = h.hooks.onShow()
  h.calls[1].reject(new Error('offline'))
  await failed
  assert.equal(h.brand.value.visible, false)
})
test('hidden, unloaded and older page requests cannot overwrite a newer public brand', async () => {
  const h = harness()
  const old = h.hooks.onShow()
  h.hooks.onHide()
  const latest = h.hooks.onShow()
  h.calls[1].resolve({ displayName: '当前名称', visible: true })
  await latest
  h.calls[0].resolve({ displayName: '过期名称', visible: false })
  await old
  const leaving = h.hooks.onShow()
  h.hooks.onUnload()
  h.calls[2].resolve({ displayName: '离页结果', visible: false })
  await leaving
  assert.deepEqual(h.brand.value, { displayName: '当前名称', visible: true })
})
