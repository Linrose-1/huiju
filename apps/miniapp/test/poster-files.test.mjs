import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readFileSync } from 'node:fs'
import { URL } from 'node:url'
import ts from 'typescript'

function harness() {
  const calls = { images: [], writes: [], unlinks: [], saves: [], shares: [] }
  const uni = {
    getImageInfo: options => calls.images.push(options), canIUse: () => false,
    getFileSystemManager: () => ({ writeFile: options => calls.writes.push(options), unlink: options => calls.unlinks.push(options) }),
    saveImageToPhotosAlbum: options => calls.saves.push(options), showShareImageMenu: options => calls.shares.push(options),
  }
  const source = readFileSync(new URL('../src/services/wechat/poster-files.ts', import.meta.url), 'utf8')
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText
  const exports = {}
  new Function('require', 'exports', 'uni', 'wx', compiled)(() => ({ mediaUrl: value => value.startsWith('/static/') ? value : 'https://media.example' + value }), exports, uni, { env: { USER_DATA_PATH: 'wxfile://usr' } })
  return { ...exports, calls, uni }
}
test('package covers preserve absolute paths while remote image failures stay recoverable', async () => {
  const h = harness()
  assert.equal(await h.posterCoverPath(null), '/static/huiju/campus.jpg')
  assert.equal(await h.posterCoverPath('/static/cover.jpg'), '/static/cover.jpg')
  assert.equal(h.calls.images.length, 0)
  const download = h.posterCoverPath('/api/v1/media/cover.jpg')
  assert.equal(h.calls.images[0].src, 'https://media.example/api/v1/media/cover.jpg')
  h.calls.images[0].fail(); await assert.rejects(download, /封面加载失败/)
})
test('code bytes stay in a temporary local file and write failures do not pretend success', async () => {
  const h = harness()
  await assert.rejects(h.writePosterCode('not a code', 'image/png'), /无效/)
  assert.equal(h.calls.writes.length, 0)
  const writing = h.writePosterCode('aGVsbG8=', 'image/png')
  const options = h.calls.writes[0]
  assert.match(options.filePath, /^wxfile:\/\/usr\/activity-poster-code-.+\.png$/)
  assert.equal(options.encoding, 'base64')
  options.fail(); await assert.rejects(writing, /保存失败/)
  h.removePosterCode(''); assert.equal(h.calls.unlinks.length, 0)
  h.removePosterCode(options.filePath); assert.equal(h.calls.unlinks[0].filePath, options.filePath)
})
test('unsupported image sharing and denied album permission provide errors instead of fake success', async () => {
  const h = harness()
  await assert.rejects(h.sharePosterImage('/poster.png'), /保存到相册/)
  assert.equal(h.calls.shares.length, 0)
  const save = h.savePosterImage('/poster.png'); h.calls.saves[0].fail(); await assert.rejects(save, /相册权限/)
  h.uni.canIUse = () => true
  const share = h.sharePosterImage('/poster.png')
  assert.equal(h.calls.shares[0].path, '/poster.png')
  h.calls.shares[0].fail({ errMsg: 'showShareImageMenu:fail cancel' }); await share
})
