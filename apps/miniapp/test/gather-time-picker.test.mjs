import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { URL } from 'node:url'
import ts from 'typescript'

const require = createRequire(import.meta.url)
function harness(props = {}) {
  const source = readFileSync(new URL('../src/components/business/GatherTimePicker.vue', import.meta.url), 'utf8').match(/<script setup lang="ts">([\s\S]*?)<\/script>/)[1]
  const code = ts.transpileModule(source + '\nexport { startDate, startTime, endDate, endTime, error, confirm, selectStartDate };', { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
  const page = {}, events = []
  new Function('require', 'exports', 'defineProps', 'defineEmits', code)(require, page, () => props, () => (...args) => events.push(args))
  return { page, events }
}

test('existing instants are shown in Beijing time without submitting them automatically', () => {
  const h = harness({ startsAt:'2099-05-01T15:30:00Z', endsAt:'2099-05-01T17:00:00Z' })
  assert.equal(h.page.startDate.value,'2099-05-01')
  assert.equal(h.page.startTime.value,'23:30')
  assert.equal(h.page.endDate.value,'2099-05-02')
  assert.equal(h.page.endTime.value,'01:00')
  assert.equal(h.events.length,0)
  h.page.confirm()
  assert.deepEqual(h.events,[['confirm',{startsAt:'2099-05-01T23:30:00+08:00',endsAt:'2099-05-02T01:00:00+08:00'}]])
})

test('missing fields, past times, and reverse ranges cannot be submitted', () => {
  const h = harness({date:'2099-05-01'})
  h.page.confirm()
  assert.match(h.page.error.value,/请选择/)
  h.page.startTime.value='14:00'; h.page.endTime.value='13:00'
  h.page.confirm()
  assert.match(h.page.error.value,/结束时间/)
  h.page.startDate.value='2000-01-01'; h.page.endDate.value='2000-01-01'
  h.page.confirm()
  assert.match(h.page.error.value,/晚于当前时间/)
  assert.equal(h.events.length,0)
})

test('changing the start date carries a same-day end date and disabled controls emit nothing', () => {
  const h = harness({date:'2099-05-01'})
  h.page.selectStartDate('2099-05-03')
  assert.equal(h.page.endDate.value,'2099-05-03')
  h.page.startTime.value='09:00'; h.page.endTime.value='10:00'
  h.page.confirm()
  assert.equal(h.events.length,1)
  const disabled = harness({startsAt:'2099-05-01T09:00:00+08:00',endsAt:'2099-05-01T10:00:00+08:00',disabled:true})
  disabled.page.selectStartDate('2099-05-03'); disabled.page.confirm()
  assert.equal(disabled.page.startDate.value,'2099-05-01')
  assert.equal(disabled.events.length,0)
})
