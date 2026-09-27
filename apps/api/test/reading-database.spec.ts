import 'reflect-metadata'
import { randomUUID } from 'node:crypto'
import { eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'
import { createDatabase } from '../src/database/db.js'
import { activities } from '../src/database/schema/activities.js'
import { readingEvents } from '../src/database/schema/interactions.js'
import { members } from '../src/database/schema/members.js'
import { FlowDatabase } from '../src/flow/common.js'
import { IdentityService } from '../src/flow/identity.js'
import { OrganizerService } from '../src/flow/organizer.js'
import { ActivityService } from '../src/flow/activity.js'
import { ReadingService } from '../src/flow/reading.js'
import { WechatAdapter } from '../src/flow/wechat.js'

// Opt-in only after migration and explicit authorization; never loads .env or DATABASE_URL.
const enabled = process.env.HUIJU_DB_TEST === 'reading-rollback'
describe.skipIf(!enabled)('reading on real MySQL in an outer rollback transaction', () => {
  it('preserves event idempotency, merges anonymous/multi-device history and protects public fields', async () => {
    const connectionString = process.env.TEST_DATABASE_URL
    if (!connectionString) throw new Error('TEST_DATABASE_URL is required')
    const target = new URL(connectionString)
    if (target.hostname !== '127.0.0.1' || target.port !== '3306' || target.pathname !== '/huiju') throw new Error('Rollback test target must be reviewed local 127.0.0.1:3306/huiju')
    const connection = createDatabase(connectionString)
    const rollback = new Error('READING_ROLLBACK_TEST_COMPLETE')
    let activityId = ''
    let completed = false
    try {
      await expect(connection.db.transaction(async tx => {
        const database = Object.create(FlowDatabase.prototype) as FlowDatabase
        Object.defineProperty(database, 'db', { value: tx })
        class FixtureWechat extends WechatAdapter {
          override async exchange(code: string) { return { appId: 'huiju-reading-rollback-test', openId: code, unionId: null } }
        }
        const identity = new IdentityService(database, new FixtureWechat())
        const organizer = new OrganizerService(database, identity)
        const reading = new ReadingService(database, identity)
        const registration = new ActivityService(database, identity)
        const owner = await identity.login(randomUUID())
        const outsider = await identity.login(randomUUID())
        const ownerHeader = `Bearer ${owner.token}`
        const outsiderHeader = `Bearer ${outsider.token}`
        await tx.update(members).set({ boundPhone: '19900000001', displayName: '阅读回滚测试', nameSetByUser: true, avatarUrl: '/reading-fixture.png', avatarSetByUser: true }).where(eq(members.id, owner.member.id))
        const now = Date.now()
        const draft = await organizer.create({ title: '阅读回滚测试', description: '仅存在于回滚事务', location: '测试', consultationContact: '测试', startsAt: new Date(now + 7200000).toISOString(), endsAt: new Date(now + 10800000).toISOString(), feeType: 'free', questions: [] }, ownerHeader)
        activityId = draft.id
        const input = { eventId: randomUUID(), visitorId: randomUUID() }
        await expect(reading.record(activityId, input)).rejects.toThrow('活动不存在')
        await organizer.publish(activityId, ownerHeader)
        expect(await reading.stats(activityId, ownerHeader)).toEqual({ views: 0, visitors: 0, conversionRate: null })
        await reading.record(activityId, input)
        await reading.record(activityId, input)
        expect(await reading.stats(activityId, ownerHeader)).toEqual({ views: 1, visitors: 1, conversionRate: 0 })
        expect(await reading.readers(activityId)).toEqual({ items: [], total: 0, hasMore: false })
        await reading.record(activityId, input, ownerHeader)
        expect(await reading.stats(activityId, ownerHeader)).toEqual({ views: 1, visitors: 1, conversionRate: 0 })
        await reading.record(activityId, { ...input, eventId: randomUUID() }, ownerHeader)
        await reading.record(activityId, { eventId: randomUUID(), visitorId: randomUUID() }, ownerHeader)
        expect(await reading.stats(activityId, ownerHeader)).toEqual({ views: 3, visitors: 1, conversionRate: 0 })
        expect(await reading.readers(activityId)).toEqual({ items: [{ memberId: owner.member.id, avatarUrl: '/reading-fixture.png', displayName: '阅读回滚测试' }], total: 1, hasMore: false })
        await expect(reading.record(activityId, input, outsiderHeader)).rejects.toMatchObject({ response: { code: 'VISITOR_CHANGED' } })
        await expect(reading.record(activityId, { eventId: input.eventId, visitorId: randomUUID() }, outsiderHeader)).rejects.toMatchObject({ response: { code: 'READING_EVENT_CONFLICT' } })
        await expect(reading.stats(activityId, outsiderHeader)).rejects.toMatchObject({ response: { code: 'FORBIDDEN' } })
        await reading.record(activityId, { eventId: randomUUID(), visitorId: randomUUID() }, outsiderHeader)
        const readers = await reading.readers(activityId)
        expect(readers.total).toBe(2)
        expect(readers.items).toContainEqual({ memberId: outsider.member.id, avatarUrl: null, displayName: `会员${outsider.member.memberNumber}` })
        for (const row of readers.items) expect(Object.keys(row).sort()).toEqual(['avatarUrl', 'displayName', 'memberId'])
        await registration.write(activityId, ownerHeader, 'register', { contactPhone: '19900000001', answers: [] })
        expect((await reading.stats(activityId, ownerHeader)).conversionRate).toBe(50)
        await registration.write(activityId, ownerHeader, 'cancel')
        expect((await reading.stats(activityId, ownerHeader)).conversionRate).toBe(0)
        await tx.update(members).set({ displayName: '更新名称' }).where(eq(members.id, owner.member.id))
        expect((await reading.readers(activityId)).items).toContainEqual({ memberId: owner.member.id, avatarUrl: '/reading-fixture.png', displayName: '更新名称' })
        expect(await reading.readers(activityId, 2)).toEqual({ items: [], total: 2, hasMore: false })
        await tx.update(activities).set({ moderation: 'removed' }).where(eq(activities.id, activityId))
        await reading.record(activityId, { eventId: randomUUID(), visitorId: randomUUID() })
        expect((await reading.stats(activityId, ownerHeader)).views).toBe(4)
        expect(await reading.readers(activityId)).toEqual({ items: [], total: 0, hasMore: false })
        completed = true
        throw rollback
      })).rejects.toBe(rollback)
      expect(completed).toBe(true)
      expect(await connection.db.select().from(readingEvents).where(eq(readingEvents.activityId, activityId))).toEqual([])
      expect(await connection.db.select().from(activities).where(eq(activities.id, activityId))).toEqual([])
    } finally { await connection.pool.end() }
  }, 30000)
})
