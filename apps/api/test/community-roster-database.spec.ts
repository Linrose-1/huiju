import 'reflect-metadata'
import { randomUUID } from 'node:crypto'
import { and, eq, inArray } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'
import { createDatabase } from '../src/database/db.js'
import { communities, communityMembers } from '../src/database/schema/communities.js'
import { members } from '../src/database/schema/members.js'
import { FlowDatabase } from '../src/flow/common.js'
import { CommunityRosterService } from '../src/flow/community-roster.js'
import { IdentityService } from '../src/flow/identity.js'
import { DEFAULT_COMMUNITY_ID } from '../src/flow/member-number.js'
import { WechatAdapter } from '../src/flow/wechat.js'
import { LEGAL_VERSION } from '../src/platform/legal.js'

describe.skipIf(process.env.HUIJU_DB_TEST !== 'community-roster-rollback')('community recognition in a rollback transaction', () => {
  it('scopes admin rights and changes to Xuejia, preserves admin assignment and rolls fixtures back', async () => {
    const url = new URL(process.env.TEST_DATABASE_URL ?? '')
    if (url.hostname !== '127.0.0.1' || url.port !== '3306' || url.pathname !== '/huiju') throw new Error('Expected local huiju rollback database')
    const connection = createDatabase(url.href)
    const rollback = new Error('COMMUNITY_ROSTER_ROLLBACK')
    const ids: string[] = []
    try {
      await expect(connection.db.transaction(async tx => {
        const database = Object.create(FlowDatabase.prototype) as FlowDatabase
        Object.defineProperty(database, 'db', { value: tx })
        class FixtureWechat extends WechatAdapter {
          override async exchange(code: string) { return { appId: 'community-roster-test', openId: code, unionId: null } }
        }
        const identity = new IdentityService(database, new FixtureWechat())
        const roster = new CommunityRosterService(database, identity)
        const login = () => identity.login(randomUUID(), undefined, { termsVersion: LEGAL_VERSION, privacyVersion: LEGAL_VERSION })
        const admin = await login()
        const friend = await login()
        const header = 'Bearer ' + admin.token
        const friendHeader = 'Bearer ' + friend.token
        ids.push(admin.member.id, friend.member.id)
        const scope = (id: string) => and(eq(communityMembers.communityId, DEFAULT_COMMUNITY_ID), eq(communityMembers.memberId, id))
        await tx.update(communityMembers).set({ isAdmin: true }).where(scope(admin.member.id))
        await expect(roster.list({ offset: 0, limit: 1 }, header)).rejects.toThrow('完善')
        await tx.update(members).set({ boundPhone: '13800000000', displayName: '测试学友', nameSetByUser: true, avatarUrl: '/test', avatarSetByUser: true }).where(inArray(members.id, ids))
        const foreignCommunity = randomUUID().slice(0, 32)
        await tx.insert(communities).values({ id: foreignCommunity, name: '测试社群', numberPrefix: 'CS' })
        await tx.insert(communityMembers).values({ communityId: foreignCommunity, memberId: friend.member.id, isAdmin: true, sequenceNo: 1, userNumber: 'TEST', joinedAt: new Date() })
        expect(await roster.access(header)).toEqual({ isAdmin: true, isRegistered: false, canViewRoster: true, canRecognizeMembers: true })
        await expect(roster.list({ offset: 0, limit: 1 }, friendHeader)).rejects.toThrow('查看权限')
        await expect(roster.recognize(friend.member.id, true, friendHeader)).rejects.toThrow('认定权限')
        expect(await roster.access(friendHeader, foreignCommunity)).toMatchObject({ canRecognizeMembers: true })
        await tx.update(communityMembers).set({ canViewRoster: true }).where(scope(friend.member.id))
        expect(await roster.list({ offset: 0, limit: 1 }, friendHeader)).toMatchObject({ canRecognizeMembers: false })
        await expect(roster.recognize(admin.member.id, true, friendHeader)).rejects.toThrow('认定权限')
        for (const isRegistered of [true, true, false]) {
          expect(await roster.recognize(friend.member.id, isRegistered, header)).toMatchObject({ memberId: friend.member.id, isRegistered })
          expect(await roster.access(friendHeader)).toEqual({ isAdmin: false, isRegistered, canViewRoster: true, canRecognizeMembers: false })
        }
        const first = await roster.list({ offset: 0, limit: 1 }, header)
        const next = await roster.list({ offset: 1, limit: 1 }, header)
        expect(first.items).toHaveLength(1)
        expect(next.items).toHaveLength(1)
        expect(first.total).toBeGreaterThanOrEqual(2)
        expect(first.items[0].memberId).not.toBe(next.items[0].memberId)
        await tx.delete(communityMembers).where(scope(friend.member.id))
        await expect(roster.recognize(friend.member.id, true, header)).rejects.toThrow('本社群找不到')
        throw rollback
      })).rejects.toBe(rollback)
      expect(await connection.db.select({ id: members.id }).from(members).where(inArray(members.id, ids))).toEqual([])
    } finally { await connection.pool.end() }
  })
})
