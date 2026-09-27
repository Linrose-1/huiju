import 'reflect-metadata'
import { randomUUID } from 'node:crypto'
import { eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'
import { createDatabase } from '../src/database/db.js'
import { members, wechatIdentities } from '../src/database/schema/members.js'
import { activities, activityOperations } from '../src/database/schema/activities.js'
import { notifications } from '../src/database/schema/notifications.js'
import { registrations } from '../src/database/schema/registrations.js'
import { ActivityService } from '../src/flow/activity.js'
import { FlowDatabase } from '../src/flow/common.js'
import { IdentityService } from '../src/flow/identity.js'
import { OrganizerService } from '../src/flow/organizer.js'
import { ActivityWriteInput } from '../src/flow/organizer-dto.js'
import { WechatAdapter } from '../src/flow/wechat.js'

// Explicit, separately authorized local rollback only; never load .env or DATABASE_URL.
const enabled = process.env.HUIJU_DB_TEST === 'organizer-rollback'
describe.skipIf(!enabled)('real MySQL organizer flow in an outer rollback transaction', () => {
  it('enforces ownership, permanent locks, cancellation snapshots and atomic member notifications', async () => {
    const connectionString = process.env.TEST_DATABASE_URL
    if (!connectionString) throw new Error('TEST_DATABASE_URL is required')
    const target = new URL(connectionString)
    if (target.hostname !== '127.0.0.1' || target.port !== '3306' || target.pathname !== '/huiju') {
      throw new Error('Rollback test target must be the reviewed local 127.0.0.1:3306/huiju')
    }
    const connection = createDatabase(connectionString)
    const memberIds: string[] = []
    let activityId = ''
    const rollback = new Error('ORGANIZER_ROLLBACK_TEST_COMPLETE')
    let completed = false
    try {
      await expect(connection.db.transaction(async tx => {
        const database = Object.create(FlowDatabase.prototype) as FlowDatabase
        Object.defineProperty(database, 'db', { value: tx })
        class FixtureWechat extends WechatAdapter {
          override async exchange(code: string) { return { appId: 'huiju-organizer-rollback-test', openId: code, unionId: null } }
          override async phone() { return '13800000000' }
        }
        const identity = new IdentityService(database, new FixtureWechat())
        const organizer = new OrganizerService(database, identity)
        const publicActivities = new ActivityService(database, identity)
        const owner = await identity.login(randomUUID())
        const attendee = await identity.login(randomUUID())
        const outsider = await identity.login(randomUUID())
        memberIds.push(owner.member.id, attendee.member.id, outsider.member.id)
        const ownerHeader = `Bearer ${owner.token}`
        const attendeeHeader = `Bearer ${attendee.token}`
        const outsiderHeader = `Bearer ${outsider.token}`
        const now = Date.now()
        const input: ActivityWriteInput = {
          title: `回滚测试 ${randomUUID()}`, description: '仅在回滚事务内存在', location: '测试会议室', consultationContact: '测试咨询方式',
          startsAt: new Date(now + 7200000).toISOString(), endsAt: new Date(now + 10800000).toISOString(),
          registrationDeadline: new Date(now + 3600000).toISOString(), capacity: 3, feeType: 'paid', feeAmountCents: 100,
          questions: [{ type: 'short_text', prompt: '测试问题', required: true }]
        }
        await expect(organizer.create(input, ownerHeader)).rejects.toThrow('绑定手机号')
        // Explicit isolated test fixtures; no file upload, real phone authorization, or production identity changes.
        for (const session of [owner, attendee]) {
          await tx.update(members).set({ boundPhone: '13800000000', displayName: '回滚测试会员', nameSetByUser: true, avatarUrl: '/fixture.png', avatarSetByUser: true }).where(eq(members.id, session.member.id))
        }
        const draft = await organizer.create(input, ownerHeader)
        activityId = draft.id
        expect(draft.lifecycle).toBe('draft')
        await expect(publicActivities.detail(activityId)).rejects.toThrow('活动不存在')
        expect((await publicActivities.list()).items.some(item => item.id === activityId)).toBe(false)
        expect((await organizer.list(ownerHeader)).items.some(item => item.id === activityId)).toBe(true)
        expect((await organizer.list(outsiderHeader)).items).toEqual([])
        const edit: ActivityWriteInput = { ...input, questions: draft.questions.map(q => ({ id: q.id, type: q.type as 'short_text', prompt: q.prompt, required: q.required, options: q.options })) }
        for (const action of [() => organizer.detail(activityId, outsiderHeader), () => organizer.edit(activityId, edit, outsiderHeader), () => organizer.publish(activityId, outsiderHeader), () => organizer.roster(activityId, outsiderHeader), () => organizer.cancel(activityId, '外人不能取消', outsiderHeader)]) {
          await expect(action()).rejects.toThrow('仅活动发起人')
        }
        expect((await organizer.publish(activityId, ownerHeader)).lifecycle).toBe('published')
        await organizer.publish(activityId, ownerHeader)
        expect((await tx.select().from(activityOperations).where(eq(activityOperations.activityId, activityId))).filter(row => row.action === 'publish')).toHaveLength(1)
        expect((await publicActivities.list()).items.some(item => item.id === activityId)).toBe(true)
        expect(await publicActivities.detail(activityId)).not.toHaveProperty('consultationContact')
        const registration = await publicActivities.write(activityId, attendeeHeader, 'register', {
          contactPhone: '13900000000', answers: [{ questionId: draft.questions[0].id, value: '私密测试答案' }]
        })
        const publicRoster = await publicActivities.roster(activityId)
        expect(Object.keys(publicRoster.items[0]).sort()).toEqual(['avatarUrl', 'displayName'])
        expect(JSON.stringify(publicRoster)).not.toContain('13900000000')
        expect(JSON.stringify(publicRoster)).not.toContain('私密测试答案')
        await expect(organizer.roster(activityId, attendeeHeader)).rejects.toThrow('仅活动发起人')
        expect((await organizer.roster(activityId, ownerHeader)).items[0]).toMatchObject({ id: registration.id, contactPhone: '13900000000', answers: registration.answers })
        await expect(organizer.edit(activityId, { ...edit, questions: [] }, ownerHeader)).rejects.toThrow('已有报名记录')
        await expect(organizer.edit(activityId, { ...edit, feeAmountCents: 200 }, ownerHeader)).rejects.toThrow('已有报名记录')
        // Cancelling the only registration never unlocks the original questions or fee.
        await publicActivities.write(activityId, attendeeHeader, 'cancel')
        await expect(organizer.edit(activityId, { ...edit, feeType: 'free', feeAmountCents: null }, ownerHeader)).rejects.toThrow('已有报名记录')
        await publicActivities.write(activityId, attendeeHeader, 'register', { contactPhone: registration.contactPhone, answers: registration.answers })
        const updated = { ...edit, consultationContact: '新的测试咨询方式' }
        await organizer.edit(activityId, updated, ownerHeader)
        await organizer.edit(activityId, updated, ownerHeader)
        const contactNotices = (await organizer.notifications(attendeeHeader)).items
        expect(contactNotices).toHaveLength(1)
        expect(contactNotices[0].type).toBe('consultation_contact_updated')
        expect((await organizer.notifications(outsiderHeader)).items).toEqual([])
        expect((await publicActivities.detail(activityId, attendeeHeader)).consultationContact).toBe(updated.consultationContact)
        expect(await publicActivities.detail(activityId, outsiderHeader)).not.toHaveProperty('consultationContact')
        const cancelled = await organizer.cancel(activityId, '测试取消原因', ownerHeader)
        expect(cancelled).toMatchObject({ lifecycle: 'cancelled', cancellationReason: '测试取消原因', activeRegistrationCount: 1, cancellationRegistrationCount: 1 })
        const [savedRegistration] = await tx.select().from(registrations).where(eq(registrations.id, registration.id))
        expect(savedRegistration.status).toBe('active')
        expect((await organizer.roster(activityId, ownerHeader)).items[0].attended).toBe(false)
        await organizer.cancel(activityId, '重复请求不覆盖原原因', ownerHeader)
        const noticeList = (await organizer.notifications(attendeeHeader)).items
        expect(noticeList).toHaveLength(2)
        const cancellation = noticeList.find(item => item.type === 'activity_cancelled')!
        expect(cancellation.body).toContain('测试取消原因')
        expect(cancellation.readAt).toBeNull()
        const operations = await tx.select().from(activityOperations).where(eq(activityOperations.activityId, activityId))
        expect(operations.filter(row => row.action === 'cancel')).toHaveLength(1)
        expect(operations.filter(row => row.action === 'update_consultation_contact')).toHaveLength(1)
        await expect(organizer.readNotification(cancellation.id, ownerHeader)).rejects.toThrow('通知不存在')
        await expect(organizer.readNotification(cancellation.id, outsiderHeader)).rejects.toThrow('通知不存在')
        await organizer.readNotification(cancellation.id, attendeeHeader)
        const readAt = (await organizer.notifications(attendeeHeader)).items.find(item => item.id === cancellation.id)!.readAt
        expect(readAt).not.toBeNull()
        await organizer.readNotification(cancellation.id, attendeeHeader)
        expect((await organizer.notifications(attendeeHeader)).items.find(item => item.id === cancellation.id)!.readAt).toBe(readAt)
        completed = true
        throw rollback
      })).rejects.toBe(rollback)
      expect(completed).toBe(true)
      // Assert fixture rollback independently of any unrelated live data changes.
      for (const id of memberIds) {
        expect(await connection.db.select().from(members).where(eq(members.id, id))).toEqual([])
        expect(await connection.db.select().from(wechatIdentities).where(eq(wechatIdentities.memberId, id))).toEqual([])
        expect(await connection.db.select().from(notifications).where(eq(notifications.recipientMemberId, id))).toEqual([])
      }
      expect(await connection.db.select().from(activities).where(eq(activities.id, activityId))).toEqual([])
      expect(await connection.db.select().from(activityOperations).where(eq(activityOperations.activityId, activityId))).toEqual([])
      expect(await connection.db.select().from(registrations).where(eq(registrations.activityId, activityId))).toEqual([])
    } finally { await connection.pool.end() }
  }, 30000)
})
