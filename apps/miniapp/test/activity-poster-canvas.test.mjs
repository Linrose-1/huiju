import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readFileSync } from 'node:fs'
import { URL } from 'node:url'
import ts from 'typescript'

function harness({ failImage, failExport = false, latinWidth = .55, packagePaths = false } = {}) {
  const draws = [], images = [], exports = []
  let size = 24
  const context = {
    setFontSize(value) { size = value }, set font(value) { size = Number(/(\d+)px/.exec(value)[1]) },
    measureText(value) { return { width: [...value].reduce((sum, char) => sum + (char.charCodeAt(0) < 128 ? latinWidth : 1) * size, 0) } },
    fillText(value, x, y) { draws.push({ value, x, y, size, width: this.measureText(value).width }) },
    drawImage(...values) { images.push(values) },
    draw(reserve, callback) { callback() },
    ...Object.fromEntries(['setFillStyle', 'fillRect', 'setTextBaseline', 'setTextAlign', 'setStrokeStyle', 'setLineWidth', 'beginPath', 'moveTo', 'lineTo', 'stroke'].map(name => [name, () => {}])),
  }
  const uni = {
    createCanvasContext(id, component) { assert.equal(id, 'poster'); assert.equal(component, 'instance'); return context },
    getImageInfo({ src, success, fail }) { if (src === failImage) fail(); else success({ path: packagePaths ? src.replace(/^\//, '') : src, width: src === '/cover' ? 1400 : 430, height: src === '/cover' ? 933 : 430 }) },
    canvasToTempFilePath(options, component) { assert.equal(component, 'instance'); exports.push(options); if (failExport) options.fail(); else options.success({ tempFilePath: '/poster.png' }) },
  }
  function compile(path, dependencies = {}) {
    const source = readFileSync(new URL(path, import.meta.url), 'utf8')
    const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText
    const result = {}
    new Function('require', 'exports', 'uni', code)(name => dependencies[name], result, uni)
    return result
  }
  const presentation = compile('../src/services/presentation.ts')
  const renderer = compile('../src/services/wechat/activity-poster-canvas.ts', { '@/services/presentation': presentation })
  const data = { title: '地产行业AI应用实战分享', subtitle: '交流真实案例，一起探索行业新方法', highlights: ['行业案例拆解', '实用工具体验'], startsAt: '2026-12-20T01:00:00Z', endsAt: '2026-12-20T04:00:00Z', location: '上海 · 活动会客厅', feeType: 'free', feeAmount: 0 }
  return { ...renderer, draws, images, exports, data, run: overrides => renderer.renderActivityPoster({ canvasId: 'poster', component: 'instance', data, coverPath: '/cover', codePath: '/code', ...overrides }) }
}

test('renders actual cover and intact code with deterministic 2x PNG export and Beijing time', async () => {
  const h = harness()
  assert.equal(await h.run(), '/poster.png')
  assert.equal(h.images[0][0], '/cover')
  assert.ok(Math.abs(h.images[0][7] / h.images[0][8] - 1.25) < .001)
  assert.deepEqual(h.images[1], ['/code', 549, 1267, 160, 160])
  assert.equal(h.exports[0].destWidth, h.POSTER_WIDTH * 2)
  assert.equal(h.exports[0].destHeight, h.POSTER_HEIGHT * 2)
  assert.equal(h.exports[0].fileType, 'png')
  assert.ok(h.draws.some(draw => draw.value.includes('2026.12.20 09:00 – 12:00')))
  assert.ok(h.draws.some(draw => draw.value === '免费参与'))
  const title = h.draws.filter(draw => draw.y >= 112 && draw.y < 262 && draw.size > 26)
  assert.deepEqual(title.map(draw => draw.value), ['地产行业AI', '应用实战分享'])
})

test('package-root paths remain absolute when WeChat image info drops their leading slash', async () => {
  const h = harness({ packagePaths: true })
  await h.run()
  assert.equal(h.images[0][0], '/cover')
  assert.equal(h.images[1][0], '/code')
})

test('50-character title survives intact and long location cannot overlap code or leave canvas', async () => {
  const h = harness()
  h.data.title = '这是一个需要完整保留的活动标题内容'.repeat(3).slice(0, 50)
  h.data.location = '上海市很长的活动地址'.repeat(50)
  h.data.subtitle = '一起交流'.repeat(10)
  h.data.highlights = ['这是需要换行展示并保持整洁的第一条活动亮点内容', '这是需要换行展示并保持整洁的第二条活动亮点内容']
  await h.run()
  const title = h.draws.filter(draw => draw.y >= 112 && draw.y < 262 && draw.size > 26)
  assert.equal(title.map(draw => draw.value).join(''), h.data.title)
  assert.ok(title.length <= 3)
  assert.ok(h.draws.every(draw => draw.x >= 0 && draw.y >= 0 && draw.x + draw.width <= h.POSTER_WIDTH && draw.y + draw.size <= h.POSTER_HEIGHT))
  const location = h.draws.filter(draw => draw.value.includes('上海市') || draw.value.endsWith('…'))
  assert.ok(location.length >= 1)
  assert.ok(location.every(draw => draw.y + draw.size < 1240))
})

test('empty copy uses generic invitation, hidden brand stays absent, paid fee uses cents', async () => {
  const h = harness()
  h.data.subtitle = ''; h.data.highlights = []; h.data.feeType = 'paid'; h.data.feeAmount = 9900
  await h.run({ brandVisible: false, brandName: '品牌不应显示' })
  assert.ok(!h.draws.some(draw => draw.value.includes('品牌不应显示') || draw.value === '有聚点'))
  assert.ok(h.draws.some(draw => draw.value === '¥99.00 / 人'))
  assert.ok(h.draws.some(draw => draw.value === '欢迎一起交流'))
  assert.ok(!h.draws.some(draw => /示意|模板预览|小程序码/.test(draw.value)))
})

test('mixed Unicode title and 30-character brand remain inside their own areas', async () => {
  const h = harness()
  h.data.title = 'AI应用交流🎉'.repeat(6)
  const brandName = '有聚点活动交流社区品牌展示名'.repeat(2).slice(0, 30)
  await h.run({ brandName })
  const title = h.draws.filter(draw => draw.y >= 112 && draw.y < 262 && draw.size > 26)
  assert.equal(title.map(draw => draw.value).join(''), h.data.title)
  const brand = h.draws.filter(draw => draw.x === 38 && draw.y < 88)
  assert.equal(brand.map(draw => draw.value).join(''), brandName)
  assert.ok(brand.every(draw => draw.x + draw.width < 596 && draw.y + draw.size < 88))
  assert.ok(h.draws.every(draw => !/[\uD800-\uDBFF]$/.test(draw.value)))
})

test('all maximum fields plus a two-line cross-day date retain separation from cover, facts and footer', async () => {
  // Wider ASCII measurement forces the supported two-line date branch as a conservative font bound.
  const h = harness({ latinWidth: .8 })
  h.data.title = '活动标题'.repeat(13).slice(0, 50)
  h.data.subtitle = '活动介绍'.repeat(10)
  h.data.highlights = ['第一项亮点内容'.repeat(4).slice(0, 24), '第二项亮点内容'.repeat(4).slice(0, 24)]
  h.data.endsAt = '2027-01-01T04:00:00Z'
  h.data.location = '活动地点详细地址'.repeat(63).slice(0, 500)
  h.data.feeType = 'paid'; h.data.feeAmount = 99999999
  await h.run({ brandName: '品牌名称'.repeat(8).slice(0, 30) })
  const title = h.draws.filter(draw => draw.y >= 112 && draw.y < 262 && draw.size > 26)
  const subtitle = h.draws.filter(draw => draw.size === 26 && draw.y < 346)
  const highlights = h.draws.filter(draw => draw.x === 234)
  const facts = h.draws.filter(draw => draw.x === 150)
  assert.equal(title.map(draw => draw.value).join(''), h.data.title)
  assert.ok(Math.max(...title.map(draw => draw.y + draw.size)) < Math.min(...subtitle.map(draw => draw.y)))
  assert.ok(Math.max(...subtitle.map(draw => draw.y + draw.size)) < 346)
  assert.equal(highlights.length, 4)
  assert.equal(Math.max(...highlights.map(draw => draw.y + draw.size)), 1045)
  assert.ok(highlights.every(draw => draw.y + draw.size < 1070))
  assert.equal(facts.length, 5)
  assert.equal(Math.max(...facts.map(draw => draw.y + draw.size)), 1234)
  assert.ok(facts.every(draw => draw.y + draw.size < 1240))
  assert.ok(facts.every((draw, index) => index === facts.length - 1 || draw.y + draw.size < facts[index + 1].y))
})

test('missing or failed QR image never yields a shareable poster; export errors propagate', async () => {
  const missing = harness()
  await assert.rejects(missing.run({ codePath: '' }), /活动小程序码/)
  assert.equal(missing.exports.length, 0)
  const failed = harness({ failImage: '/code' })
  await assert.rejects(failed.run(), /活动小程序码加载失败/)
  assert.equal(failed.exports.length, 0)
  await assert.rejects(harness({ failExport: true }).run(), /海报导出失败/)
})
