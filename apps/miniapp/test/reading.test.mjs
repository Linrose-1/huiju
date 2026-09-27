import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readFileSync } from 'node:fs'
import ts from 'typescript'
import { URL } from 'node:url'
class ApiError extends Error { constructor(code) { super(code); this.code = code } }
function harness() {
  const storage = new Map(), calls = []
  let failure
  const api = { recordView: async (id, input) => {
    calls.push({ id, ...input })
    if (failure) { const e = failure; failure = null; throw e }
  } }
  const code = ts.transpileModule(readFileSync(new URL('../src/services/reading.ts', import.meta.url), 'utf8'), {
    compilerOptions:{module:ts.ModuleKind.CommonJS, target:ts.ScriptTarget.ES2022}
  }).outputText
  const result = {}
  new Function('require', 'exports', 'uni', code)(name => name === './api' ? {api, ApiError} : {API_BASE_URL:'test'}, result, {
    getStorageSync: key => storage.get(key), setStorageSync: (key, value) => storage.set(key, value)
  })
  return { ...result, calls, fail: code => {failure = new ApiError(code)} }
}
test('one visit retries the same event; a new visit keeps the visitor with a new event', async () => {
  const h = harness(), visit = h.createReadingVisit()
  await visit.record('a', () => true); await visit.record('a', () => true)
  await h.createReadingVisit().record('a', () => true)
  assert.deepEqual(h.calls[0], h.calls[1])
  assert.notEqual(h.calls[1].eventId, h.calls[2].eventId)
  assert.equal(h.calls[1].visitorId, h.calls[2].visitorId)
})
test('account conflict rotates both identifiers; a stale conflict cannot rotate or retry', async () => {
  const h = harness(), visit = h.createReadingVisit()
  h.fail('VISITOR_CHANGED'); await visit.record('a', () => true)
  assert.notEqual(h.calls[0].visitorId, h.calls[1].visitorId)
  assert.notEqual(h.calls[0].eventId, h.calls[1].eventId)
  h.fail('VISITOR_CHANGED'); await assert.rejects(visit.record('a', () => false))
  assert.equal(h.calls.length, 3)
  await h.createReadingVisit().record('a', () => true)
  assert.equal(h.calls[3].visitorId, h.calls[1].visitorId)
})
test('network failure retains the event for an explicit retry', async () => {
  const h = harness(), visit = h.createReadingVisit()
  h.fail('NETWORK_ERROR'); await assert.rejects(visit.record('a', () => true))
  await visit.record('a', () => true)
  assert.deepEqual(h.calls[0], h.calls[1])
})
