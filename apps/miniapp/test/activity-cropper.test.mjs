import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readFileSync } from 'node:fs'
import { URL } from 'node:url'
import { setImmediate } from 'node:timers/promises'
import { createRequire } from 'node:module'
import ts from 'typescript'
import activityImages from './activity-images-fixture.mjs'
const require = createRequire(import.meta.url)
function harness(info = options => options.success({ width: 2000, height: 1200, path: 'local-image' }), exportFile) {
  const source = readFileSync(new URL('../src/components/business/ActivityCoverCropper.vue', import.meta.url), 'utf8').match(/<script setup lang="ts">([\s\S]*?)<\/script>/)[1]
  const code = ts.transpileModule(source + '\nexport { open, finish, confirm, visible, saving, setZoom, geometry, start, move };', { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
  const page = {}, draws = [], exports = []
  const vue = { ...require('vue'), getCurrentInstance: () => ({ proxy: {} }), onBeforeUnmount() {} }
  const uni = { getImageInfo: info, getSystemInfoSync: () => ({ windowWidth: 375 }), createCanvasContext: () => ({ drawImage: (...args) => draws.push(args), draw: (_reserve, callback) => callback() }), canvasToTempFilePath: options => { exports.push(options); if (exportFile) exportFile(options); else options.success({tempFilePath:'cropped-image'}) } }
  new Function('require', 'exports', 'uni', 'defineExpose', code)(name => name === 'vue' ? vue : activityImages, page, uni, () => {})
  return { page, draws, exports }
}
test('crop cancellation during image loading cannot reopen modal or leave pending crop', async () => {
  let pending
  const h = harness(options => { pending = options })
  const result = h.page.open('old-image')
  h.page.finish(null)
  pending.success({ width:2000, height:1200, path:'old-image' })
  assert.equal(await result, null)
  assert.equal(h.page.visible.value, false)
})
test('crop drag/zoom exports selected source rectangle at 1250 by 1000 and resolves once', async () => {
  const h = harness(), result = h.page.open('local-image')
  await setImmediate()
  h.page.setZoom(2)
  h.page.start({touches:[{clientX:100,clientY:100}]})
  h.page.move({touches:[{clientX:130,clientY:80}]})
  const expected = h.page.geometry.value
  await h.page.confirm()
  assert.equal(await result, 'cropped-image')
  assert.deepEqual(h.draws[0], ['local-image',expected.sourceX,expected.sourceY,expected.sourceWidth,expected.sourceHeight,0,0,1250,1000])
  assert.equal(h.exports[0].destWidth,1250)
  assert.equal(h.exports[0].destHeight,1000)
  assert.equal(h.page.visible.value,false)
})
test('late canvas export after cancellation cannot resolve a new image or reopen cropper', async () => {
  let exportOptions
  const h = harness(undefined, options => { exportOptions = options })
  const result = h.page.open('old-image')
  await setImmediate()
  const confirm = h.page.confirm()
  await setImmediate()
  h.page.finish(null)
  assert.equal(await result, null)
  exportOptions.success({ tempFilePath: 'late-image' })
  await confirm
  assert.equal(h.page.visible.value, false)
  assert.equal(h.page.saving.value, false)
})
