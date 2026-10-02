import 'reflect-metadata'
import type { AddressInfo } from 'node:net'
import { ValidationPipe, type INestApplication } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { MySqlDialect } from 'drizzle-orm/mysql-core'
import type { SQL } from 'drizzle-orm'
import { ActivityModerationService } from '../src/flow/activity-moderation.js'
import { AdminActivityController } from '../src/admin/activity-controller.js'
import { AdminService, type AdminTransaction } from '../src/admin/service.js'
import { csrfFor } from '../src/admin/security.js'
import { NotificationDelivery } from '../src/notifications/delivery.js'
import { FlowDatabase, SafeExceptionFilter } from '../src/flow/common.js'
import { ActivityService, registrationState } from '../src/flow/activity.js'
import type { IdentityService } from '../src/flow/identity.js'
import { activities, activityOperations } from '../src/database/schema/activities.js'
import { notifications } from '../src/database/schema/notifications.js'

const id = 'a1234567-1234-4123-8123-123456789012'
const now = new Date('2030-01-01T00:00:00Z')
const activity = () => ({ id, title: '活动', description: '说明', location: '场地', organizerMemberId: 'member',
  lifecycle: 'published', moderation: 'normal', startsAt: new Date('2031-01-01'), endsAt: new Date('2031-01-02'),
  registrationDeadline: null, capacity: 20, activeRegistrationCount: 8, feeType: 'free', feeAmountCents: null,
  consultationContact: 'private contact', createdAt: now })

// Query results are substituted, but real services choose filters, locks, writes and transaction scope.
function fixture(results: (unknown[] | (() => unknown[]))[] = []) {
  const filters: SQL[] = [], events: string[] = []
  const calls: { method: string; args: unknown[] }[] = []
  const writes: { table: unknown; values: Record<string, unknown>[] }[] = []
  let failNotifications = false
  const tx = {
    select: vi.fn(() => {
      const query: Record<string, unknown> = {}
      for (const method of ['from', 'innerJoin', 'leftJoin', 'limit', 'offset', 'orderBy']) query[method] = (...args: unknown[]) => { calls.push({ method, args }); return query }
      query.where = (filter: SQL) => { filters.push(filter); return query }
      query.for = (lock: string) => { events.push(`lock:${lock}`); return query }
      query.then = (resolve: (rows: unknown[]) => unknown) => {
        const next = results.shift()
        if (!next) throw new Error('Unexpected query')
        return Promise.resolve(typeof next === 'function' ? next() : next).then(resolve)
      }
      return query
    }),
    update: vi.fn((table: unknown) => ({ set: (values: Record<string, unknown>) => ({ where: async () => {
      events.push('update'); writes.push({ table, values: [values] })
    } }) })),
    insert: vi.fn((table: unknown) => ({ values: async (value: Record<string, unknown> | Record<string, unknown>[]) => {
      if (table === notifications && failNotifications) throw new Error('notification insert failed')
      events.push(table === notifications ? 'notify' : 'audit')
      writes.push({ table, values: Array.isArray(value) ? value : [value] })
    } }))
  } as unknown as AdminTransaction
  const transaction = vi.fn(async (callback: (tx: AdminTransaction) => Promise<unknown>) => {
    events.push('begin')
    try { const result = await callback(tx); events.push('commit'); return result }
    catch (error) { events.push('rollback'); throw error }
  })
  return { tx, results, filters, calls, writes, events, transaction, failNotifications: () => { failNotifications = true },
    database: { db: { transaction } } as unknown as FlowDatabase,
    service: new ActivityModerationService(new NotificationDelivery()) }
}
const authRows = (role: 'super_admin' | 'operator') => [
  [{ id: 'session', adminAccountId: 'admin' }],
  [{ account: { id: 'admin', status: 'active', displayName: '管理员', createdAt: now }, credential: { role, username: 'admin' } }],
  [{ id: 'session' }],
]
const cookie = `huiju_admin_session=${'a'.repeat(64)}`
const context = { cookie, origin: 'https://admin.test', csrfToken: csrfFor('a'.repeat(64)) }

describe('activity moderation service with database substitute', () => {
  it('rejects missing, draft and blank-reason changes before writes', async () => {
    for (const rows of [[], [{ ...activity(), lifecycle: 'draft' }]]) {
      const f = fixture([rows])
      await expect(f.service.change(f.tx, id, 'remove', '原因', { id: 'admin' })).rejects.toThrow()
      expect(f.writes).toEqual([])
    }
    const f = fixture()
    await expect(f.service.change(f.tx, id, 'remove', '  ', { id: 'admin' })).rejects.toThrow('操作原因')
    expect(f.tx.select).not.toHaveBeenCalled()
  })

  it('locks the same activity before changing only moderation, recording audit and delivering to active recipients', async () => {
    const f = fixture([[activity()], [{ memberId: 'one' }, { memberId: 'two' }], [{ ...activity(), moderation: 'removed' }]])
    await f.service.change(f.tx, id, 'remove', ' 违规 ', { id: 'admin' })
    await f.service.change(f.tx, id, 'remove', '重复原因', { id: 'admin' })
    expect(f.events).toEqual(['lock:update', 'update', 'audit', 'notify', 'lock:update'])
    expect(f.writes[0]).toEqual({ table: activities, values: [{ moderation: 'removed' }] })
    expect(f.writes[1].table).toBe(activityOperations)
    expect(f.writes[1].values[0]).toMatchObject({ action: 'remove', actorType: 'admin', actorAdminAccountId: 'admin', reason: '违规', activityId: id })
    expect(f.writes[2].values.map(row => row.recipientMemberId)).toEqual(['one', 'two'])
    const query = new MySqlDialect().sqlToQuery(f.filters[1]!)
    expect(query.params).toEqual([id, 'active'])
    expect(f.writes).toHaveLength(3)
  })

  it.each(['cancelled', 'published'])('restores %s without altering lifecycle, dates, registrations or capacity', async lifecycle => {
    const original = { ...activity(), lifecycle, moderation: 'removed' }
    const f = fixture([[original], []])
    await f.service.change(f.tx, id, 'restore', '复核通过', { id: 'admin' })
    expect(f.writes[0]).toEqual({ table: activities, values: [{ moderation: 'normal' }] })
    const restored = { ...original, ...f.writes[0].values[0] } as typeof activities.$inferSelect
    expect(registrationState(restored, now)).toBe(lifecycle === 'cancelled' ? 'cancelled' : 'open')
    expect(registrationState({ ...restored, activeRegistrationCount: 20 }, now)).toBe(lifecycle === 'cancelled' ? 'cancelled' : 'full')
    expect(registrationState(restored, new Date('2032-01-01'))).toBe(lifecycle === 'cancelled' ? 'cancelled' : 'closed')
    expect(registrationState({ ...restored, moderation: 'removed' }, now)).toBe('removed')
  })

  it('keeps removed activities out of public lists and redacts anonymous details', async () => {
    const f = fixture([[], [{ ...activity(), moderation: 'removed' }]])
    const publicService = new ActivityService({ db: f.tx } as unknown as FlowDatabase,
      { require: vi.fn(async () => null) } as unknown as IdentityService)
    expect(await publicService.list()).toEqual({ items: [], hasMore: false })
    const filter = new MySqlDialect().sqlToQuery(f.filters[0]!)
    expect(filter.params).toEqual(['published', 'normal'])
    const detail = await publicService.detail(id)
    expect(detail).toMatchObject({ title: '活动已下架', description: '', location: '', organizer: null, questions: [], registrationState: 'removed' })
    expect(detail).not.toHaveProperty('consultationContact')
  })

  it('paginates the management list and history with stable secondary ordering and no private contact', async () => {
    const f = fixture([[{ value: 43 }], [{ activity: activity(), organizerName: '发起人' }], [{ id }],
      Array.from({ length: 21 }, (_, i) => ({ operation: { id: String(i), action: 'remove', reason: '原因', createdAt: now }, actorName: '管理员' }))])
    const list = await f.service.list(f.tx, { offset: 20, status: 'removed', q: '%_' })
    expect(list).toMatchObject({ total: 43, hasMore: true })
    expect(JSON.stringify(list)).not.toContain('private contact')
    const where = new MySqlDialect().sqlToQuery(f.filters[0]!)
    expect(where.params).toEqual(['draft', 'removed', '%_'])
    expect(where.sql).toContain('locate(')
    const history = await f.service.history(f.tx, id, 40)
    expect(history.items).toHaveLength(20)
    expect(history.hasMore).toBe(true)
    expect(f.calls).toContainEqual({ method: 'offset', args: [40] })
    expect(f.calls.filter(call => call.method === 'orderBy').every(call => call.args.length === 2)).toBe(true)
  })

  it('chunks large recipient lists without truncation and propagates delivery errors', async () => {
    const f = fixture([[activity()], Array.from({ length: 401 }, (_, i) => ({ memberId: `member-${i}` }))])
    await f.service.change(f.tx, id, 'remove', '原因', { id: 'admin' })
    expect(f.writes.filter(write => write.table === notifications).map(write => write.values.length)).toEqual([200, 200, 1])
  })
})

describe('activity moderation HTTP with real AdminService and domain service', () => {
  let app: INestApplication, base: string, current: ReturnType<typeof fixture>
  beforeAll(async () => {
    vi.stubEnv('ADMIN_ORIGIN', context.origin)
    const module = await Test.createTestingModule({ controllers: [AdminActivityController], providers: [AdminService, ActivityModerationService, NotificationDelivery,
      { provide: FlowDatabase, useValue: { get db() { return current.database.db } } },
    ] }).compile()
    app = module.createNestApplication({ logger: false })
    app.setGlobalPrefix('api/v1')
    app.useGlobalFilters(new SafeExceptionFilter())
    app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }))
    await app.listen(0, '127.0.0.1')
    base = `http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}/api/v1/admin/activities`
  })
  afterAll(async () => { await app?.close(); vi.unstubAllEnvs() })
  function post(body: unknown, extra: Record<string, string> = {}) {
    return fetch(`${base}/${id}/remove`, { method: 'POST', headers: { 'Content-Type': 'application/json', cookie, origin: context.origin, 'x-csrf-token': context.csrfToken, ...extra }, body: JSON.stringify(body) })
  }

  it.each(['operator', 'super_admin'] as const)('allows %s through cookie, origin, CSRF, session and activity locks', async role => {
    current = fixture([...authRows(role), [activity()], [{ memberId: 'registered' }]])
    const response = await post({ reason: '测试原因' })
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ ok: true })
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(current.events).toEqual(['begin', 'lock:update', 'lock:update', 'lock:update', 'update', 'audit', 'notify', 'commit'])
  })

  it('rejects anonymous/member tokens, invalid CSRF and origin before database access', async () => {
    const invalidHeaders: Record<string, string>[] = [{ cookie: '', authorization: 'Bearer member' }, { cookie: '' }, { 'x-csrf-token': 'forged' }, { origin: 'https://other.test' }]
    for (const headers of invalidHeaders) {
      current = fixture()
      const response = await post({ reason: '原因' }, headers)
      expect([401, 403]).toContain(response.status)
      expect(current.transaction).not.toHaveBeenCalled()
    }
    current = fixture()
    const response = await fetch(base, { headers: { authorization: 'Bearer member' } })
    expect(response.status).toBe(401)
    expect(current.transaction).not.toHaveBeenCalled()
  })

  it('rejects forged actor/state fields, invalid reason and paging before domain execution', async () => {
    for (const body of [{ reason: '' }, { reason: '   ' }, { reason: 'ok', actorAdminAccountId: 'forged' }, { reason: 'ok', moderation: 'normal' }, { reason: 'x'.repeat(1001) }]) {
      current = fixture()
      const response = await post(body)
      expect(response.status).toBe(400)
      expect(current.transaction).not.toHaveBeenCalled()
    }
    for (const query of ['offset=-1', 'offset=1.5', 'status=draft', 'role=super_admin']) {
      current = fixture()
      expect((await fetch(`${base}?${query}`, { headers: { cookie } })).status).toBe(400)
      expect(current.transaction).not.toHaveBeenCalled()
    }
  })

  it('fails the enclosing admin transaction when notification insertion fails', async () => {
    current = fixture([...authRows('operator'), [activity()], [{ memberId: 'registered' }]])
    current.failNotifications()
    const response = await post({ reason: '原因' })
    expect(response.status).toBe(500)
    expect(await response.json()).toMatchObject({ code: 'SERVICE_UNAVAILABLE' })
    expect(current.events).toContain('rollback')
    expect(current.events).not.toContain('commit')
    // This proves rejection crosses the transaction callback, not real MySQL rollback semantics.
    expect(current.transaction).toHaveBeenCalledTimes(1)
  })
})
