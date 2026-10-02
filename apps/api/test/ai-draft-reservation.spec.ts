import 'reflect-metadata'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { SQL } from 'drizzle-orm'
import { MySqlDialect } from 'drizzle-orm/mysql-core'
import { ActivityDraftService } from '../src/ai/service.js'
import { AgentIsHereDraftProvider } from '../src/ai/provider.js'
import { aiActivityDraftReservations, aiActivityDraftUsages } from '../src/database/schema/ai.js'
import { members } from '../src/database/schema/members.js'
import { FlowDatabase } from '../src/flow/common.js'
import { IdentityService } from '../src/flow/identity.js'

type Member = typeof members.$inferSelect
type Reservation = typeof aiActivityDraftReservations.$inferSelect
type Usage = typeof aiActivityDraftUsages.$inferSelect
const dialect = new MySqlDialect()
const completeMember = (id: string) => ({ id, kind: 'member', boundPhone: '13800000000', displayName: '甲', avatarUrl: '/avatar', avatarSetByUser: true, nameSetByUser: true }) as Member
const draft = { title: '读书会', description: '一起读书' }
const idea = '一起读书'
const asDate = (value: unknown) => value instanceof Date ? value : new Date(String(value).replace(' ', 'T') + 'Z')

// A serialized, rollback-capable repository substitute. This verifies service ordering,
// fencing and query scope, not MySQL's real locking/isolation behavior.
function repository() {
  const memberRows = new Map<string, Member>([['member', completeMember('member')]])
  let reservations = new Map<string, Reservation>()
  let usages: Usage[] = []
  let activeTransactions = 0
  let transactionTail = Promise.resolve()
  let failCleanup = false
  const db = {
    select: () => ({ from: (table: unknown) => ({ where: (where: SQL) => {
      const read = () => {
        const params = dialect.sqlToQuery(where).params
        const id = String(params[0])
        if (table === members) return memberRows.has(id) ? [structuredClone(memberRows.get(id))] : []
        if (table === aiActivityDraftReservations) return reservations.has(id) ? [structuredClone(reservations.get(id))] : []
        if (table === aiActivityDraftUsages) return [{ total: usages.filter(row => row.memberId === id && row.createdAt >= asDate(params[1]) && row.createdAt < asDate(params[2])).length }]
        throw new Error('Unexpected table')
      }
      return { for: async (mode: string) => { expect(mode).toBe('update'); return read() }, then: (resolve: (value: unknown) => unknown, reject: (error: unknown) => unknown) => Promise.resolve().then(read).then(resolve, reject) }
    } }) }),
    insert: (table: unknown) => ({ values: (values: Reservation | Usage) => {
      const insert = () => {
        expect(activeTransactions).toBe(1)
        if (table === aiActivityDraftReservations) reservations.set(values.memberId, structuredClone(values as Reservation))
        else if (table === aiActivityDraftUsages) usages.push(structuredClone(values as Usage))
        else throw new Error('Unexpected write')
      }
      return { onDuplicateKeyUpdate: async () => insert(), then: (resolve: (value: unknown) => unknown, reject: (error: unknown) => unknown) => Promise.resolve().then(insert).then(resolve, reject) }
    } }),
    delete: (table: unknown) => ({ where: async (where: SQL) => {
      expect(table).toBe(aiActivityDraftReservations)
      if (!activeTransactions && failCleanup) throw new Error('cleanup unavailable')
      const [memberId, reservationId] = dialect.sqlToQuery(where).params.map(String)
      const current = reservations.get(memberId)
      if (current && (!reservationId || current.reservationId === reservationId)) reservations.delete(memberId)
    } }),
    transaction: async (work: (tx: unknown) => Promise<unknown>) => {
      const prior = transactionTail
      let release!: () => void
      transactionTail = new Promise<void>(resolve => { release = resolve })
      await prior
      activeTransactions++
      const beforeReservations = structuredClone(reservations), beforeUsages = structuredClone(usages)
      try { return await work(db) }
      catch (error) { reservations = beforeReservations; usages = beforeUsages; throw error }
      finally { activeTransactions--; release() }
    },
  }
  return {
    database: { db } as unknown as FlowDatabase, memberRows,
    get reservations() { return reservations }, get usages() { return usages }, get activeTransactions() { return activeTransactions },
    set failCleanup(value: boolean) { failCleanup = value },
  }
}

function setup(store = repository()) {
  const identity = { require: vi.fn(async (header?: string) => store.memberRows.get(header ?? 'member')) }
  const provider = { generate: vi.fn(async (): Promise<unknown> => {
    expect(store.activeTransactions).toBe(0)
    return draft
  }) }
  const service = new ActivityDraftService(store.database, identity as unknown as IdentityService, provider as unknown as AgentIsHereDraftProvider)
  return { store, service, identity, provider }
}

function pending() {
  let resolve!: (value: unknown) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<unknown>((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}

afterEach(() => { vi.useRealTimers() })

describe('AI draft reservation boundary with repository and provider substitutes', () => {
  it('holds no transaction during the provider wait and records only successful minimal data', async () => {
    const f = setup(), response = pending()
    f.provider.generate.mockImplementation(() => response.promise)
    const call = f.service.create(idea)
    await vi.waitFor(() => expect(f.provider.generate).toHaveBeenCalledOnce())
    expect(f.store.activeTransactions).toBe(0)
    expect(f.store.usages).toHaveLength(0)
    expect([...f.store.reservations.values()][0]).toEqual({ memberId: 'member', reservationId: expect.any(String), createdAt: expect.any(Date), expiresAt: expect.any(Date) })
    response.resolve(draft)
    expect((await call).remainingToday).toBe(4)
    expect(f.store.usages).toEqual([{ id: expect.any(String), memberId: 'member', createdAt: expect.any(Date) }])
    expect(f.store.reservations.size).toBe(0)
  })

  it('allows five successes and rejects the sixth without a provider call', async () => {
    const f = setup()
    const results = []
    for (let n = 0; n < 5; n++) results.push(await f.service.create(idea))
    expect(results.map(value => value.remainingToday)).toEqual([4, 3, 2, 1, 0])
    await expect(f.service.create(idea)).rejects.toMatchObject({ response: { code: 'AI_DAILY_LIMIT' } })
    expect(f.provider.generate).toHaveBeenCalledTimes(5)
    expect(f.store.usages).toHaveLength(5)
  })

  it('rejects another service instance for the same member and preserves the last daily slot', async () => {
    const f = setup(), other = setup(f.store), response = pending()
    for (let n = 0; n < 4; n++) await f.service.create(idea)
    f.provider.generate.mockImplementation(() => response.promise)
    const call = f.service.create(idea)
    await vi.waitFor(() => expect(f.provider.generate).toHaveBeenCalledTimes(5))
    await expect(other.service.create(idea)).rejects.toMatchObject({ response: { code: 'AI_GENERATION_IN_PROGRESS' } })
    expect(other.provider.generate).not.toHaveBeenCalled()
    response.resolve(draft)
    expect((await call).remainingToday).toBe(0)
    await expect(other.service.create(idea)).rejects.toMatchObject({ response: { code: 'AI_DAILY_LIMIT' } })
    expect(f.store.usages).toHaveLength(5)
  })

  it('releases provider failures and invalid responses without charging success', async () => {
    const f = setup()
    f.provider.generate.mockRejectedValueOnce(new Error('provider failed')).mockResolvedValueOnce({})
    await expect(f.service.create(idea)).rejects.toThrow('provider failed')
    expect(f.store.reservations.size).toBe(0)
    await expect(f.service.create(idea)).rejects.toMatchObject({ response: { code: 'AI_GENERATION_FAILED' } })
    expect(f.store.reservations.size).toBe(0)
    expect(f.store.usages).toHaveLength(0)
    expect((await f.service.create(idea)).remainingToday).toBe(4)
  })

  it('recovers after a failed cleanup expires without hiding the original provider error', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-09-30T01:00:00Z'))
    const f = setup()
    f.store.failCleanup = true
    f.provider.generate.mockRejectedValueOnce(new Error('original failure'))
    await expect(f.service.create(idea)).rejects.toThrow('original failure')
    expect(f.store.reservations.size).toBe(1)
    await expect(f.service.create(idea)).rejects.toMatchObject({ response: { code: 'AI_GENERATION_IN_PROGRESS' } })
    vi.setSystemTime(new Date('2026-09-30T01:02:00Z'))
    expect((await f.service.create(idea)).remainingToday).toBe(4)
    expect(f.store.reservations.size).toBe(0)
  })

  it('discards expired results and cannot release a newer reservation', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-09-30T01:00:00Z'))
    const f = setup(), other = setup(f.store), first = pending(), second = pending()
    f.provider.generate.mockImplementation(() => first.promise)
    other.provider.generate.mockImplementation(() => second.promise)
    const firstCall = f.service.create(idea)
    const rejected = expect(firstCall).rejects.toMatchObject({ response: { code: 'AI_GENERATION_EXPIRED' } })
    await vi.waitFor(() => expect(f.provider.generate).toHaveBeenCalledOnce())
    vi.setSystemTime(f.store.reservations.get('member')!.expiresAt)
    const secondCall = other.service.create(idea)
    await vi.waitFor(() => expect(other.provider.generate).toHaveBeenCalledOnce())
    const token = f.store.reservations.get('member')!.reservationId
    first.resolve(draft)
    await rejected
    expect(f.store.usages).toHaveLength(0)
    expect(f.store.reservations.get('member')!.reservationId).toBe(token)
    second.resolve(draft)
    expect((await secondCall).remainingToday).toBe(4)
    expect(f.store.usages).toHaveLength(1)
  })

  it('does not count an expired result even when no replacement has started', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-09-30T01:00:00Z'))
    const f = setup(), response = pending()
    f.provider.generate.mockImplementation(() => response.promise)
    const call = f.service.create(idea)
    const rejected = expect(call).rejects.toMatchObject({ response: { code: 'AI_GENERATION_EXPIRED' } })
    await vi.waitFor(() => expect(f.provider.generate).toHaveBeenCalledOnce())
    vi.setSystemTime(f.store.reservations.get('member')!.expiresAt)
    response.resolve(draft)
    await rejected
    expect(f.store.usages).toHaveLength(0)
    expect(f.store.reservations.size).toBe(0)
  })

  it('charges the successful completion day when generation crosses Beijing midnight', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-09-30T15:59:30Z'))
    const f = setup(), response = pending()
    for (let n = 0; n < 4; n++) await f.service.create(idea)
    f.provider.generate.mockImplementationOnce(() => response.promise)
    const call = f.service.create(idea)
    await vi.waitFor(() => expect(f.provider.generate).toHaveBeenCalledTimes(5))
    vi.setSystemTime(new Date('2026-09-30T16:00:10Z'))
    response.resolve(draft)
    expect((await call).remainingToday).toBe(4)
    expect(f.store.usages[4].createdAt.toISOString()).toBe('2026-09-30T16:00:10.000Z')
    for (let n = 0; n < 4; n++) await f.service.create(idea)
    await expect(f.service.create(idea)).rejects.toMatchObject({ response: { code: 'AI_DAILY_LIMIT' } })
  })

  it('rejects incomplete profiles before provider or reservation access and rechecks after locking', async () => {
    const f = setup()
    f.identity.require.mockResolvedValueOnce({ ...completeMember('member'), avatarSetByUser: false })
    await expect(f.service.create(idea)).rejects.toMatchObject({ response: { code: 'PROFILE_INCOMPLETE' } })
    f.identity.require.mockResolvedValueOnce(completeMember('member'))
    f.store.memberRows.set('member', { ...completeMember('member'), nameSetByUser: false })
    await expect(f.service.create(idea)).rejects.toMatchObject({ response: { code: 'PROFILE_INCOMPLETE' } })
    expect(f.provider.generate).not.toHaveBeenCalled()
    expect(f.store.reservations.size).toBe(0)
  })

  it('bounds process concurrency at four without queueing and frees slots after failure', async () => {
    const f = setup(), response = pending()
    for (let n = 0; n < 5; n++) f.store.memberRows.set(`member-${n}`, completeMember(`member-${n}`))
    f.provider.generate.mockImplementation(() => response.promise)
    const calls = Array.from({ length: 4 }, (_, n) => f.service.create(idea, `member-${n}`))
    const finished = Promise.allSettled(calls)
    await vi.waitFor(() => expect(f.provider.generate).toHaveBeenCalledTimes(4))
    expect(f.store.activeTransactions).toBe(0)
    await expect(f.service.create(idea, 'member-4')).rejects.toMatchObject({ response: { code: 'AI_BUSY' } })
    expect(f.store.reservations.has('member-4')).toBe(false)
    response.reject(new Error('provider failed'))
    expect((await finished).every(result => result.status === 'rejected')).toBe(true)
    f.provider.generate.mockResolvedValue(draft)
    expect((await f.service.create(idea, 'member-4')).remainingToday).toBe(4)
  })
})
