import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readFileSync } from 'node:fs'
import { URL } from 'node:url'
import ts from 'typescript'
const source = readFileSync(new URL('../src/services/presentation.ts', import.meta.url), 'utf8')
const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
const exported = {}
new Function('exports', code)(exported)

test('activity time always renders China UTC+8 across UTC day boundary', () => {
  assert.equal(exported.dateTime('2026-09-25T20:30:00.000Z'), '2026.09.26 04:30')
  assert.equal(exported.dateTime('2026-09-26T01:05:00+08:00'), '2026.09.26 01:05')
  assert.equal(exported.dateTime('not-a-date'), '时间待更新')
})

test('upcoming excludes past and already-started activities and sorts ascending without modifying source', () => {
  const now = Date.parse('2026-09-26T08:00:00Z')
  const items = [
    { id: 'late', startsAt: '2026-09-27T08:00:00Z' },
    { id: 'past', startsAt: '2026-09-25T08:00:00Z' },
    { id: 'started', startsAt: '2026-09-26T08:00:00Z' },
    { id: 'soon', startsAt: '2026-09-26T09:00:00Z' },
  ]
  assert.deepEqual(exported.upcomingActivities(items, now).map(item => item.id), ['soon', 'late'])
  assert.equal(items[0].id, 'late')
})

test('activity range retains end time and both dates when crossing midnight in China', () => {
  assert.equal(exported.activityTimeRange('2026-10-03T06:00:00Z', '2026-10-03T09:30:00Z'), '2026.10.03 14:00 – 17:30')
  assert.equal(exported.activityTimeRange('2026-10-03T15:00:00Z', '2026-10-03T17:00:00Z'), '2026.10.03 23:00 – 2026.10.04 01:00')
  assert.equal(exported.activityTimeRange('invalid', '2026-10-03T09:30:00Z'), '时间待更新')
})

test('cancelled and removed activities never show a successful attendance instruction', () => {
  for (const state of ['cancelled', 'removed']) {
    for (const status of ['active', 'cancelled']) {
      const result = exported.registrationStatus({ registrationState: state }, { status })
      assert.notEqual(result.tone, 'success')
      assert.notEqual(result.icon, 'checkmarkempty')
      assert.equal(result.description.includes('请按时参加'), false)
    }
  }
  assert.equal(exported.registrationStatus({ registrationState: 'open' }, { status: 'active' }).tone, 'success')
  assert.equal(exported.registrationStatus({ registrationState: 'open' }, { status: 'cancelled' }).title, '已取消报名')
})
