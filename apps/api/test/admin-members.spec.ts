import 'reflect-metadata'
import type { AddressInfo } from 'node:net'
import { ValidationPipe, type INestApplication } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { MySqlDialect } from 'drizzle-orm/mysql-core'
import type { SQL } from 'drizzle-orm'
import { AdminMemberController } from '../src/admin/member-controller.js'
import { AdminMemberQuery } from '../src/admin/member-dto.js'
import { AdminMemberService } from '../src/admin/member-service.js'
import { AdminService, type AdminTransaction } from '../src/admin/service.js'
import { FlowDatabase, SafeExceptionFilter } from '../src/flow/common.js'

const member = { id: 'member', kind: 'member', memberNumber: 'M001', displayName: '会员', realName: '私有姓名',
  boundPhone: '13800138000', avatarUrl: '/avatar', avatarSetByUser: true, nameSetByUser: true, createdAt: new Date(0),
  inviterMemberId: 'root', inviteCode: 'INVITE', email: 'private@example.com', hometown: '家乡', resources: '资源', needs: '需求', bio: '简介',
  tokenHash: 'must-not-leak', openId: 'must-not-leak' }

function fixture(results: unknown[][]) {
  const query: Record<string, unknown> = {}
  const filters: SQL[] = []
  for (const name of ['from', 'limit', 'orderBy', 'offset', 'innerJoin', 'for']) query[name] = vi.fn(() => query)
  query.where = (filter: SQL) => { filters.push(filter); return query }
  query.then = (resolve: (rows: unknown[]) => unknown) => Promise.resolve(results.shift() ?? []).then(resolve)
  return { tx: { select: vi.fn(() => query) } as unknown as AdminTransaction, query, filters, service: new AdminMemberService() }
}

describe('admin member read service (database substitute)', () => {
  it.each(['super_admin', 'operator'])('allows %s through the real session boundary without writing', async role => {
    const account = { id: 'admin', status: 'active', displayName: '管理员', createdAt: new Date(0) }
    const credential = { username: 'admin', role }
    const f = fixture([[{ id: 'session', adminAccountId: 'admin' }], [{ account, credential }], [{ id: 'session' }], [{ value: 1 }], [member]])
    const database = { db: { transaction: (callback: (tx: AdminTransaction) => unknown) => callback(f.tx) } } as unknown as FlowDatabase
    const controller = new AdminMemberController(new AdminService(database), f.service)
    const result = await controller.list({ offset: 0, profile: 'all' }, { headers: { cookie: `huiju_admin_session=${'a'.repeat(64)}` } })
    expect(result.items[0]?.id).toBe('member')
  })

  it('returns only safe summary fields and paginates deterministically', async () => {
    const f = fixture([[{ value: 41 }], [member]])
    const result = await f.service.list(f.tx, { offset: 0, profile: 'all', q: '%_', inviterId: 'root' })
    expect(result).toEqual({ total: 41, hasMore: true, items: [{ id: 'member', memberNumber: 'M001', displayName: '会员', realName: '私有姓名', boundPhone: '13800138000', profileComplete: true, createdAt: new Date(0).toISOString() }] })
    expect(f.query.limit).toHaveBeenCalledWith(40)
    const filter = new MySqlDialect().sqlToQuery(f.filters[0]!)
    expect(filter.sql).toContain('locate(')
    expect(filter.params).toEqual(['member', 'root', '%_', '%_', '%_', '%_'])
  })

  it('returns complete private profile with direct inviter identity, excluding internal fields', async () => {
    const f = fixture([[member], [{ id: 'root', memberNumber: 'ROOT', displayName: '平台', kind: 'platform_root', tokenHash: 'secret' }], [{ value: 2 }]])
    const result = await f.service.detail(f.tx, 'member')
    expect(result).toMatchObject({ email: member.email, resources: member.resources, inviteCode: member.inviteCode, inviteeCount: 2,
      inviter: { id: 'root', memberNumber: 'ROOT', displayName: '平台', kind: 'platform_root' } })
    expect(Object.keys(result).sort()).toEqual(['id', 'memberNumber', 'displayName', 'realName', 'boundPhone', 'profileComplete', 'createdAt', 'avatarUrl', 'email', 'hometown', 'resources', 'needs', 'bio', 'inviteCode', 'inviter', 'inviteeCount'].sort())
    expect(JSON.stringify(result)).not.toContain('secret')
    expect(JSON.stringify(result)).not.toContain('must-not-leak')
  })

  it('rejects missing members and platform root details', async () => {
    for (const rows of [[], [{ ...member, kind: 'platform_root' }]]) {
      const f = fixture([rows])
      await expect(f.service.detail(f.tx, 'unknown')).rejects.toMatchObject({ response: { code: 'MEMBER_NOT_FOUND' } })
    }
  })

  it('keeps profile readiness separate from real name and requires user-set avatar/name', async () => {
    const f = fixture([[{ value: 2 }], [{ ...member, realName: null }, { ...member, avatarSetByUser: false }]])
    const result = await f.service.list(f.tx, { offset: 0, profile: 'all' })
    expect(result.items.map(item => item.profileComplete)).toEqual([true, false])
  })

  it('validates bounded search and pagination and disallows injected filter fields', async () => {
    const pipe = new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true })
    for (const value of [{ q: 'a'.repeat(101) }, { offset: '-1' }, { offset: '1.5' }, { offset: '100001' }, { inviterId: 'root' }, { profile: 'other' }, { kind: 'platform_root' }]) {
      await expect(pipe.transform(value, { type: 'query', metatype: AdminMemberQuery })).rejects.toThrow()
    }
    await expect(pipe.transform({ q: ' 会员 ', offset: '40' }, { type: 'query', metatype: AdminMemberQuery })).resolves.toEqual({ q: '会员', offset: 40, profile: 'all' })
  })
})

describe('admin member HTTP authentication boundary', () => {
  let app: INestApplication, base: string
  const databaseAccess = vi.fn(() => { throw new Error('No database allowed') })
  const service = { list: vi.fn(), detail: vi.fn() }
  beforeAll(async () => {
    const module = await Test.createTestingModule({ controllers: [AdminMemberController], providers: [AdminService,
      { provide: FlowDatabase, useValue: { get db() { return databaseAccess() } } }, { provide: AdminMemberService, useValue: service },
    ] }).compile()
    app = module.createNestApplication()
    app.useGlobalFilters(new SafeExceptionFilter())
    app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }))
    await app.listen(0, '127.0.0.1')
    base = `http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}/admin/members`
  })
  afterAll(async () => { await app?.close() })
  it('blocks anonymous and miniapp bearer users before member queries', async () => {
    for (const suffix of ['', '/12345678-1234-4234-8234-123456789abc']) {
      for (const headers of [{}, { Authorization: 'Bearer member-session' }] as Record<string, string>[]) {
        const response = await fetch(base + suffix, { headers })
        expect(response.status).toBe(401)
        expect(await response.json()).toMatchObject({ code: 'ADMIN_SESSION_REQUIRED' })
      }
    }
    expect(databaseAccess).not.toHaveBeenCalled()
    expect(service.list).not.toHaveBeenCalled()
    expect(service.detail).not.toHaveBeenCalled()
  })
  it('rejects malformed detail IDs and pagination', async () => {
    for (const suffix of ['/bad-id', '?offset=-1']) expect((await fetch(base + suffix)).status).toBe(400)
  })
})
