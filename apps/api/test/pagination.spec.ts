import 'reflect-metadata'
import { describe, expect, it, vi } from 'vitest'
import { plainToInstance } from 'class-transformer'
import { validate } from 'class-validator'
import { MySqlDialect } from 'drizzle-orm/mysql-core'
import { ActivityService } from '../src/flow/activity.js'
import { OrganizerService } from '../src/flow/organizer.js'
import { PageQuery, MyActivityQuery, MyRegistrationQuery, RosterQuery, activityStatusSql } from '../src/flow/pagination.js'
import type { FlowDatabase } from '../src/flow/common.js'
import type { IdentityService } from '../src/flow/identity.js'

const now = new Date('2030-01-01T00:00:00Z')
const dialect = new MySqlDialect()
function fixture(results: unknown[][]) {
  const calls: { method: string; args: unknown[]; query: number }[] = []
  let query = 0
  const db = { select: vi.fn(() => {
    const index = query++, result = results[index]
    if (!result) throw new Error(`Unexpected database query ${index}`)
    const chain: Record<string, unknown> = { then: (resolve: (rows: unknown[]) => unknown) => Promise.resolve(result).then(resolve) }
    for (const method of ['from', 'innerJoin', 'where', 'orderBy', 'limit', 'offset', 'groupBy']) {
      chain[method] = (...args: unknown[]) => { calls.push({ method, args, query: index }); return chain }
    }
    return chain
  }) }
  const identity = { require: vi.fn(async () => ({ id: 'owner' })) } as unknown as IdentityService
  const database = { db } as unknown as FlowDatabase
  return { activity: new ActivityService(database, identity), organizer: new OrganizerService(database, identity), calls, db }
}
const notification = (id: string) => ({ id, activityId: 'activity', type: 'activity_cancelled', title: '通知', body: '内容', readAt: null, createdAt: now })
const registration = (id: string) => ({ id, activityId: 'activity', status: 'active', contactPhone: '13800000000', currentRegisteredAt: now, cancelledAt: null, attended: true, attendedAt: now })

describe('bounded list pagination', () => {
  it('validates transformed page bounds and rejects unsupported status values', async () => {
    expect(plainToInstance(PageQuery, {})).toEqual({ offset: 0, limit: 20 })
    expect(await validate(plainToInstance(PageQuery, { offset: '100', limit: '100' }))).toHaveLength(0)
    for (const input of [{ offset: -1 }, { offset: 1000001 }, { offset: 0.1 }, { limit: 0 }, { limit: 101 }, { limit: 'bad' }]) {
      expect((await validate(plainToInstance(PageQuery, input))).length).toBeGreaterThan(0)
    }
    expect(await validate(plainToInstance(MyActivityQuery, { status: 'draft' }))).toHaveLength(0)
    expect((await validate(plainToInstance(MyRegistrationQuery, { status: 'draft' }))).length).toBeGreaterThan(0)
    expect((await validate(plainToInstance(RosterQuery, { status: 'removed' }))).length).toBeGreaterThan(0)
  })

  it('keeps unread and total notification counts independent of the requested page', async () => {
    const f = fixture([[{ value: 87 }], [{ value: 143 }], [notification('21'), notification('22'), notification('23')]])
    const result = await f.organizer.notifications('token', { offset: 20, limit: 2 })
    expect(result).toMatchObject({ unreadCount: 87, total: 143, hasMore: true })
    expect(result.items.map(item => item.id)).toEqual(['21', '22'])
    expect(f.calls).toContainEqual({ query: 2, method: 'offset', args: [20] })
    expect(f.calls).toContainEqual({ query: 2, method: 'limit', args: [3] })
  })

  it('preserves full status counts on an empty later filtered organizer page', async () => {
    const f = fixture([[{ status: 'ongoing', value: 2 }, { status: 'draft', value: 103 }], []])
    const result = await f.organizer.list('token', { offset: 100, limit: 20, status: 'ongoing' })
    expect(result).toMatchObject({ items: [], hasMore: false, total: 105, counts: { all: 105, ongoing: 2, draft: 103 } })
    const condition = f.calls.find(call => call.query === 1 && call.method === 'where')!.args[0]
    const compiled = dialect.sqlToQuery(condition as Parameters<MySqlDialect['sqlToQuery']>[0])
    expect(compiled.params).toContain('ongoing')
    expect(compiled.params).toContain('owner')
  })

  it('counts all own registrations and active registrations even for an empty filtered page', async () => {
    const f = fixture([[{ status: 'ended', value: 105 }, { status: 'cancelled', value: 3 }], [{ value: 105 }], []])
    const result = await f.activity.allMine('token', { offset: 100, limit: 20, status: 'cancelled' })
    expect(result).toMatchObject({ items: [], hasMore: false, total: 108, activeCount: 105, counts: { ended: 105, cancelled: 3 } })
    expect(f.db.select).toHaveBeenCalledTimes(3)
  })

  it('bounds the private roster, batches answers and retains whole-activity attendance totals', async () => {
    const row = (id: string) => ({ registration: registration(id), member: { memberId: id, avatarUrl: null, displayName: id } })
    const f = fixture([[{ organizerMemberId: 'owner', lifecycle: 'published' }],
      [{ total: 240, activeCount: 210, cancelledCount: 30, attendedCount: 190 }], [row('21'), row('22'), row('23')],
      [{ registrationId: '21', questionId: 'q', value: 'private answer' }]])
    const result = await f.organizer.roster('activity', 'token', { offset: 20, limit: 2, status: 'active' })
    expect(result).toMatchObject({ total: 240, activeCount: 210, cancelledCount: 30, attendedCount: 190, hasMore: true })
    expect(result.items).toHaveLength(2)
    expect(result.items[0].answers).toEqual([{ questionId: 'q', value: 'private answer' }])
    expect(result.items[1].answers).toEqual([])
    expect(f.db.select).toHaveBeenCalledTimes(4)
    const answersWhere = f.calls.find(call => call.query === 3 && call.method === 'where')!.args[0]
    expect(dialect.sqlToQuery(answersWhere as Parameters<MySqlDialect['sqlToQuery']>[0]).params).toEqual(['21', '22'])
  })

  it('rejects another organizer before querying private counts or answers', async () => {
    const f = fixture([[{ organizerMemberId: 'someone-else' }]])
    await expect(f.organizer.roster('activity', 'token')).rejects.toThrow('仅活动发起人')
    expect(f.db.select).toHaveBeenCalledTimes(1)
  })

  it('serves public roster pages beyond the former cap and returns no private fields', async () => {
    const f = fixture([[{ moderation: 'normal' }],
      [{ memberId: '201', avatarUrl: null, displayName: '甲' }, { memberId: '202', avatarUrl: null, displayName: '乙' }],
      [{ value: 240 }]])
    vi.spyOn(f.activity, 'detail').mockResolvedValue({} as never)
    const result = await f.activity.roster('activity', { offset: 200, limit: 1 })
    expect(result).toEqual({ items: [{ memberId: '201', avatarUrl: null, displayName: '甲' }], total: 240, hasMore: true })
    expect(f.calls).toContainEqual({ query: 1, method: 'offset', args: [200] })
    expect(f.calls.find(call => call.query === 1 && call.method === 'orderBy')!.args).toHaveLength(2)
  })

  it('does not reveal removed activity roster counts', async () => {
    const f = fixture([[{ moderation: 'removed' }]])
    vi.spyOn(f.activity, 'detail').mockResolvedValue({} as never)
    expect(await f.activity.roster('activity')).toEqual({ items: [], total: 0, hasMore: false })
    expect(f.db.select).toHaveBeenCalledTimes(1)
  })

  it('applies removal and cancellation precedence before temporal status in SQL', () => {
    const own = dialect.sqlToQuery(activityStatusSql(false, now)).sql
    const registered = dialect.sqlToQuery(activityStatusSql(true, now)).sql
    expect(own.indexOf("then 'removed'")).toBeLessThan(own.indexOf("then 'draft'"))
    expect(own.indexOf("then 'draft'")).toBeLessThan(own.indexOf("then 'cancelled'"))
    expect(registered).not.toContain("then 'draft'")
    expect(registered.indexOf("then 'cancelled'")).toBeLessThan(registered.indexOf("then 'ended'"))
    expect(registered).toContain('`registrations`.`status`')
  })
})
