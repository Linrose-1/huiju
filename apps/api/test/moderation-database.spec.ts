import 'reflect-metadata'
import { randomBytes, randomUUID } from 'node:crypto'
import { eq } from 'drizzle-orm'
import { describe, expect, it, vi } from 'vitest'
import { AdminService } from '../src/admin/service.js'
import { ADMIN_COOKIE, csrfFor, digest, hashPassword } from '../src/admin/security.js'
import { createDatabase } from '../src/database/db.js'
import { adminCredentials } from '../src/database/schema/admin.js'
import { activities } from '../src/database/schema/activities.js'
import { activityComments } from '../src/database/schema/feedback.js'
import { feedbackModerationLogs } from '../src/database/schema/feedback-moderation.js'
import { adminAccounts, adminSessions, members } from '../src/database/schema/members.js'
import { FlowDatabase } from '../src/flow/common.js'
import { FeedbackService } from '../src/flow/feedback.js'
import type { IdentityService } from '../src/flow/identity.js'

// Explicit separate authorization and applied 0005 migration required. Never loads .env.
describe.skipIf(process.env.HUIJU_DB_TEST !== 'admin-moderation-rollback')('admin moderation real MySQL rollback', () => {
  it('checks live operator status and makes hiding plus immutable evidence atomic', async () => {
    const connectionString = process.env.TEST_DATABASE_URL
    if (!connectionString) throw new Error('TEST_DATABASE_URL required')
    const url = new URL(connectionString)
    if (url.protocol !== 'mysql:' || url.search || url.hash || url.hostname !== '127.0.0.1' || url.port !== '3306' || url.pathname !== '/huiju') throw new Error('Only separately authorized 127.0.0.1:3306/huiju is supported')
    vi.stubEnv('ADMIN_ORIGIN', 'https://admin.example.test')
    const connection = createDatabase(connectionString)
    const rollback = new Error('ADMIN_MODERATION_ROLLBACK')
    const adminId = randomUUID(), memberId = randomUUID(), activityId = randomUUID(), commentId = randomUUID()
    const token = randomBytes(32).toString('hex')
    const context = { cookie: `${ADMIN_COOKIE}=${token}`, csrfToken: csrfFor(token), origin: 'https://admin.example.test' }
    let completed = false
    try {
      await expect(connection.db.transaction(async tx => {
        const [root] = await tx.select().from(members).where(eq(members.kind, 'platform_root')).limit(1)
        if (!root) throw new Error('Existing platform root required; test does not provision one')
        await tx.insert(members).values({ id: memberId, memberNumber: memberId.replaceAll('-', ''), inviteCode: memberId.replaceAll('-', ''), inviterMemberId: root.id, displayName: '审核隔离会员' })
        await tx.insert(activities).values({ id: activityId, organizerMemberId: memberId, title: '审核隔离活动', description: 'rollback', location: '本机', consultationContact: '不公开', startsAt: new Date(0), endsAt: new Date(1000), lifecycle: 'published', feeType: 'free' })
        await tx.insert(activityComments).values({ id: commentId, activityId, memberId, content: '审核快照内容' })
        await tx.insert(adminAccounts).values({ id: adminId, displayName: '隔离运营' })
        await tx.insert(adminCredentials).values({ adminAccountId: adminId, username: `test-${adminId}`, role: 'operator', passwordHash: await hashPassword(randomBytes(24).toString('hex')), mustChangePassword: false })
        await tx.insert(adminSessions).values({ id: randomUUID(), adminAccountId: adminId, tokenHash: digest(token), expiresAt: new Date(Date.now() + 60000) })
        const database = Object.create(FlowDatabase.prototype) as FlowDatabase
        Object.defineProperty(database, 'db', { value: tx })
        const auth = new AdminService(database)
        const feedback = new FeedbackService(database, {} as IdentityService)
        const hide = (reason: string) => auth.withSession(context, (trx, account) => feedback.hideForModeration(trx, 'comment', commentId, reason, account), { write: true })
        await expect(auth.withSession(context, async () => null, { superOnly: true })).rejects.toMatchObject({ response: { code: 'ADMIN_FORBIDDEN' } })
        await hide('违规广告')
        await hide('重试不覆盖')
        expect((await feedback.comments(activityId)).total).toBe(0)
        const logs = await tx.select().from(feedbackModerationLogs).where(eq(feedbackModerationLogs.targetId, commentId))
        expect(logs).toHaveLength(1)
        expect(logs[0]).toMatchObject({ adminId, reason: '违规广告', contentSnapshot: '审核快照内容' })
        await tx.update(adminAccounts).set({ status: 'disabled' }).where(eq(adminAccounts.id, adminId))
        await expect(hide('已停用')).rejects.toMatchObject({ status: 401 })
        completed = true
        throw rollback
      })).rejects.toBe(rollback)
      expect(completed).toBe(true)
      expect(await connection.db.select().from(adminAccounts).where(eq(adminAccounts.id, adminId))).toEqual([])
      expect(await connection.db.select().from(feedbackModerationLogs).where(eq(feedbackModerationLogs.targetId, commentId))).toEqual([])
      expect(await connection.db.select().from(activities).where(eq(activities.id, activityId))).toEqual([])
    } finally { vi.unstubAllEnvs(); await connection.pool.end() }
  }, 30000)
})
