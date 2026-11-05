import 'reflect-metadata'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { plainToInstance } from 'class-transformer'
import { validate } from 'class-validator'
import { AdminController } from '../src/admin/controller.js'
import { adminLoginSource, csrfFor } from '../src/admin/security.js'
import { AdminService } from '../src/admin/service.js'
import type { FlowDatabase } from '../src/flow/common.js'
import { PageQuery } from '../src/flow/pagination.js'
import { adminAccounts } from '../src/database/schema/members.js'

afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks() })

describe('admin login source boundaries', () => {
  it('ignores forwarded headers unless explicitly enabled for a loopback peer', () => {
    vi.stubEnv('ADMIN_TRUST_LOOPBACK_PROXY', '')
    expect(adminLoginSource('127.0.0.1', '198.51.100.1')).toBe('127.0.0.1')
    vi.stubEnv('ADMIN_TRUST_LOOPBACK_PROXY', 'true')
    expect(adminLoginSource('192.0.2.1', '198.51.100.1')).toBe('192.0.2.1')
    expect(adminLoginSource(undefined, '198.51.100.1')).toBe('unknown')
    expect(adminLoginSource('::ffff:127.0.0.1', '198.51.100.1')).toBe('198.51.100.1')
  })

  it('uses only the direct proxy client and normalizes equivalent IP forms', () => {
    vi.stubEnv('ADMIN_TRUST_LOOPBACK_PROXY', 'true')
    expect(adminLoginSource('::1', 'spoofed, 198.51.100.2')).toBe('198.51.100.2')
    expect(adminLoginSource('::1', '::ffff:198.51.100.2')).toBe('198.51.100.2')
    expect(adminLoginSource('::1', '2001:0DB8:0:0:0:0:0:1')).toBe('2001:db8::1')
    expect(adminLoginSource('::ffff:c633:6402')).toBe('198.51.100.2')
    for (const header of [undefined, '', '198.51.100.2, invalid', '198.51.100.2:123', ['198.51.100.2'], 'x'.repeat(4097)]) {
      expect(adminLoginSource('127.0.0.1', header)).toBe('127.0.0.1')
    }
  })

  it('controller forwards the trusted source to the login limiter', async () => {
    vi.stubEnv('ADMIN_TRUST_LOOPBACK_PROXY', 'true')
    vi.stubEnv('ADMIN_ORIGIN', 'https://admin.example.test')
    const login = vi.fn().mockResolvedValue({ token: 'a'.repeat(64), session: { account: {} } })
    const controller = new AdminController({ login } as unknown as AdminService)
    await controller.login({ username: 'operator', password: 'secret' },
      { socket: { remoteAddress: '127.0.0.1' }, headers: { origin: 'https://admin.example.test', 'x-forwarded-for': '203.0.113.9' } }, { setHeader: vi.fn() })
    expect(login).toHaveBeenCalledWith('operator', 'secret', 'https://admin.example.test', '203.0.113.9')
  })

  it('blocks the 31st attempt for one source without blocking another, then expires at 15 minutes', async () => {
    vi.stubEnv('ADMIN_ORIGIN', 'https://admin.example.test')
    const clock = vi.spyOn(Date, 'now').mockReturnValue(1000)
    const transaction = vi.fn().mockRejectedValue(new Error('database reached'))
    const service = new AdminService({ db: { transaction } } as unknown as FlowDatabase)
    const login = (source: string) => service.login('operator', 'secret', 'https://admin.example.test', source)
    for (let index = 0; index < 30; index++) await expect(login('198.51.100.1')).rejects.toThrow('database reached')
    await expect(login('198.51.100.1')).rejects.toMatchObject({ status: 429 })
    expect(transaction).toHaveBeenCalledTimes(30)
    await expect(login('198.51.100.2')).rejects.toThrow('database reached')
    clock.mockReturnValue(1000 + 15 * 60 * 1000)
    await expect(login('198.51.100.1')).rejects.toThrow('database reached')
  })
})

describe('admin account pagination', () => {
  const token = 'a'.repeat(64)
  const context = { cookie: `huiju_admin_session=${token}`, csrfToken: csrfFor(token) }
  const account = { id: 'super', status: 'active', createdAt: new Date('2026-01-01'), displayName: '超级管理员' }
  const credential = { username: 'super', role: 'super_admin' }
  function fixture(count: number) {
    const accounts = Array.from({ length: count }, (_, index) => ({ account: { ...account, id: `account-${index}` }, credential }))
    const results: unknown[][] = [[{ id: 'session', adminAccountId: 'super' }], [{ account, credential }], [{ id: 'session' }], accounts]
    const orderBy = vi.fn(), limit = vi.fn(), offset = vi.fn()
    const tx = { select() {
      const rows = results.shift()
      const chain = { from: () => chain, innerJoin: () => chain, where: () => chain, for: () => chain,
        orderBy: (...values: unknown[]) => { orderBy(...values); return chain },
        limit: (value: number) => { limit(value); return chain }, offset: (value: number) => { offset(value); return chain },
        then: (resolve: (value: unknown) => unknown) => Promise.resolve(rows).then(resolve) }
      return chain
    } }
    const service = new AdminService({ db: { transaction: (callback: (value: typeof tx) => unknown) => callback(tx) } } as unknown as FlowDatabase)
    return { service, orderBy, limit, offset }
  }

  it('returns one page with a stable tie-breaker and a continuation flag', async () => {
    const f = fixture(3)
    const result = await f.service.listAccounts(context, { offset: 2, limit: 2 })
    expect(result.items).toHaveLength(2)
    expect(result.hasMore).toBe(true)
    expect(result.items[0]).not.toHaveProperty('credential')
    expect(f.orderBy).toHaveBeenCalledWith(adminAccounts.createdAt, adminAccounts.id)
    expect(f.limit).toHaveBeenCalledWith(3)
    expect(f.offset).toHaveBeenCalledWith(2)
  })

  it('keeps default service calls valid and marks last/empty pages complete', async () => {
    for (const count of [0, 2, 20]) {
      const f = fixture(count)
      expect(await f.service.listAccounts(context)).toMatchObject({ hasMore: false })
      expect(f.limit).toHaveBeenCalledWith(21)
      expect(f.offset).toHaveBeenCalledWith(0)
    }
  })

  it('validates bounded pagination query parameters', async () => {
    expect(await validate(plainToInstance(PageQuery, { offset: '20', limit: '20' }))).toHaveLength(0)
    for (const query of [{ offset: -1 }, { offset: 1.5 }, { limit: 0 }, { limit: 101 }]) {
      expect((await validate(plainToInstance(PageQuery, query))).length).toBeGreaterThan(0)
    }
  })
})
