import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { URL } from 'node:url'
import ts from 'typescript'
const require = createRequire(import.meta.url)
function execute(source, dependencies = {}, extras = {}) {
  const exports = {}
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText
  new Function('require', 'exports', ...Object.keys(extras), code)(name => dependencies[name] || require(name), exports, ...Object.values(extras))
  return exports
}
const helpers = execute(readFileSync(new URL('../src/services/activity-rich-text.ts', import.meta.url), 'utf8'))
const { normalizeActivityRichText: normalize, activityRichTextNodes: nodes } = helpers
test('normalization keeps text and allowed formats without accepting links or embedded images', () => {
  assert.deepEqual(normalize({ ops: [{ insert: '<script>x</script>', attributes: { bold: true, link: 'javascript:x', color: 'red' } }, { insert: '\n' }] }), {
    text: '<script>x</script>', delta: { ops: [{ insert: '<script>x</script>', attributes: { bold: true } }, { insert: '\n' }] }
  })
  assert.throws(() => normalize({ ops: [{ insert: { image: 'https://image' } }] }), /仅支持文字/)
  assert.throws(() => normalize({ ops: Array.from({ length: 1001 }, () => ({ insert: 'a' })) }), /片段过多/)
  assert.equal(normalize({ ops: [{ insert: 'a'.repeat(10000) + '\n' }] }).text.length, 10000)
  assert.equal(normalize({ ops: [{ insert: 'a'.repeat(10001) + '\n' }] }).text.length, 10001)
  assert.equal(normalize(null, '末尾\n').text, '末尾\n')
})
test('preview builds safe paragraphs and separate ordered/bullet lists without interpreting text as HTML', () => {
  const result = nodes({ ops: [{ insert: '<img src=x>', attributes: { bold: true, italic: true, underline: true } }, { insert: '\n' },
    { insert: 'one' }, { insert: '\n', attributes: { list: 'ordered' } }, { insert: 'two\n', attributes: { list: 'ordered' } },
    { insert: 'bullet\n', attributes: { list: 'bullet' } }, { insert: 'last' }] })
  assert.deepEqual(result.map(item => item.name), ['p', 'ol', 'ul', 'p'])
  assert.equal(result[1].children.length, 2)
  assert.deepEqual(result[0].children[0], { name: 'span', attrs: {style: 'text-decoration:underline;'}, children: [{ name: 'em', children: [{ name: 'strong', children: [{ type: 'text', text: '<img src=x>' }] }] }] })
  assert.deepEqual(nodes({ ops: [{ insert: { image: 'x' } }] }, '原文')[0].children, [{ type: 'text', text: '原文' }])
})
function harness(deferContents = false) {
  const props = { value: { text: '初始', delta: null }, disabled: false }, emitted = [], sets = [], calls = []
  let watch, resolveReady, dispose
  const context = { setContents(options) { sets.push(options); if (!deferContents) { options.success?.(); options.complete?.() } }, format: (...args) => calls.push(args) }
  const selection = { in() { return this }, select() { return this }, context(callback) { resolveReady = callback; return this }, exec() {} }
  const source = readFileSync(new URL('../src/components/business/ActivityRichEditor.vue', import.meta.url), 'utf8').match(/<script setup lang="ts">([\s\S]*?)<\/script>/)[1]
  const component = execute(source + '\nexport { onReady, onInput, format, retry, error };', {
    '@/services/activity-rich-text': helpers,
    vue: { ref: value => ({ value }), computed: fn => ({ get value() { return fn() } }), getCurrentInstance: () => ({ uid: 1, proxy: {} }), watch: (_source, callback) => { watch = callback }, onBeforeUnmount: callback => { dispose = callback } }
  }, { defineProps: () => props, defineEmits: () => (...args) => emitted.push(args), uni: { createSelectorQuery: () => selection } })
  return { props, component, sets, calls, emitted, change: () => watch(), resolve: () => resolveReady({ context }), dispose: () => dispose() }
}
test('late editor readiness uses latest external value; external replacements and disabled formatting work', () => {
  const h = harness()
  h.component.onReady()
  h.props.value = { text: '后到数据', delta: null }; h.change(); h.resolve()
  assert.deepEqual(h.sets[0].delta, { ops: [{ insert: '后到数据\n' }] })
  h.props.value = { text: '新正文', delta: null }; h.change()
  assert.deepEqual(h.sets[1].delta, { ops: [{ insert: '新正文\n' }] })
  h.props.disabled = true; h.component.format('bold'); assert.equal(h.calls.length, 0)
  h.props.disabled = false; h.component.format('list', 'ordered'); assert.deepEqual(h.calls, [['list', 'ordered']])
})
test('input preserves overlength content, blocks unsupported embeds, and does not reset cursor on parent echo', () => {
  const h = harness(); h.component.onReady(); h.resolve()
  const text = 'a'.repeat(10001)
  h.component.onInput({ detail: { delta: { ops: [{ insert: text + '\n' }] } } })
  const value = h.emitted.findLast(item => item[0] === 'update:value')[1]
  assert.equal(value.text, text)
  assert.equal(h.emitted.findLast(item => item[0] === 'validity')[1], false)
  h.props.value = value; h.change(); assert.equal(h.sets.length, 1)
  const previous = h.emitted.filter(item => item[0] === 'update:value').length
  h.component.onInput({ detail: { delta: { ops: [{ insert: { image: 'x' } }] } } })
  assert.equal(h.emitted.filter(item => item[0] === 'update:value').length, previous)
  assert.equal(h.emitted.findLast(item => item[0] === 'validity')[1], false)
})
test('unmount ignores a delayed context callback', () => {
  const h = harness(); h.component.onReady(); h.dispose(); h.resolve()
  assert.equal(h.sets.length, 0)
})

test('explicit reload restores the saved text after unsupported input and unlocks validity', () => {
  const h = harness(); h.component.onReady(); h.resolve()
  h.component.onInput({detail:{delta:{ops:[{insert:{image:'x'}}]}}})
  assert.equal(h.emitted.at(-1)[1],false)
  h.component.retry();h.resolve()
  assert.equal(h.sets.length,2)
  assert.equal(h.component.error.value,'')
  assert.equal(h.emitted.at(-1)[1],true)
})
test('external updates during setContents are serialized and apply the latest value', () => {
  const h = harness(true); h.component.onReady(); h.resolve()
  h.props.value = { text: '中间内容', delta: null }; h.change()
  h.props.value = { text: '最新内容', delta: null }; h.change()
  assert.equal(h.sets.length, 1)
  h.sets[0].success(); h.sets[0].complete()
  assert.equal(h.sets.length, 2)
  assert.deepEqual(h.sets[1].delta, { ops: [{ insert: '最新内容\n' }] })
})
