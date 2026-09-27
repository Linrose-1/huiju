import 'reflect-metadata'
import { randomUUID } from 'node:crypto'
import { eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'
import { createDatabase } from '../src/database/db.js'
import { members, memberVisibilities } from '../src/database/schema/members.js'
import { FlowDatabase } from '../src/flow/common.js'
import { IdentityService } from '../src/flow/identity.js'
import { cardSettings, MemberCardService } from '../src/flow/member-card.js'
import { WechatAdapter } from '../src/flow/wechat.js'

// Requires separate authorization. Never loads .env or falls back to DATABASE_URL.
const enabled = process.env.HUIJU_DB_TEST === 'member-card-rollback'
describe.skipIf(!enabled)('member card on real MySQL in an outer rollback transaction', () => {
  it('persists optional details and visibility while protecting identity and closed fields', async () => {
    const connectionString = process.env.TEST_DATABASE_URL
    if (!connectionString) throw new Error('TEST_DATABASE_URL is required')
    const target = new URL(connectionString)
    if (target.hostname !== '127.0.0.1' || target.port !== '3306' || target.pathname !== '/huiju') throw new Error('Rollback test target must be reviewed local 127.0.0.1:3306/huiju')
    const connection = createDatabase(connectionString)
    const rollback = new Error('MEMBER_CARD_ROLLBACK_TEST_COMPLETE')
    let ownerId = ''
    let completed = false
    try {
      await expect(connection.db.transaction(async tx => {
        const database = { db: tx } as unknown as FlowDatabase
        class FixtureWechat extends WechatAdapter {
          override async exchange(code: string) { return { appId: 'member-card-rollback-test', openId: code, unionId: null } }
        }
        const identity = new IdentityService(database, new FixtureWechat())
        const cards = new MemberCardService(database, identity)
        const owner = await identity.login(randomUUID())
        const viewer = await identity.login(randomUUID())
        ownerId = owner.member.id
        const ownerHeader = `Bearer ${owner.token}`
        const viewerHeader = `Bearer ${viewer.token}`
        const details = { realName: '名片测试', email: 'card@example.com', hometown: '深圳', bio: '介绍', resources: '资源', needs: '需求' }
        await expect(cards.profile()).rejects.toMatchObject({ response: { code: 'SESSION_REQUIRED' } })
        expect(await cards.saveProfile(details, ownerHeader)).toEqual(details)
        expect(await cards.profile(ownerHeader)).toEqual(details)
        await expect(cards.card(ownerId, viewerHeader)).rejects.toMatchObject({ response: { code: 'PROFILE_INCOMPLETE' } })
        for (const id of [ownerId, viewer.member.id]) await tx.update(members).set({ boundPhone: '19900000001', avatarUrl: '/card-fixture.png', displayName: '名片测试', avatarSetByUser: true, nameSetByUser: true }).where(eq(members.id, id))
        await tx.delete(memberVisibilities).where(eq(memberVisibilities.memberId, ownerId))
        expect(await cards.settings(ownerHeader)).toEqual(cardSettings())
        const publicFields = { avatarUrl: '/card-fixture.png', displayName: '名片测试' }
        expect(await cards.card(ownerId, viewerHeader)).toEqual(publicFields)
        const open = { ...cardSettings(), showEmail: true, showBio: true, showBoundPhone: true }
        await cards.saveSettings(open, ownerHeader)
        expect(await cards.settings(ownerHeader)).toEqual(open)
        expect(await cards.card(ownerId, viewerHeader)).toEqual({ ...publicFields, email: details.email, bio: details.bio, boundPhone: '19900000001' })
        await cards.saveProfile({ ...details, bio: '新简介' }, ownerHeader)
        expect((await cards.card(ownerId, viewerHeader)).bio).toBe('新简介')
        await cards.saveSettings(cardSettings(), ownerHeader)
        expect(await cards.card(ownerId, viewerHeader)).toEqual(publicFields)
        expect(await cards.card(ownerId, ownerHeader)).toEqual(publicFields)
        const [root] = await tx.select().from(members).where(eq(members.kind, 'platform_root')).limit(1)
        await expect(cards.card(root.id, viewerHeader)).rejects.toMatchObject({ response: { code: 'NOT_FOUND' } })
        await expect(cards.card(randomUUID(), viewerHeader)).rejects.toMatchObject({ response: { code: 'NOT_FOUND' } })
        const [saved] = await tx.select().from(members).where(eq(members.id, ownerId))
        expect(saved.inviteCode).toBe(owner.member.inviteCode)
        expect(saved.boundPhone).toBe('19900000001')
        completed = true
        throw rollback
      })).rejects.toBe(rollback)
      expect(completed).toBe(true)
      expect(await connection.db.select().from(members).where(eq(members.id, ownerId))).toEqual([])
      expect(await connection.db.select().from(memberVisibilities).where(eq(memberVisibilities.memberId, ownerId))).toEqual([])
    } finally { await connection.pool.end() }
  })
})
