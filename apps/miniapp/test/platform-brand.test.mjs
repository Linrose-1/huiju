import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { URL } from 'node:url'
import ts from 'typescript'
const require = createRequire(import.meta.url)
function harness() {
  const calls = [], tabChanges = [], hooks = {}
  const source = readFileSync(new URL('../src/services/platform-brand.ts', import.meta.url), 'utf8')
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText
  const deps = {
    vue: require('vue'),
    '@dcloudio/uni-app': { onShow(fn) { hooks.onShow = fn } },
    '@/services/api': {
      ApiError: class extends Error { constructor(status) { super(); this.status = status } },
      api: {
        platformAppearance: () => new Promise((resolve, reject) => calls.push({ resolve, reject })),
        platformBrand: async () => ({ displayName: '旧版名称', visible: false }),
      },
    },
  }
  const result = {}
  new Function('require', 'exports', 'uni', code)(name => deps[name], result, {
    setTabBarItem({ index, text, success }) { tabChanges.push({ index, text }); success() },
  })
  return { brand: result.usePlatformBrand(), refresh: result.refreshPlatformBrand, calls, hooks, deps, tabChanges }
}
const defaults = { circle: '商友圈', activity: '友聚会', assistant: 'i 助手', mine: '我世界' }
const configured = {
  displayName: '合作品牌', visible: true, logoUrl: '/api/v1/platform/appearance/images/logo',
  tabNames: { circle: '圈子', activity: '聚会', assistant: '', mine: '我的' },
  partners: [{ name: '合作方', description: '', logoUrl: null, codeUrl: '/api/v1/platform/appearance/images/code' }],
}
test('sets only the existing four tab labels, preserving the configured order and icons', async () => {
  const h = harness()
  const pages = JSON.parse(readFileSync(new URL('../src/pages.json', import.meta.url), 'utf8'))
  assert.deepEqual(pages.tabBar.list.map(item => item.text), Object.values(defaults))
  assert.deepEqual(h.brand.value.tabNames, defaults)
  const refresh = h.hooks.onShow()
  h.calls[0].resolve(configured)
  await refresh
  assert.deepEqual(h.brand.value.tabNames, { circle: '圈子', activity: '聚会', assistant: 'i 助手', mine: '我的' })
  assert.deepEqual(h.tabChanges, [{ index: 0, text: '圈子' }, { index: 1, text: '聚会' }, { index: 3, text: '我的' }])
})
test('shares overlapping public refreshes and hides partners if the current configuration cannot be read', async () => {
  const h = harness()
  const first = h.hooks.onShow()
  const overlapping = h.refresh()
  assert.equal(h.calls.length, 1)
  h.calls[0].resolve(configured)
  await Promise.all([first, overlapping])
  assert.equal(h.brand.value.partners.length, 1)
  const failed = h.hooks.onShow()
  h.calls[1].reject(new Error('offline'))
  await failed
  assert.equal(h.brand.value.displayName, '合作品牌')
  assert.deepEqual(h.brand.value.partners, [])
})
test('falls back to the legacy brand endpoint and clears extended settings when unsupported', async () => {
  const h = harness()
  const refresh = h.hooks.onShow()
  h.calls[0].reject(new h.deps['@/services/api'].ApiError(404))
  await refresh
  assert.deepEqual(h.brand.value, { displayName: '旧版名称', visible: false, logoUrl: null, tabNames: defaults, partners: [] })
})
test('previews only a currently published code at its original media URL and ignores duplicate taps', async () => {
  const hooks = {}, previews = []
  const source = readFileSync(new URL('../src/pages/mine/partners.vue', import.meta.url), 'utf8').match(/<script setup lang="ts">([\s\S]*?)<\/script>/)?.[1]
  const code = ts.transpileModule(source + '\nexport { previewCode }', { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText
  const brand = require('vue').ref(configured), result = {}
  const deps = {
    vue: require('vue'),
    '@dcloudio/uni-app': Object.fromEntries(['onShow', 'onHide', 'onUnload', 'onPullDownRefresh'].map(key => [key, fn => { hooks[key] = fn }])),
    '@/services/platform-brand': { platformBrand: brand, refreshPlatformBrand: async () => undefined },
    '@/services/api/environment': { mediaUrl: url => 'https://app.example.test' + url },
  }
  new Function('require', 'exports', 'uni', code)(name => deps[name], result, { previewImage: options => previews.push(options) })
  await hooks.onShow()
  const { codeUrl } = configured.partners[0]
  result.previewCode(codeUrl)
  result.previewCode(codeUrl)
  assert.equal(previews.length, 1)
  assert.equal(previews[0].current, 'https://app.example.test' + codeUrl)
  assert.deepEqual(previews[0].urls, [previews[0].current])
  previews[0].complete()
  brand.value = { ...brand.value, partners: [] }
  result.previewCode(codeUrl)
  assert.equal(previews.length, 1)
})
