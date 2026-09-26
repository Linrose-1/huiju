import 'reflect-metadata'
import { randomUUID } from 'node:crypto'
import { and, eq, sql } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'
import { createDatabase } from '../src/database/db.js'
import { members, wechatIdentities } from '../src/database/schema/members.js'
import { activities, registrationQuestions } from '../src/database/schema/activities.js'
import { registrations, registrationOperations } from '../src/database/schema/registrations.js'
import { ActivityService } from '../src/flow/activity.js'
import { FlowDatabase } from '../src/flow/common.js'
import { IdentityService } from '../src/flow/identity.js'
import { WechatAdapter } from '../src/flow/wechat.js'

// Explicit opt-in only. No dotenv loading, migration, or fallback to DATABASE_URL.
const enabled = process.env.HUIJU_DB_TEST === 'rollback'
describe.skipIf(!enabled)('real MySQL flow in a rolled-back transaction', () => {
  it('persists identity, eligibility, answers, cancellation and visibility without retaining fixtures', async () => {
    const connectionString = process.env.TEST_DATABASE_URL
    if (!connectionString) throw new Error('TEST_DATABASE_URL is required')
    const target = new URL(connectionString)
    if (target.hostname !== '127.0.0.1' || target.port !== '3306' || target.pathname !== '/huiju') {
      throw new Error('Rollback test target must be the reviewed local 127.0.0.1:3306/huiju')
    }
    const connection = createDatabase(connectionString)
    const fixtureIds: string[] = []
    const rollback = new Error('ROLLBACK_TEST_COMPLETE')
    let completed = false
    try {
      const before = await connection.db.select({ count: sql<number>`count(*)` }).from(members)
      await expect(connection.db.transaction(async tx => {
        const database = Object.create(FlowDatabase.prototype) as FlowDatabase
        Object.defineProperty(database, 'db', { value: tx })
        class FixtureWechat extends WechatAdapter {
          override async exchange(code: string) { return { appId: 'huiju-rollback-test', openId: code, unionId: null } }
          override async phone() { return '13800000000' }
        }
        const identity = new IdentityService(database, new FixtureWechat())
        const service = new ActivityService(database, identity)
        const sessionA = await identity.login(randomUUID())
        const codeB = randomUUID()
        const sessionB = await identity.login(codeB, sessionA.member.inviteCode)
        const sessionC = await identity.login(randomUUID(), 'invalid-invite')
        fixtureIds.push(sessionA.member.id, sessionB.member.id, sessionC.member.id)
        const headerA = `Bearer ${sessionA.token}`
        const headerB = `Bearer ${sessionB.token}`
        const headerC = `Bearer ${sessionC.token}`
        const repeated = await identity.login(codeB, sessionC.member.inviteCode)
        expect(repeated.member.id).toBe(sessionB.member.id)
        const [memberB] = await tx.select().from(members).where(eq(members.id, sessionB.member.id))
        expect(memberB.inviterMemberId).toBe(sessionA.member.id)
        const [memberC] = await tx.select().from(members).where(eq(members.id, sessionC.member.id))
        const [root] = await tx.select().from(members).where(eq(members.id, memberC.inviterMemberId!))
        expect(root.kind).toBe('platform_root')
        expect(await identity.me(headerB)).toMatchObject({ profileComplete: false })
        await identity.phone(headerB, 'fixture-phone-code')
        await expect(identity.phone(headerB, 'second-code')).rejects.toThrow('手机号已绑定')
        await identity.profile(headerB, '回滚测试会员')
        expect(await identity.me(headerB)).toMatchObject({ profileComplete: false })
        // Avatar storage is tested separately; fixtures are marked explicitly, never exposed by production auth.
        await tx.update(members).set({ avatarUrl: '/fixture.png', avatarSetByUser: true }).where(eq(members.id, memberB.id))
        expect(await identity.me(headerB)).toMatchObject({ profileComplete: true })
        const activityId = randomUUID()
        const now = Date.now()
        await tx.insert(activities).values({
          id: activityId, organizerMemberId: sessionA.member.id, title: '回滚测试活动', description: '隔离事务内测试',
          location: '测试地点', consultationContact: '仅历史报名者可见', startsAt: new Date(now + 7200000),
          endsAt: new Date(now + 10800000), registrationDeadline: new Date(now + 3600000),
          capacity: 1, feeType: 'paid', feeAmountCents: 29900, lifecycle: 'published', publishedAt: new Date(now)
        })
        const questionIds = Array.from({ length: 4 }, () => randomUUID())
        await tx.insert(registrationQuestions).values(questionIds.map((id, index) => ({
          id, activityId, type: (['short_text', 'long_text', 'single', 'multiple'] as const)[index],
          prompt: `问题${index}`, required: true, sortOrder: index, options: index >= 2 ? ['甲', '乙'] : null
        })))
        const input = { contactPhone: '13900000000', answers: questionIds.map((questionId, index) => ({ questionId, value: index === 3 ? ['甲', '乙'] : index === 2 ? '甲' : '回答' })) }
        const publicDetail = await service.detail(activityId)
        expect(publicDetail).not.toHaveProperty('consultationContact')
        expect(Object.keys(publicDetail.organizer!).sort()).toEqual(['avatarUrl', 'displayName'])
        await expect(service.write(activityId, headerA, 'register', input)).rejects.toThrow('绑定手机号')
        await expect(service.write(activityId, headerB, 'register', { ...input, answers: [] })).rejects.toThrow('必填问题')
        const first = await service.write(activityId, headerB, 'register', input)
        expect(first.answers).toHaveLength(4)
        expect(first.contactPhone).toBe('13900000000')
        expect((await identity.me(headerB)).boundPhone).toBe('13800000000')
        expect((await service.write(activityId, headerB, 'register', input)).id).toBe(first.id)
        expect((await service.detail(activityId)).activeRegistrationCount).toBe(1)
        expect((await service.detail(activityId, headerB)).consultationContact).toBe('仅历史报名者可见')
        expect(Object.keys((await service.roster(activityId)).items[0]).sort()).toEqual(['avatarUrl', 'displayName'])
        await expect(service.mine(activityId, headerC)).rejects.toThrow('尚未报名')
        await tx.update(members).set({ boundPhone: '13700000000', displayName: '测试丙', nameSetByUser: true, avatarUrl: '/fixture.png', avatarSetByUser: true }).where(eq(members.id, sessionC.member.id))
        await expect(service.write(activityId, headerC, 'register', input)).rejects.toThrow('名额已满')
        await identity.profile(headerB, '更新名称')
        expect((await service.roster(activityId)).items[0].displayName).toBe('更新名称')
        await service.write(activityId, headerB, 'edit', { answers: input.answers })
        await service.write(activityId, headerB, 'cancel')
        await service.write(activityId, headerB, 'cancel')
        expect((await service.detail(activityId)).activeRegistrationCount).toBe(0)
        expect((await service.detail(activityId, headerB)).consultationContact).toBe('仅历史报名者可见')
        const restored = await service.write(activityId, headerB, 'register', input)
        expect(restored.id).toBe(first.id)
        const history = await tx.select().from(registrationOperations).where(eq(registrationOperations.registrationId, first.id))
        expect(history.map(row => row.action).sort()).toEqual(['cancelled', 'registered', 'reregistered'])
        await tx.update(activities).set({ moderation: 'removed' }).where(eq(activities.id, activityId))
        await expect(service.write(activityId, headerB, 'edit', { answers: input.answers })).rejects.toThrow('已下架')
        expect((await service.detail(activityId, headerB)).consultationContact).toBe('仅历史报名者可见')
        expect((await service.roster(activityId)).items).toEqual([])
        await tx.update(activities).set({ moderation: 'normal', registrationDeadline: new Date(now - 1) }).where(eq(activities.id, activityId))
        await expect(service.write(activityId, headerB, 'edit', { answers: input.answers })).rejects.toThrow('已截止')
        await service.write(activityId, headerB, 'cancel')
        await expect(service.write(activityId, headerB, 'register', input)).rejects.toThrow('已截止')
        await tx.update(activities).set({ registrationDeadline: new Date(now + 3600000), lifecycle: 'cancelled', cancelledAt: new Date(), cancellationReason: '测试取消', cancellationRegistrationCount: 1 }).where(eq(activities.id, activityId))
        await expect(service.write(activityId, headerB, 'register', input)).rejects.toThrow('已取消')
        expect((await service.detail(activityId)).cancellationRegistrationCount).toBe(1)
        expect((await service.allMine(headerB)).items[0].id).toBe(first.id)
        const [row] = await tx.select().from(registrations).where(and(eq(registrations.activityId, activityId), eq(registrations.memberId, memberB.id)))
        expect(row.id).toBe(first.id)
        await identity.logout(headerB)
        await expect(identity.me(headerB)).rejects.toThrow('登录已失效')
        completed = true
        throw rollback
      })).rejects.toBe(rollback)
      expect(completed).toBe(true)
      expect(await connection.db.select({ count: sql<number>`count(*)` }).from(members)).toEqual(before)
      for (const id of fixtureIds) {
        expect(await connection.db.select().from(members).where(eq(members.id, id))).toEqual([])
        expect(await connection.db.select().from(wechatIdentities).where(eq(wechatIdentities.memberId, id))).toEqual([])
      }
    } finally { await connection.pool.end() }
  }, 30000)
})
