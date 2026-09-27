import 'reflect-metadata'
import { describe, expect, it, vi } from 'vitest'
import { plainToInstance } from 'class-transformer'
import { validate } from 'class-validator'
import { createHash, randomUUID } from 'node:crypto'
import { ReadingService, readerDto, viewStats } from '../src/flow/reading.js'
import { RecordViewInput, ReadersQuery } from '../src/flow/reading-dto.js'
import type { FlowDatabase } from '../src/flow/common.js'
import type { IdentityService, Member } from '../src/flow/identity.js'

const visitorId = randomUUID()
const eventId = randomUUID()
const visitorHash = createHash('sha256').update(visitorId).digest('hex')
const activity = { id: 'activity', lifecycle: 'published', moderation: 'normal', organizerMemberId: 'owner', activeRegistrationCount: 1 }
const event = { id: eventId, activityId: activity.id, visitorHash }
const member = { id: 'owner', memberNumber: '1001', avatarUrl: '/avatar.png', displayName: '当前名称', avatarSetByUser: true, nameSetByUser: true, boundPhone: '19900000001', realName: '私密姓名' } as Member

// Scripted repository verifies service boundaries; it does not simulate MySQL locks or rollback.
function fixture(results: unknown[][], identity?: Member) {
  const writes: { kind: string, values: unknown }[] = []
  const query: Record<string, unknown> = {}
  for (const method of ['from', 'where', 'for', 'limit', 'innerJoin', 'groupBy', 'orderBy', 'offset']) query[method] = () => query
  query.then = (resolve: (value: unknown) => unknown) => Promise.resolve(results.shift() ?? []).then(resolve)
  const tx = {
    select: vi.fn(() => query),
    insert: vi.fn(() => ({ values: (values: unknown) => ({ onDuplicateKeyUpdate: async () => { writes.push({ kind: 'insert', values }) } }) })),
    update: vi.fn(() => ({ set: (values: unknown) => ({ where: async () => { writes.push({ kind: 'update', values }) } }) })),
  }
  const requireIdentity = vi.fn().mockResolvedValue(identity)
  const db = { transaction: async (fn: (tx: unknown) => unknown) => fn(tx) }
  const service = new ReadingService({ db } as unknown as FlowDatabase, { require: requireIdentity } as unknown as IdentityService)
  return { service, writes, tx, requireIdentity }
}

describe('reading contract and privacy', () => {
  it('accepts only UUID v4 event/visitor ids and bounded integer pagination', async () => {
    expect(await validate(plainToInstance(RecordViewInput, { eventId, visitorId }))).toHaveLength(0)
    for (const body of [{ eventId }, { eventId: 'x', visitorId }, { eventId, visitorId: '' }]) {
      expect((await validate(plainToInstance(RecordViewInput, body))).length).toBeGreaterThan(0)
    }
    for (const offset of ['-1', '1.5', '1000001', 'bad']) expect((await validate(plainToInstance(ReadersQuery, { offset }))).length).toBeGreaterThan(0)
    expect(await validate(plainToInstance(ReadersQuery, { offset: '40' }))).toHaveLength(0)
  })

  it('only exposes current public display fields, defaulting incomplete identities', () => {
    expect(readerDto(member)).toEqual({ memberId: member.id, avatarUrl: '/avatar.png', displayName: '当前名称' })
    for (const change of [{ boundPhone: null }, { avatarSetByUser: false }, { nameSetByUser: false }, { displayName: ' ' }]) {
      expect(readerDto({ ...member, ...change })).toEqual({ memberId: member.id, avatarUrl: null, displayName: '会员1001' })
    }
    expect(readerDto({ ...member, displayName: '更新后的名称' }).displayName).toBe('更新后的名称')
  })

  it('uses current active registrations and null conversion when there are no visitors', () => {
    expect(viewStats(0, 0, 0)).toEqual({ views: 0, visitors: 0, conversionRate: null })
    expect(viewStats(8, 3, 2).conversionRate).toBe(66.67)
    expect(viewStats(8, 3, 1).conversionRate).toBe(33.33)
    expect(viewStats(8, 3, 0).conversionRate).toBe(0)
  })
})

describe('reading service boundaries', () => {
  it('records anonymous events without binding an identity', async () => {
    const f = fixture([[activity], [{ visitorHash, memberId: null }], [event]])
    expect(await f.service.record(activity.id, { eventId, visitorId })).toEqual({ ok: true })
    expect(f.requireIdentity).toHaveBeenCalledWith(undefined, true)
    expect(f.writes).toEqual([
      { kind: 'insert', values: { visitorHash } },
      { kind: 'insert', values: { id: eventId, visitorHash, activityId: activity.id } },
    ])
  })

  it('binds an existing anonymous visitor after login while retrying the same event', async () => {
    const f = fixture([[activity], [{ visitorHash, memberId: null }], [event]], member)
    await f.service.record(activity.id, { eventId, visitorId }, 'session')
    expect(f.writes.at(-1)).toEqual({ kind: 'update', values: { memberId: member.id } })
    // Retry insert contains the original id, no new id or rewritten timestamp.
    expect(f.writes[1].values).toEqual({ id: eventId, visitorHash, activityId: activity.id })
  })

  it('never rebinds an existing visitor to another account or an anonymous session', async () => {
    for (const identity of [member, undefined]) {
      const f = fixture([[activity], [{ visitorHash, memberId: 'someone-else' }]], identity)
      await expect(f.service.record(activity.id, { eventId, visitorId })).rejects.toMatchObject({ response: { code: 'VISITOR_CHANGED' } })
      expect(f.tx.update).not.toHaveBeenCalled()
      expect(f.tx.insert).toHaveBeenCalledTimes(1)
    }
  })

  it('rejects event collisions before binding any anonymous history', async () => {
    for (const mismatch of [{ visitorHash: 'foreign' }, { activityId: 'foreign' }]) {
      const f = fixture([[activity], [{ visitorHash, memberId: null }], [{ ...event, ...mismatch }]], member)
      await expect(f.service.record(activity.id, { eventId, visitorId })).rejects.toMatchObject({ response: { code: 'READING_EVENT_CONFLICT' } })
      expect(f.tx.update).not.toHaveBeenCalled()
    }
  })

  it('does not create a new identity association for already bound retries', async () => {
    const f = fixture([[activity], [{ visitorHash, memberId: member.id }], [event]], member)
    await f.service.record(activity.id, { eventId, visitorId })
    expect(f.tx.update).not.toHaveBeenCalled()
  })

  it('rejects missing/draft activities and skips removed activities before writing', async () => {
    for (const rows of [[], [{ ...activity, lifecycle: 'draft' }]]) {
      const f = fixture([rows])
      await expect(f.service.record(activity.id, { eventId, visitorId })).rejects.toMatchObject({ response: { code: 'NOT_FOUND' } })
      expect(f.writes).toEqual([])
    }
    const removed = fixture([[{ ...activity, moderation: 'removed' }]])
    expect(await removed.service.record(activity.id, { eventId, visitorId })).toEqual({ ok: true })
    expect(removed.writes).toEqual([])
    const cancelled = fixture([[{ ...activity, lifecycle: 'cancelled' }], [{ visitorHash, memberId: null }], [event]])
    await expect(cancelled.service.record(activity.id, { eventId, visitorId })).resolves.toEqual({ ok: true })
  })

  it('requires identity and activity ownership before reading private aggregates', async () => {
    const rejected = fixture([])
    rejected.requireIdentity.mockRejectedValue(new Error('session required'))
    await expect(rejected.service.stats(activity.id)).rejects.toThrow('session required')
    expect(rejected.tx.select).not.toHaveBeenCalled()
    const foreign = fixture([[activity]], { ...member, id: 'foreign' })
    await expect(foreign.service.stats(activity.id)).rejects.toMatchObject({ response: { code: 'FORBIDDEN' } })
    expect(foreign.tx.select).toHaveBeenCalledTimes(1)
    const owner = fixture([[activity], [{ views: 5, visitors: 2 }]], member)
    expect(await owner.service.stats(activity.id)).toEqual({ views: 5, visitors: 2, conversionRate: 50 })
  })

  it('returns a private-field-free page and hides removed activity readers', async () => {
    const f = fixture([[activity], [{ total: 42 }], [{ member, lastRead: new Date() }]])
    expect(await f.service.readers(activity.id, 40)).toEqual({ items: [{ memberId: member.id, avatarUrl: '/avatar.png', displayName: '当前名称' }], total: 42, hasMore: true })
    const removed = fixture([[{ ...activity, moderation: 'removed' }]])
    expect(await removed.service.readers(activity.id)).toEqual({ items: [], total: 0, hasMore: false })
    expect(removed.tx.select).toHaveBeenCalledTimes(1)
  })
})
