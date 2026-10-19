import 'reflect-metadata'
import { IdentityService, memberDto, type Member } from '../src/flow/identity.js'
import type { FlowDatabase } from '../src/flow/common.js'
import type { WechatAdapter } from '../src/flow/wechat.js'
import { members, memberSessions, wechatIdentities } from '../src/database/schema/members.js'
import { describe, expect, it } from 'vitest'
import { MySqlDialect } from 'drizzle-orm/mysql-core'
import type { SQL } from 'drizzle-orm'
import { memberNumberPrefix, nextMemberNumber, memberInviteCode, inviteMemberNumber } from '../src/flow/member-number.js'
import { LEGAL_VERSION } from '../src/platform/legal.js'
import { legalConsents } from '../src/database/schema/platform.js'

describe('member number format', () => {
  it('maps invitation codes without changing the date or sequence and rejects malformed new codes', () => {
    expect(memberInviteCode('HJ20260927000002', 'old-code')).toBe('HJYQM20260927000002')
    expect(inviteMemberNumber('HJYQM20260927000002')).toBe('HJ20260927000002')
    for (const code of ['HJ20260927000002', 'hjyqm20260927000002', 'HJYQM20260927000002x', 'old-code']) expect(inviteMemberNumber(code)).toBeNull()
    expect(memberInviteCode('DEMO_AI_fixture', 'demo-code')).toBe('demo-code')
  })
  it('returns the new code for an existing member while retaining their stored legacy code', () => {
    const member = { memberNumber: 'HJ20260927000002', inviteCode: 'old-code' } as Member
    expect(memberDto(member).inviteCode).toBe('HJYQM20260927000002')
    expect(member.inviteCode).toBe('old-code')
  })
  it('uses Shanghai registration date across midnight and year boundaries', () => {
    expect(memberNumberPrefix(new Date('2026-09-27T15:59:59.999Z'))).toBe('HJ20260927')
    expect(memberNumberPrefix(new Date('2026-09-27T16:00:00.000Z'))).toBe('HJ20260928')
    expect(memberNumberPrefix(new Date('2026-12-31T16:00:00.000Z'))).toBe('HJ20270101')
  })
  it('starts each new date at one and carries six-digit sequence correctly', () => {
    expect(nextMemberNumber('HJ20260928')).toBe('HJ20260928000001')
    expect(nextMemberNumber('HJ20260928', 'HJ20260928000009')).toBe('HJ20260928000010')
    expect(nextMemberNumber('HJ20260928', 'HJ20260928999998')).toBe('HJ20260928999999')
    expect(nextMemberNumber('HJ20260929')).toBe('HJ20260929000001')
  })
  it('rejects overflow rather than wrapping or changing the format', () => {
    expect(() => nextMemberNumber('HJ20260928', 'HJ20260928999999')).toThrow('今日注册名额已达上限')
  })
})


describe('registration allocates inside the member transaction', () => {
  it.each([undefined, 'HJYQM20260927000002', 'legacy-code'])('registers with invitation %s inside the locked transaction', async inviteCode => {
    const events: string[] = []
    let inserted: Record<string, unknown> = {}
    let queryIndex = 0
    let invitationQuery: { sql: string; params: unknown[] } | undefined
    let agreed: Record<string, unknown> | undefined
    const db = {
      select() {
        const index = queryIndex++
        const results = () => [[], [{ id: 'root' }], ...(inviteCode ? [[{ id: 'inviter' }]] : []), [{ number: memberNumberPrefix(new Date()) + '000009' }], [inserted], []][index]
        const chain = {
          from: () => chain, where: (condition: SQL) => { if (inviteCode && index === 2) invitationQuery = new MySqlDialect().sqlToQuery(condition); return chain }, limit: () => chain, orderBy: () => chain,
          for: () => { events.push('lock:' + index); return chain },
          then: (resolve: (value: unknown) => unknown) => Promise.resolve(results()).then(resolve),
        }
        return chain
      },
      insert(table: unknown) { return { values: async (value: Record<string, unknown>) => {
        if (table === members) { inserted = value; events.push('insert-member') }
        if (table === legalConsents) agreed = value
      } } },
      transaction: async <T>(callback: (tx: unknown) => Promise<T>): Promise<T> => callback(db),
    }
    const service = new IdentityService({ db } as unknown as FlowDatabase, { exchange: async () => ({ appId: 'test', openId: 'test', unionId: null }) } as unknown as WechatAdapter)
    const result = await service.login('code', inviteCode, { termsVersion: LEGAL_VERSION, privacyVersion: LEGAL_VERSION })
    expect(agreed).toMatchObject({ memberId: inserted.id, termsVersion: LEGAL_VERSION, privacyVersion: LEGAL_VERSION })
    expect(result.member.memberNumber).toBe(memberNumberPrefix(inserted.createdAt as Date) + '000010')
    expect(inserted.inviteCode).toBe('HJYQM' + result.member.memberNumber.slice(2))
    expect(events.slice(0, 3)).toEqual(['lock:1', 'lock:' + (inviteCode ? 3 : 2), 'insert-member'])
    expect(inserted.inviterMemberId).toBe(inviteCode ? 'inviter' : 'root')
    if (inviteCode?.startsWith('HJYQM')) {
      expect(invitationQuery?.params).toEqual(['HJ20260927000002', inviteCode, 'member'])
      expect(invitationQuery?.sql).toContain('member_number')
      expect(invitationQuery?.sql).toContain('invite_code')
    } else if (inviteCode) expect(invitationQuery?.params).toEqual([inviteCode, 'member'])
  })
})

describe('existing member invitation remains unchanged', () => {
  it.each(['HJYQM20260927000003', 'different-legacy-code'])('creates a new session without rebinding invitation %s', async inviteCode => {
    const owner = { id: 'existing-member', memberNumber: 'HJ20260927000002', inviteCode: 'original-code', inviterMemberId: 'original-inviter' }
    const queries: { table: unknown; filter?: { sql: string; params: unknown[] }; locked?: boolean }[] = []
    const writes: { table: unknown; value: Record<string, unknown> }[] = []
    let transactions = 0
    const db = {
      select() {
        const query: typeof queries[number] = { table: undefined }
        queries.push(query)
        const chain = {
          from: (table: unknown) => { query.table = table; return chain },
          where: (condition: SQL) => { query.filter = new MySqlDialect().sqlToQuery(condition); return chain },
          limit: () => chain, orderBy: () => chain,
          for: () => { query.locked = true; return chain },
          then: (resolve: (value: unknown) => unknown) => {
            if (query.table === wechatIdentities) return Promise.resolve([{ memberId: owner.id }]).then(resolve)
            if (query.table === members) return Promise.resolve([owner]).then(resolve)
            if (query.table === memberSessions) return Promise.resolve([]).then(resolve)
            throw new Error('Unexpected identity lookup')
          },
        }
        return chain
      },
      insert(table: unknown) { return { values: async (value: Record<string, unknown>) => { writes.push({ table, value }) } } },
      update() { throw new Error('Existing member must not be rewritten') },
      transaction: async <T>(callback: (tx: unknown) => Promise<T>): Promise<T> => { transactions++; return callback(db) },
    }
    const service = new IdentityService({ db } as unknown as FlowDatabase, { exchange: async () => ({ appId: 'test', openId: 'existing-openid', unionId: null }) } as unknown as WechatAdapter)
    const result = await service.login('code', inviteCode, { termsVersion: LEGAL_VERSION, privacyVersion: LEGAL_VERSION })
    expect(result.member.id).toBe(owner.id)
    expect(result.token).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(Date.parse(result.expiresAt)).toBeGreaterThan(Date.now())
    expect(owner.inviterMemberId).toBe('original-inviter')
    expect(transactions).toBe(1)
    expect(queries.map(query => query.table)).toEqual([wechatIdentities, members, memberSessions])
    expect(queries[1]?.locked).toBe(true)
    expect(queries[1]?.filter?.params).toEqual([owner.id])
    expect(queries[1]?.filter?.sql).not.toMatch(/invite_code|member_number/)
    expect(writes.map(write => write.table)).toEqual([memberSessions, legalConsents])
    expect(writes[0]?.value).toMatchObject({ memberId: owner.id, expiresAt: new Date(result.expiresAt) })
    expect(writes[1]?.value).toMatchObject({ memberId: owner.id, termsVersion: LEGAL_VERSION, privacyVersion: LEGAL_VERSION })
  })
})
