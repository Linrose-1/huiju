import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import ts from 'typescript'

const source = readFileSync(new URL('../src/services/gather-history.ts', import.meta.url), 'utf8')
const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
function setup() {
  let now = Date.UTC(2026, 10, 14)
  const storage = new Map()
  const methods = {}
  new Function('exports', 'uni', 'Date', code)(methods, {
    getStorageSync: key => storage.get(key),
    setStorageSync: (key, value) => storage.set(key, value),
    removeStorageSync: key => storage.delete(key),
  }, { now: () => now })
  const item = (id, idea) => ({ id, idea, updatedAt: now, openingFacts: [], exchanges: [] })
  return { ...methods, storage, item, advance: ms => { now += ms } }
}

test('reading history never extends retention and removes the stored transcript at exactly seven days', () => {
  const { archiveGatherHistory, readGatherHistory, storage, item, advance } = setup()
  const first = item('one', '周末读书会')
  archiveGatherHistory('local:A', first)
  advance(7 * 86_400_000 - 1)
  assert.deepEqual(readGatherHistory('local:A'), [first])
  advance(1)
  assert.deepEqual(readGatherHistory('local:A'), [])
  assert.equal(storage.size, 0)
  archiveGatherHistory('local:A', first)
  assert.equal(storage.size, 0)
})

test('updates replace only the matching session, order by latest change, and isolate accounts and API environments', () => {
  const { archiveGatherHistory, readGatherHistory, item, advance } = setup()
  const initial = item('first', '读书会')
  archiveGatherHistory('local:A', initial)
  advance(100)
  const next = item('second', '徒步')
  archiveGatherHistory('local:A', next)
  advance(100)
  const changed = item('first', '读书会')
  changed.exchanges.push({ prompt:'在哪里？', answer:'交流中心', facts:['地点 交流中心'] })
  archiveGatherHistory('local:A', changed)
  archiveGatherHistory('local:A', initial)
  assert.deepEqual(readGatherHistory('local:A'), [changed, next])
  assert.deepEqual(readGatherHistory('local:B'), [])
  assert.deepEqual(readGatherHistory('trial:A'), [])
  advance(7 * 86_400_000 - 100)
  assert.deepEqual(readGatherHistory('local:A'), [changed])
})
