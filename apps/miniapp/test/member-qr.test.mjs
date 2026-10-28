import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { URL } from 'node:url'
import { setImmediate } from 'node:timers/promises'
import ts from 'typescript'
import * as vue from 'vue'

const require = createRequire(import.meta.url)
const qrPath = '/api/v1/members/00112233-4455-6677-8899-aabbccddeeff/wechat-qr'
function evaluate(path, deps, globals = {}, names = '') {
  const text = readFileSync(new URL('../src/' + path, import.meta.url), 'utf8')
  const source = path.endsWith('.vue') ? text.match(/<script setup lang="ts">([\s\S]*?)<\/script>/)[1] : text
  const code = ts.transpileModule(source + (names ? '\nexport {' + names + '}' : ''), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
  const exports = {}
  new Function('require', 'exports', ...Object.keys(globals), code)(name => deps[name] || require(name), exports, ...Object.values(globals))
  return exports
}
function harness() {
  const session = vue.reactive({ token: 'session-a', epoch: 0 }), choices = [], reads = [], uploads = [], downloads = [], previews = []
  const uni = {
    chooseImage: options => choices.push(options),
    getFileSystemManager: () => ({ readFile: options => reads.push(options) }),
    downloadFile: options => downloads.push(options),
    previewImage: options => previews.push(options),
  }
  const deps = {
    '@/services/api': { api: { uploadWechatQr: async (...args) => { uploads.push(args); return { url: qrPath } } }, ApiError: class extends Error {} },
    '@/services/api/environment': { API_BASE_URL: 'http://127.0.0.1:3012/api/v1' },
    '@/stores/session': { useSessionStore: () => session },
  }
  const service = evaluate('services/wechat/member-qr.ts', deps, { uni })
  return { session, choices, reads, uploads, downloads, previews, uni, deps, service }
}

test('QR selection cancellation is quiet; valid PNG and JPG use the existing upload API', async () => {
  const h = harness(), cancel = h.service.chooseWechatQr()
  h.choices[0].fail({ errMsg: 'chooseImage:fail cancel' }); assert.equal(await cancel, null); assert.equal(h.reads.length, 0)
  for (const [base64, mime] of [['iVBORtest', 'image/png'], ['/9j/test', 'image/jpeg']]) {
    const selected = h.service.chooseWechatQr(); h.choices.at(-1).success({ tempFilePaths: ['/tmp/qr'] }); await setImmediate()
    assert.equal(h.reads.at(-1).encoding, 'base64'); h.reads.at(-1).success({ data: base64 })
    assert.deepEqual(await selected, { url: qrPath }); assert.deepEqual(h.uploads.at(-1), [base64, mime])
  }
})

test('invalid or oversized QR pictures fail before upload', async () => {
  for (const [data, message] of [['GIF89a', /PNG 或 JPG/], ['iVBOR' + 'A'.repeat(2796200), /2 MB/]]) {
    const h = harness(), selected = h.service.chooseWechatQr(); h.choices[0].success({ tempFilePaths: ['/tmp/qr'] }); await setImmediate()
    h.reads[0].success({ data }); await assert.rejects(selected, message); assert.equal(h.uploads.length, 0)
  }
})

test('changing account while choosing or reading an image cannot upload it for the new account', async () => {
  for (const stage of ['choose', 'read']) {
    const h = harness(), selected = h.service.chooseWechatQr()
    if (stage === 'choose') h.session.token = 'session-b'
    h.choices[0].success({ tempFilePaths: ['/tmp/qr'] }); await setImmediate()
    if (stage === 'read') h.session.epoch++
    h.reads[0].success({ data: 'iVBORtest' }); await assert.rejects(selected); assert.equal(h.uploads.length, 0)
  }
})

test('foreign and malformed QR URLs never receive a session token', async () => {
  const h = harness()
  for (const path of ['https://evil.example' + qrPath, '//evil.example' + qrPath, qrPath + '?redirect=https://evil.example', qrPath + '/../../profile', '/api/v1/members/' + '-'.repeat(36) + '/wechat-qr']) {
    await assert.rejects(h.service.downloadWechatQr(path), /链接无效/)
  }
  assert.equal(h.downloads.length, 0)
  h.session.token = ''; await assert.rejects(h.service.downloadWechatQr(qrPath), /登录/); assert.equal(h.downloads.length, 0)
})

test('protected download uses only the configured API and rejects refused or late account responses', async () => {
  const h = harness(), loaded = h.service.downloadWechatQr(qrPath)
  assert.equal(h.downloads[0].url, 'http://127.0.0.1:3012' + qrPath)
  assert.deepEqual(h.downloads[0].header, { Authorization: 'Bearer session-a' })
  h.downloads[0].success({ statusCode: 200, tempFilePath: '/tmp/qr-a' }); assert.equal(await loaded, '/tmp/qr-a')
  for (const statusCode of [401, 403, 404, 500]) {
    const denied = h.service.downloadWechatQr(qrPath); h.downloads.at(-1).success({ statusCode, tempFilePath: '/tmp/private' })
    await assert.rejects(denied, /不可查看/)
  }
  const stale = h.service.downloadWechatQr(qrPath); h.session.epoch++
  h.downloads.at(-1).success({ statusCode: 200, tempFilePath: '/tmp/old-account' }); await assert.rejects(stale, /身份已变更/)
})

function component(t) {
  const h = harness(), props = vue.reactive({ url: qrPath }), scope = vue.effectScope()
  let unmount
  const deps = { ...h.deps, vue: { ...vue, onUnmounted: callback => { unmount = callback } }, '@/services/wechat/member-qr': h.service }
  const page = scope.run(() => evaluate('components/business/PrivateWechatQr.vue', deps, { uni: h.uni, defineProps: () => props }, 'load,path,error,busy'))
  t.after(() => scope.stop())
  return { ...h, page, props, unmount: () => unmount() }
}

test('private QR component shows no refused image, supports retry, and previews only after an explicit click', async t => {
  const h = component(t); assert.equal(h.page.busy.value, true)
  h.downloads[0].success({ statusCode: 403, tempFilePath: '/tmp/denied' }); await setImmediate()
  assert.equal(h.page.path.value, ''); assert.match(h.page.error.value, /不可查看/); assert.equal(h.previews.length, 0)
  const retry = h.page.load(); h.downloads[1].success({ statusCode: 200, tempFilePath: '/tmp/public' }); await retry
  assert.equal(h.page.path.value, '/tmp/public'); assert.equal(h.previews.length, 0)
  const preview = h.page.load(true); await h.page.load(true); assert.equal(h.downloads.length, 3)
  h.downloads[2].success({ statusCode: 200, tempFilePath: '/tmp/rechecked' }); await preview
  assert.deepEqual(h.previews, [{ urls: ['/tmp/rechecked'], current: '/tmp/rechecked' }])
})

test('private QR component discards pending previews after account switch, logout, URL change or unmount', async t => {
  for (const action of ['account', 'logout', 'url', 'unmount']) {
    const h = component(t); h.downloads[0].success({ statusCode: 200, tempFilePath: '/tmp/first' }); await setImmediate()
    const preview = h.page.load(true)
    if (action === 'account') { h.session.token = 'session-b'; h.session.epoch++ }
    else if (action === 'logout') { h.session.token = ''; h.session.epoch++ }
    else if (action === 'url') h.props.url = ''
    else h.unmount()
    await setImmediate(); h.downloads[1].success({ statusCode: 200, tempFilePath: '/tmp/stale' }); await preview
    assert.equal(h.previews.length, 0); assert.equal(h.page.path.value, '')
    if (action === 'account') {
      assert.deepEqual(h.downloads[2].header, { Authorization: 'Bearer session-b' })
      h.downloads[2].success({ statusCode: 200, tempFilePath: '/tmp/account-b' }); await setImmediate()
      assert.equal(h.page.path.value, '/tmp/account-b'); assert.equal(h.previews.length, 0)
    }
  }
})
