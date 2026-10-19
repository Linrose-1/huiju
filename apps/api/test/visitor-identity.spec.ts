import 'reflect-metadata'
import { describe, expect, it, vi } from 'vitest'
import type { SQL } from 'drizzle-orm'
import { MySqlDialect } from 'drizzle-orm/mysql-core'
import { IdentityService, type Member } from '../src/flow/identity.js'
import type { FlowDatabase } from '../src/flow/common.js'
import type { WechatAdapter } from '../src/flow/wechat.js'
import { members, memberSessions, wechatIdentities } from '../src/database/schema/members.js'
import { legalConsents } from '../src/database/schema/platform.js'
import { LEGAL_VERSION } from '../src/platform/legal.js'
import { mkdir, writeFile } from 'node:fs/promises'

vi.mock('node:fs/promises', async importOriginal => ({
  ...await importOriginal<typeof import('node:fs/promises')>(),
  mkdir: vi.fn(() => { throw new Error('Identity tests must not create directories') }),
  writeFile: vi.fn(() => { throw new Error('Identity tests must not write files') }),
}))

// A transaction/query substitute only: real unique constraints and locks need MySQL acceptance.
function fixture(options: { existing?: boolean; complete?: boolean; inviter?: boolean } = {}) {
  let owner = options.existing ? { id: 'owner', memberNumber: 'HJ20261019000001', inviteCode: 'original', inviterMemberId: 'first-inviter',
    boundPhone: options.complete ? '13800000000' : null, displayName: options.complete ? '会员' : null,
    avatarUrl: options.complete ? '/avatar' : null, avatarSetByUser: Boolean(options.complete), nameSetByUser: Boolean(options.complete) } as Member : undefined
  let identity: { memberId: string } | undefined = owner ? { memberId: owner.id } : undefined
  const writes: { table: unknown; value: Record<string, unknown> }[] = []
  const db = {
    select() {
      let table: unknown, filter: { sql: string; params: unknown[] } | undefined
      const chain = {
        from: (value: unknown) => { table = value; return chain },
        where: (value: SQL) => { filter = new MySqlDialect().sqlToQuery(value); return chain },
        limit: () => chain, orderBy: () => chain, for: () => chain,
        then: (resolve: (value: unknown) => unknown) => {
          let rows: unknown[]
          if (table === wechatIdentities) rows = identity ? [identity] : []
          else if (table === memberSessions) rows = []
          else if (table === members && filter?.params.includes('platform_root')) rows = [{ id: 'platform' }]
          else if (table === members && filter?.params.some(value => typeof value === 'string' && value.includes('%'))) rows = []
          else if (table === members && filter?.params.includes('member')) rows = options.inviter ? [{ id: 'inviter' }] : []
          else if (table === members) rows = owner ? [owner] : []
          else throw new Error('Unexpected identity query')
          return Promise.resolve(rows).then(resolve)
        },
      }
      return chain
    },
    insert(table: unknown) { return { values: async (value: Record<string, unknown>) => {
      writes.push({ table, value })
      if (table === members) owner = value as Member
      if (table === wechatIdentities) identity = { memberId: value.memberId as string }
    } } },
    transaction: async <T>(callback: (tx: unknown) => Promise<T>): Promise<T> => callback(db),
  }
  const exchange = vi.fn(async () => ({ appId: 'test', openId: 'test-open-id', unionId: null }))
  const service = new IdentityService({ db } as unknown as FlowDatabase, { exchange } as unknown as WechatAdapter)
  return { service, writes, exchange, owner: () => owner }
}

describe('visitor silent identification without real database or WeChat', () => {
  it.each([
    { code: undefined, valid: false, inviter: 'platform' },
    { code: 'invalid-code', valid: false, inviter: 'platform' },
    { code: 'HJYQM20261019000002', valid: true, inviter: 'inviter' },
  ])('creates a visitor and fixes the first source for $code', async ({ code, valid, inviter }) => {
    const f = fixture({ inviter: valid })
    const first = await f.service.identify('temporary-code', code)
    expect(first.member.profileComplete).toBe(false)
    expect(first.token).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(f.owner()?.inviterMemberId).toBe(inviter)
    expect(f.writes.filter(write => write.table === legalConsents)).toEqual([])
    const again = await f.service.identify('next-code', 'different-source')
    expect(again.member.id).toBe(first.member.id)
    expect(f.owner()?.inviterMemberId).toBe(inviter)
    expect(f.writes.filter(write => write.table === members)).toHaveLength(1)
    expect(f.writes.filter(write => write.table === memberSessions)).toHaveLength(2)
    expect(f.writes.filter(write => write.table === legalConsents)).toEqual([])
  })

  it.each([false, true])('restores existing identity with profile complete=%s without rebinding or recording consent', async complete => {
    const f = fixture({ existing: true, complete })
    const result = await f.service.identify('temporary-code', 'new-source')
    expect(result.member).toMatchObject({ id: 'owner', profileComplete: complete })
    expect(f.owner()?.inviterMemberId).toBe('first-inviter')
    expect(f.writes.map(write => write.table)).toEqual([memberSessions])
  })

  it('does not create identity or session when WeChat recognition fails', async () => {
    const f = fixture()
    f.exchange.mockRejectedValueOnce(new Error('WeChat unavailable'))
    await expect(f.service.identify('bad-code')).rejects.toThrow('WeChat unavailable')
    expect(f.writes).toEqual([])
    expect(f.owner()).toBeUndefined()
  })

  it('keeps explicit legal consent independent from silent identification', async () => {
    const f = fixture()
    const visitor = await f.service.identify('first-code')
    await expect(f.service.login('explicit-code')).rejects.toMatchObject({ response: { code: 'LEGAL_CONSENT_REQUIRED' } })
    expect(f.exchange).toHaveBeenCalledTimes(1)
    const consent = { termsVersion: LEGAL_VERSION, privacyVersion: LEGAL_VERSION }
    const result = await f.service.login('explicit-code', 'new-source', consent)
    expect(result.member.id).toBe(visitor.member.id)
    expect(f.writes.filter(write => write.table === legalConsents).map(write => write.value)).toEqual([
      expect.objectContaining({ memberId: visitor.member.id, ...consent }),
    ])
    expect(f.owner()?.inviterMemberId).toBe('platform')
  })
})

describe('profile writes require explicit current legal consent', () => {
  function consentFixture(agreed = false) {
    const where = vi.fn(), update = vi.fn(), phone = vi.fn()
    const queries: { sql: string; params: unknown[] }[] = []
    const db = {
      select() {
        const chain = {
          from: (table: unknown) => { expect(table).toBe(legalConsents); return chain },
          where: (condition: SQL) => { queries.push(new MySqlDialect().sqlToQuery(condition)); return chain },
          limit: async () => agreed ? [{ memberId: 'visitor' }] : [],
        }
        return chain
      },
      update: update.mockReturnValue({ set: () => ({ where }) }),
    }
    const service = new IdentityService({ db } as unknown as FlowDatabase, { phone } as unknown as WechatAdapter)
    vi.spyOn(service, 'require').mockResolvedValue({ id: 'visitor', boundPhone: null } as Member)
    return { service, update, where, phone, queries }
  }

  it.each(['profile', 'phone', 'avatar'] as const)('rejects direct visitor %s before phone, files or profile writes without consent', async action => {
    const f = consentFixture()
    const call = action === 'profile' ? f.service.profile('Bearer visitor', '名称')
      : action === 'phone' ? f.service.phone('Bearer visitor', 'phone-code')
        : f.service.avatar('Bearer visitor', { mimeType: 'image/png', base64: 'invalid-image' })
    await expect(call).rejects.toMatchObject({ status: 403, response: { code: 'LEGAL_CONSENT_REQUIRED' } })
    expect(f.update).not.toHaveBeenCalled()
    expect(f.phone).not.toHaveBeenCalled()
    expect(mkdir).not.toHaveBeenCalled()
    expect(writeFile).not.toHaveBeenCalled()
    expect(f.queries).toHaveLength(1)
    expect(f.queries[0].params).toEqual(['visitor', LEGAL_VERSION, LEGAL_VERSION])
  })

  it('allows profile persistence with current explicit agreement for this identity', async () => {
    const f = consentFixture(true)
    vi.spyOn(f.service, 'me').mockResolvedValue({ id: 'visitor' } as Awaited<ReturnType<IdentityService['me']>>)
    expect(await f.service.profile('Bearer visitor', ' 名称 ')).toEqual({ id: 'visitor' })
    expect(f.update).toHaveBeenCalledExactlyOnceWith(members)
    expect(f.where).toHaveBeenCalledOnce()
    expect(f.queries[0].params).toEqual(['visitor', LEGAL_VERSION, LEGAL_VERSION])
  })
})
