import 'reflect-metadata'
import { randomUUID } from 'node:crypto'
import { eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'
import { createDatabase } from '../src/database/db.js'
import { activities } from '../src/database/schema/activities.js'
import { activityComments, activityReviews } from '../src/database/schema/feedback.js'
import { members } from '../src/database/schema/members.js'
import { registrations } from '../src/database/schema/registrations.js'
import { FlowDatabase } from '../src/flow/common.js'
import { FeedbackService } from '../src/flow/feedback.js'
import { IdentityService } from '../src/flow/identity.js'
import { OrganizerService } from '../src/flow/organizer.js'
import { WechatAdapter } from '../src/flow/wechat.js'

// Requires separate authorization and applied feedback migration. Never loads .env.
const enabled = process.env.HUIJU_DB_TEST === 'feedback-rollback'
describe.skipIf(!enabled)('feedback on MySQL with complete rollback', () => {
  it('enforces review uniqueness, author rights, public visibility and private history', async () => {
    const connectionString = process.env.TEST_DATABASE_URL
    if (!connectionString) throw new Error('TEST_DATABASE_URL is required')
    const target = new URL(connectionString)
    if (target.hostname !== '127.0.0.1' || target.port !== '3306' || target.pathname !== '/huiju') throw new Error('Rollback test target must be reviewed local 127.0.0.1:3306/huiju')
    const connection = createDatabase(connectionString)
    const rollback = new Error('FEEDBACK_ROLLBACK_TEST_COMPLETE')
    const activityId = randomUUID()
    let completed = false
    try {
      await expect(connection.db.transaction(async tx => {
        const database = Object.create(FlowDatabase.prototype) as FlowDatabase
        Object.defineProperty(database, 'db', { value: tx })
        class FixtureWechat extends WechatAdapter {
          override async exchange(code: string) { return { appId: 'huiju-feedback-rollback-test', openId: code, unionId: null } }
        }
        const identity = new IdentityService(database, new FixtureWechat())
        const service = new FeedbackService(database, identity)
        const organizer = new OrganizerService(database, identity)
        const owner = await identity.login(randomUUID())
        const participant = await identity.login(randomUUID())
        const outsider = await identity.login(randomUUID())
        const ownerHeader = `Bearer ${owner.token}`, participantHeader = `Bearer ${participant.token}`, outsiderHeader = `Bearer ${outsider.token}`
        for (const account of [owner, participant, outsider]) await tx.update(members).set({ boundPhone: '19900000001', displayName: '点评回滚测试', nameSetByUser: true, avatarUrl: '/feedback-fixture.png', avatarSetByUser: true }).where(eq(members.id, account.member.id))
        await tx.insert(activities).values({ id: activityId, organizerMemberId: owner.member.id, title: '点评回滚测试', description: '事务回滚', location: '测试', consultationContact: '私密', startsAt: new Date(Date.now() - 7200000), endsAt: new Date(Date.now() - 3600000), feeType: 'free', lifecycle: 'published', publishedAt: new Date(Date.now() - 10800000), activeRegistrationCount: 1, hasRegistrationEver: true })
        const registrationId = randomUUID()
        await tx.insert(registrations).values({ id: registrationId, activityId, memberId: participant.member.id, contactPhone: '19900000001', firstRegisteredAt: new Date(), currentRegisteredAt: new Date() })
        await expect(service.createReview(activityId, { content: '未到场', score: 5 }, participantHeader)).rejects.toMatchObject({ response: { code: 'REVIEW_NOT_ALLOWED' } })
        const attendance = await organizer.markAttendance(activityId, registrationId, ownerHeader)
        expect(attendance).toEqual({ registrationId, attended: true, attendedAt: expect.any(String) })
        expect(await organizer.markAttendance(activityId, registrationId, ownerHeader)).toEqual(attendance)
        const roster = await organizer.roster(activityId, ownerHeader)
        expect(roster.items).toHaveLength(1)
        expect(roster.items[0]).toMatchObject({ id: registrationId, status: 'active', attended: true, attendedAt: attendance.attendedAt })
        const [marked] = await tx.select().from(registrations).where(eq(registrations.id, registrationId))
        expect(marked.attendedAt?.toISOString()).toBe(attendance.attendedAt)
        expect(marked.attendanceMarkedByMemberId).toBe(owner.member.id)
        const [afterAttendance] = await tx.select().from(activities).where(eq(activities.id, activityId))
        expect(afterAttendance.activeRegistrationCount).toBe(1)
        expect(afterAttendance.hasRegistrationEver).toBe(true)
        await service.createReview(activityId, { content: '已到场点评', score: 4 }, participantHeader)
        await expect(service.createReview(activityId, { content: '重复点评', score: 5 }, participantHeader)).rejects.toMatchObject({ response: { code: 'REVIEW_EXISTS' } })
        const [stored] = await tx.select().from(activityReviews).where(eq(activityReviews.activityId, activityId))
        await expect(tx.insert(activityReviews).values({ id: randomUUID(), activityId, memberId: participant.member.id, content: '绕过服务重复', score: 5 })).rejects.toThrow()
        await expect(service.change('review', stored.id, null, ownerHeader)).rejects.toMatchObject({ response: { code: 'FORBIDDEN' } })
        await expect(service.stats(activityId, outsiderHeader)).rejects.toMatchObject({ response: { code: 'FORBIDDEN' } })
        expect(await service.stats(activityId, ownerHeader)).toEqual({ count: 1, averageScore: 4 })
        await tx.update(members).set({ displayName: '当前用户名称' }).where(eq(members.id, participant.member.id))
        const list = await service.reviews(activityId)
        expect(list.items[0].member).toEqual({ memberId: participant.member.id, avatarUrl: '/feedback-fixture.png', displayName: '当前用户名称' })
        // Test moderation state filtering without inventing an admin authentication endpoint.
        await tx.update(activityReviews).set({ hiddenAt: new Date() }).where(eq(activityReviews.id, stored.id))
        expect((await service.reviews(activityId)).total).toBe(0)
        expect(await service.stats(activityId, ownerHeader)).toEqual({ count: 0, averageScore: null })
        expect((await service.context(activityId, participantHeader)).myReview?.hidden).toBe(true)
        expect((await service.context(activityId, outsiderHeader)).myReview).toBeNull()
        await service.change('review', stored.id, { content: '编辑不恢复公开', score: 5 }, participantHeader)
        expect((await service.reviews(activityId)).total).toBe(0)
        await service.change('review', stored.id, null, participantHeader)
        expect((await service.context(activityId, participantHeader)).myReview).toBeNull()
        await service.createReview(activityId, { content: '重新提交保留隐藏', score: 3 }, participantHeader)
        const after = await tx.select().from(activityReviews).where(eq(activityReviews.activityId, activityId))
        expect(after).toHaveLength(1); expect(after[0].id).toBe(stored.id); expect(after[0].hiddenAt).not.toBeNull()
        await service.createComment(activityId, { content: '公开评论' }, participantHeader)
        const comments = await service.comments(activityId)
        expect(comments.total).toBe(1)
        expect(await service.comments(activityId, 40)).toEqual({ items: [], total: 1, hasMore: false })
        await tx.update(activities).set({ moderation: 'removed' }).where(eq(activities.id, activityId))
        expect((await service.comments(activityId)).total).toBe(0)
        expect((await service.comments(activityId, 0, participantHeader, true)).total).toBe(1)
        expect((await service.comments(activityId, 0, outsiderHeader, true)).total).toBe(0)
        await service.change('comment', comments.items[0].id, { content: '下架后本人修订' }, participantHeader)
        await expect(service.createComment(activityId, { content: '禁止新增' }, participantHeader)).rejects.toMatchObject({ response: { code: 'COMMENT_NOT_ALLOWED' } })
        await service.change('comment', comments.items[0].id, null, participantHeader)
        expect((await service.comments(activityId, 0, participantHeader, true)).total).toBe(0)
        completed = true
        throw rollback
      })).rejects.toBe(rollback)
      expect(completed).toBe(true)
      expect(await connection.db.select().from(activityComments).where(eq(activityComments.activityId, activityId))).toEqual([])
      expect(await connection.db.select().from(activityReviews).where(eq(activityReviews.activityId, activityId))).toEqual([])
      expect(await connection.db.select().from(activities).where(eq(activities.id, activityId))).toEqual([])
    } finally { await connection.pool.end() }
  }, 30000)
})
