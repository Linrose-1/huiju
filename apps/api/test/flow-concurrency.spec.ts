import 'reflect-metadata'
import { randomUUID } from 'node:crypto'
import { and, eq, inArray, sql } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'
import { createDatabase } from '../src/database/db.js'
import { members, wechatIdentities } from '../src/database/schema/members.js'
import { activities } from '../src/database/schema/activities.js'
import { registrations, registrationOperations } from '../src/database/schema/registrations.js'
import { ActivityService } from '../src/flow/activity.js'
import { FlowDatabase } from '../src/flow/common.js'
import { IdentityService } from '../src/flow/identity.js'
import { WechatAdapter } from '../src/flow/wechat.js'

// No dotenv, no DATABASE_URL fallback, no DDL. This mode writes committed
// fixtures only in the explicitly authorized local development database.
const enabled = process.env.HUIJU_DB_TEST === 'local-concurrency'
const trackedTables = [
  'members', 'wechat_identities', 'member_visibilities', 'member_sessions',
  'activities', 'registration_questions', 'registrations',
  'registration_answers', 'registration_operations',
] as const

describe.skipIf(!enabled)('real MySQL multiple-connection concurrency', () => {
  it('fixes the first invitation and serializes seats, retries and cancellation', async () => {
    const connectionString = process.env.TEST_DATABASE_URL
    if (!connectionString) throw new Error('TEST_DATABASE_URL is required')
    const target = new URL(connectionString)
    if (target.protocol !== 'mysql:' || target.hostname !== '127.0.0.1'
      || target.port !== '3306' || target.pathname !== '/huiju') {
      throw new Error('Local concurrency test requires 127.0.0.1:3306/huiju')
    }
    const connection = createDatabase(connectionString)
    const db = connection.db
    const runId = randomUUID()
    const appId = `huiju-concurrency-${runId}`
    const inviterIds = [randomUUID(), randomUUID()]
    const inviteCodes = inviterIds.map(id => id.replaceAll('-', ''))
    const activityId = randomUUID()
    const loginCodes = [randomUUID(), randomUUID()]
    const snapshot = async () => {
      const counts: Record<string, unknown> = {}
      for (const table of trackedTables) {
        const [rows] = await db.execute(sql.raw(`SELECT COUNT(*) AS total FROM ${table}`))
        counts[table] = rows
      }
      return counts
    }
    let before: Record<string, unknown> | undefined
    try {
      const [databaseName] = await connection.pool.query('SELECT DATABASE() AS name')
      expect(databaseName).toEqual([{ name: 'huiju' }])
      before = await snapshot()
      const [root] = await db.select({ id: members.id }).from(members)
        .where(eq(members.kind, 'platform_root')).limit(1)
      if (!root) throw new Error('Existing platform root is required')
      await db.insert(members).values(inviterIds.map((id, index) => ({
        id, memberNumber: `I${id.slice(0, 24)}`, inviteCode: inviteCodes[index],
        inviterMemberId: root.id,
      })))
      const database = Object.create(FlowDatabase.prototype) as FlowDatabase
      Object.defineProperty(database, 'db', { value: db })
      class FixtureWechat extends WechatAdapter {
        override async exchange(code: string) {
          return { appId, openId: code, unionId: null }
        }
      }
      const identity = new IdentityService(database, new FixtureWechat())
      const service = new ActivityService(database, identity)

      // Independent pool connections actually compete on the identity unique key.
      // Only the upstream WeChat exchange is replaced; all persistence is MySQL.
      const initial = await Promise.allSettled([
        identity.login(loginCodes[0], inviteCodes[0]),
        identity.login(loginCodes[0], inviteCodes[1]),
        identity.login(loginCodes[0], inviteCodes[0]),
      ])
      expect(initial.every(result => result.status === 'fulfilled')).toBe(true)
      const sessions = initial.map(result => {
        if (result.status !== 'fulfilled') throw result.reason
        return result.value
      })
      expect(new Set(sessions.map(session => session.member.id)).size).toBe(1)
      const memberId = sessions[0].member.id
      const identityRows = await db.select().from(wechatIdentities).where(and(
        eq(wechatIdentities.appId, appId), eq(wechatIdentities.openId, loginCodes[0]),
      ))
      expect(identityRows).toHaveLength(1)
      const [firstMember] = await db.select().from(members).where(eq(members.id, memberId))
      expect(inviterIds).toContain(firstMember.inviterMemberId)
      const oppositeInvite = firstMember.inviterMemberId === inviterIds[0] ? inviteCodes[1] : inviteCodes[0]
      const latest = await identity.login(loginCodes[0], oppositeInvite)
      expect(latest.member.id).toBe(memberId)
      const [fixedMember] = await db.select().from(members).where(eq(members.id, memberId))
      expect(fixedMember.inviterMemberId).toBe(firstMember.inviterMemberId)
      const second = await identity.login(loginCodes[1], inviteCodes[1])
      const participantIds = [memberId, second.member.id]
      await db.update(members).set({
        boundPhone: '13800000000', avatarUrl: '/test-fixture.png',
        avatarSetByUser: true, displayName: '并发测试会员', nameSetByUser: true,
      }).where(inArray(members.id, participantIds))
      const headers = [`Bearer ${latest.token}`, `Bearer ${second.token}`]
      const now = Date.now()
      await db.insert(activities).values({
        id: activityId, organizerMemberId: inviterIds[0], title: '【本地测试】并发名额验证',
        description: '仅测试 fixture', location: '本地测试', consultationContact: '测试咨询',
        startsAt: new Date(now + 7200000), endsAt: new Date(now + 10800000),
        registrationDeadline: new Date(now + 3600000), capacity: 1,
        feeType: 'free', lifecycle: 'published', publishedAt: new Date(now),
      })
      const input = { contactPhone: '13900000000', answers: [] }
      const race = await Promise.allSettled(headers.map(header => service.write(activityId, header, 'register', input)))
      expect(race.filter(result => result.status === 'fulfilled')).toHaveLength(1)
      const winnerIndex = race.findIndex(result => result.status === 'fulfilled')
      const loserIndex = 1 - winnerIndex
      const loserResult = race[loserIndex]
      if (loserResult.status !== 'rejected') throw new Error('Expected a rejected final-seat contender')
      expect(loserResult.reason).toMatchObject({ response: { code: 'CAPACITY_FULL' } })
      const firstRegistration = await service.mine(activityId, headers[winnerIndex])
      expect((await service.detail(activityId)).activeRegistrationCount).toBe(1)
      const retries = await Promise.allSettled(Array.from({ length: 4 }, () =>
        service.write(activityId, headers[winnerIndex], 'register', input)))
      expect(retries.every(result => result.status === 'fulfilled'
        && result.value.id === firstRegistration.id)).toBe(true)
      expect((await service.detail(activityId)).activeRegistrationCount).toBe(1)
      expect(await db.select().from(registrations).where(eq(registrations.activityId, activityId))).toHaveLength(1)

      const cancellations = await Promise.allSettled(Array.from({ length: 3 }, () =>
        service.write(activityId, headers[winnerIndex], 'cancel')))
      expect(cancellations.every(result => result.status === 'fulfilled')).toBe(true)
      expect((await service.detail(activityId)).activeRegistrationCount).toBe(0)
      const secondRegistration = await service.write(activityId, headers[loserIndex], 'register', input)
      await expect(service.write(activityId, headers[winnerIndex], 'register', input)).rejects.toThrow('名额已满')
      await service.write(activityId, headers[loserIndex], 'cancel')
      const restored = await service.write(activityId, headers[winnerIndex], 'register', input)
      expect(restored.id).toBe(firstRegistration.id)
      expect(restored.id).not.toBe(secondRegistration.id)
      expect((await service.detail(activityId)).activeRegistrationCount).toBe(1)
      const operations = await db.select().from(registrationOperations)
        .where(eq(registrationOperations.registrationId, firstRegistration.id))
      expect(operations.map(row => row.action).sort()).toEqual(['cancelled', 'registered', 'reregistered'])
      const [activity] = await db.select().from(activities).where(eq(activities.id, activityId))
      expect(activity.hasRegistrationEver).toBe(true)
      expect(await db.select().from(registrations).where(eq(registrations.activityId, activityId))).toHaveLength(2)
    } finally {
      try {
        // These predicates only address UUIDs/appId generated by this test run.
        // allSettled above ensures every concurrent action ends before cleanup.
        await db.delete(registrations).where(eq(registrations.activityId, activityId))
        await db.delete(activities).where(eq(activities.id, activityId))
        const createdIdentities = await db.select({ memberId: wechatIdentities.memberId })
          .from(wechatIdentities).where(eq(wechatIdentities.appId, appId))
        for (const row of createdIdentities) {
          await db.delete(members).where(eq(members.id, row.memberId))
        }
        await db.delete(members).where(inArray(members.id, inviterIds))
        if (before) expect(await snapshot()).toEqual(before)
      } finally {
        await connection.pool.end()
      }
    }
  }, 60000)
})
