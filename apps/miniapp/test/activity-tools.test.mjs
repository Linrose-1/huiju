import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readFileSync } from 'node:fs'
import { URL } from 'node:url'
import ts from 'typescript'

function harness(overrides = {}) {
  const calendar = [], locations = []
  const source = readFileSync(new URL('../src/services/wechat/activity-tools.ts', import.meta.url), 'utf8')
    .replace(/\/\/ #ifndef MP-WEIXIN[\s\S]*?\/\/ #endif/g, '')
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText
  const service = {}
  new Function('exports', 'uni', code)(service, { canIUse: () => true, addPhoneCalendar: options => calendar.push(options), openLocation: options => locations.push(options), ...overrides })
  return { service, calendar, locations }
}
const activity = { title: '活动', startsAt: '2026-11-08T15:00:00+08:00', endsAt: '2026-11-08T17:00:00+08:00', location: '活动地点' }

test('calendar passes seconds and selected reminder to WeChat, including no reminder', async () => {
  const h = harness()
  const pending = h.service.addActivityCalendar(activity, h.service.defaultReminderIndex)
  assert.equal(h.calendar[0].startTime, Date.parse(activity.startsAt) / 1000)
  assert.equal(h.calendar[0].endTime, String(Date.parse(activity.endsAt) / 1000))
  assert.equal(h.calendar[0].alarmOffset, 3600)
  assert.equal(h.calendar[0].alarm, true)
  h.calendar[0].success(); assert.equal(await pending, true)
  const silent = h.service.addActivityCalendar(activity, 0)
  assert.equal(h.calendar[1].alarm, false)
  h.calendar[1].success(); await silent
})
test('calendar rejects unsupported and invalid values; cancellation is not success and permission failures can retry', async () => {
  const unsupported = harness({ canIUse: () => false })
  await assert.rejects(unsupported.service.addActivityCalendar(activity, 4), /不支持/)
  assert.equal(unsupported.calendar.length, 0)
  const h = harness()
  await assert.rejects(h.service.addActivityCalendar({ ...activity, startsAt: 'invalid' }, 4), /时间无效/)
  await assert.rejects(h.service.addActivityCalendar(activity, 99), /时间无效/)
  const cancelled = h.service.addActivityCalendar(activity, 4)
  h.calendar[0].fail({ errMsg: 'addPhoneCalendar:fail cancel' }); assert.equal(await cancelled, false)
  const denied = h.service.addActivityCalendar(activity, 4)
  h.calendar[1].fail({ errMsg: 'addPhoneCalendar:fail auth deny' }); await assert.rejects(denied, /日历权限/)
})
test('map never guesses missing coordinates, accepts zero, and preserves address and coordinates', async () => {
  const h = harness()
  for (const coords of [{}, { locationLatitude: 1 }, { locationLatitude: NaN, locationLongitude: 2 }, { locationLatitude: 91, locationLongitude: 0 }]) {
    await assert.rejects(h.service.openActivityLocation({ location: '旧地址', ...coords }), /补充/)
  }
  assert.equal(h.locations.length, 0)
  const pending = h.service.openActivityLocation({ location: '地点', locationLatitude: 0, locationLongitude: 0 })
  assert.equal(h.locations[0].latitude, 0)
  assert.equal(h.locations[0].address, '地点')
  h.locations[0].success(); await pending
})
