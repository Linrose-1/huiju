import 'reflect-metadata'
import { IdentityService } from '../src/flow/identity.js'
import type { FlowDatabase } from '../src/flow/common.js'
import type { WechatAdapter } from '../src/flow/wechat.js'
import { members } from '../src/database/schema/members.js'
import { describe, expect, it } from 'vitest'
import { memberNumberPrefix, nextMemberNumber } from '../src/flow/member-number.js'

describe('member number format', () => {
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
  it('locks the root and latest number before inserting with the matching registration date', async () => {
    const events: string[] = []
    let inserted: Record<string, unknown> = {}
    let queryIndex = 0
    const db = {
      select() {
        const index = queryIndex++
        const results = () => [[], [{ id: 'root' }], [{ number: memberNumberPrefix(new Date()) + '000009' }], [inserted], []][index]
        const chain = {
          from: () => chain, where: () => chain, limit: () => chain, orderBy: () => chain,
          for: () => { events.push('lock:' + index); return chain },
          then: (resolve: (value: unknown) => unknown) => Promise.resolve(results()).then(resolve),
        }
        return chain
      },
      insert(table: unknown) { return { values: async (value: Record<string, unknown>) => {
        if (table === members) { inserted = value; events.push('insert-member') }
      } } },
      transaction: async <T>(callback: (tx: unknown) => Promise<T>): Promise<T> => callback(db),
    }
    const service = new IdentityService({ db } as unknown as FlowDatabase, { exchange: async () => ({ appId: 'test', openId: 'test', unionId: null }) } as unknown as WechatAdapter)
    const result = await service.login('code')
    expect(result.member.memberNumber).toBe(memberNumberPrefix(inserted.createdAt as Date) + '000010')
    expect(events.slice(0, 3)).toEqual(['lock:1', 'lock:2', 'insert-member'])
  })
})
