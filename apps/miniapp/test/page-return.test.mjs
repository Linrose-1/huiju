import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readFileSync } from 'node:fs'
import { URL } from 'node:url'
import ts from 'typescript'

test('the home fallback appears on direct entry and stays hidden beside native back navigation', () => {
  const source = readFileSync(new URL('../src/components/base/PageReturn.vue', import.meta.url), 'utf8')
    .match(/<script setup lang="ts">([\s\S]*?)<\/script>/)[1]
  const code = ts.transpileModule(source + '\nexport { standalone };', {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText
  for (const depth of [1, 2, 3]) {
    let mount
    const exports = {}
    const dependencies = { vue: { ref: value => ({ value }), onMounted: fn => { mount = fn } }, '@/services/navigation': { hasPreviousPage: () => depth > 1 } }
    new Function('require', 'exports', 'getCurrentPages', code)(name => dependencies[name] || {}, exports, () => Array(depth).fill({}))
    mount()
    assert.equal(exports.standalone.value, depth === 1)
  }
})
