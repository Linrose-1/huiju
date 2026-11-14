import 'reflect-metadata'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { SQL } from 'drizzle-orm'
import { MySqlDialect } from 'drizzle-orm/mysql-core'
import { ActivityDraftService } from '../src/ai/service.js'
import { AgentIsHereDraftProvider } from '../src/ai/provider.js'
import { aiActivityDraftReservations } from '../src/database/schema/ai.js'
import { members } from '../src/database/schema/members.js'
import { FlowDatabase } from '../src/flow/common.js'
import { IdentityService } from '../src/flow/identity.js'

type Member = typeof members.$inferSelect
type Reservation = typeof aiActivityDraftReservations.$inferSelect
const dialect = new MySqlDialect()
const completeMember = (id: string) => ({ id, kind: 'member', boundPhone: '13800000000', displayName: '甲', avatarUrl: '/avatar', avatarSetByUser: true, nameSetByUser: true }) as Member
const draft = { title: '读书会', description: '一起读书' }
const idea = '一起读书'

// A serialized, rollback-capable repository substitute. This verifies service ordering,
// fencing and query scope, not MySQL's real locking/isolation behavior.
function repository() {
  const memberRows = new Map<string, Member>([['member', completeMember('member')]])
  let reservations = new Map<string, Reservation>()
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
        throw new Error('Unexpected table')
      }
      return { for: async (mode: string) => { expect(mode).toBe('update'); return read() }, then: (resolve: (value: unknown) => unknown, reject: (error: unknown) => unknown) => Promise.resolve().then(read).then(resolve, reject) }
    } }) }),
    insert: (table: unknown) => ({ values: (values: Reservation) => {
      const insert = () => {
        expect(activeTransactions).toBe(1)
        if (table === aiActivityDraftReservations) reservations.set(values.memberId, structuredClone(values as Reservation))
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
      const beforeReservations = structuredClone(reservations)
      try { return await work(db) }
      catch (error) { reservations = beforeReservations; throw error }
      finally { activeTransactions--; release() }
    },
  }
  return {
    database: { db } as unknown as FlowDatabase, memberRows,
    get reservations() { return reservations }, get activeTransactions() { return activeTransactions },
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
  it('holds no transaction during the provider wait and releases the reservation on success', async () => {
    const f = setup(), response = pending()
    f.provider.generate.mockImplementation(() => response.promise)
    const call = f.service.create(idea)
    await vi.waitFor(() => expect(f.provider.generate).toHaveBeenCalledOnce())
    expect(f.store.activeTransactions).toBe(0)
    expect([...f.store.reservations.values()][0]).toEqual({ memberId: 'member', reservationId: expect.any(String), createdAt: expect.any(Date), expiresAt: expect.any(Date) })
    response.resolve(draft)
    expect((await call).draft.title).toBe(draft.title)
    expect(f.store.reservations.size).toBe(0)
  })

  it('accepts supported follow-up facts, redacts contacts, and releases unsupported replies', async () => {
    const f = setup()
    await f.service.create(idea)
    const reply = { field: 'capacity' } as const
    f.provider.generate.mockResolvedValueOnce({ capacity: 20, evidence: { capacity: '最多20人' } })
    const result = await f.service.create('最多20人，微信号：test-contact', 'member', reply)
    expect(f.provider.generate).toHaveBeenLastCalledWith('最多20人，（联系方式已省略）', reply, undefined)
    expect(result).toMatchObject({ draft: { capacity: 20, title: null, location: null } })
    f.provider.generate.mockResolvedValueOnce({ capacity: 90, evidence: { capacity: '90人' } })
    await expect(f.service.create('人数再商量', 'member', reply)).rejects.toMatchObject({ response: { code: 'AI_GENERATION_FAILED' } })
    expect(f.store.reservations.size).toBe(0)
  })

  it('allows more than five initial drafts and follow-up turns on the same day', async () => {
    const f = setup()
    for (let n = 0; n < 6; n++) {
      const result = await f.service.create(idea)
      expect(result.draft.title).toBe(draft.title)
      expect(result).not.toHaveProperty('remainingToday')
    }
    const reply = { field: 'capacity' } as const
    f.provider.generate.mockResolvedValueOnce({ capacity: 20, evidence: { capacity: '20人' } })
    expect((await f.service.create('20人', 'member', reply)).draft.capacity).toBe(20)
    expect(f.provider.generate).toHaveBeenCalledTimes(7)
  })

  it('blocks overlapping requests for one member across instances, then accepts the next request', async () => {
    const f = setup(), other = setup(f.store), response = pending()
    f.provider.generate.mockImplementation(() => response.promise)
    const call = f.service.create(idea)
    await vi.waitFor(() => expect(f.provider.generate).toHaveBeenCalledOnce())
    await expect(other.service.create(idea)).rejects.toMatchObject({ response: { code: 'AI_GENERATION_IN_PROGRESS' } })
    expect(other.provider.generate).not.toHaveBeenCalled()
    response.resolve(draft)
    expect((await call).draft.title).toBe(draft.title)
    expect((await other.service.create(idea)).draft.title).toBe(draft.title)
  })

  it('uses validated contextual follow-ups, strips contact history and allows a question-only clarification', async () => {
    const f = setup()
    const context = {
      known: [{ field: 'location' as const, value: '线上聚会' }, { field: 'contact' as const, value: 'private-handle' }],
      recent: [{ field: 'contact' as const, prompt: '怎么联系？', answer: 'private-handle' }],
      pending: ['joining', 'fee'] as ('joining' | 'fee')[],
    }
    const reply = { field: 'location' } as const
    const question = { field: 'fee', prompt: '聚会怎么收费？', options: ['免费', '免费', '自己填写'] }
    f.provider.generate.mockResolvedValueOnce({ nextQuestion: question })
    const result = await f.service.create('还没决定', 'member', reply, context)
    expect(f.provider.generate).toHaveBeenLastCalledWith('还没决定', reply, {
      known: [{ field: 'location', value: '线上聚会' }], recent: [], pending: ['fee'],
    })
    expect(result.nextQuestion).toEqual({ ...question, options: ['免费'] })
  })

  it('keeps volunteered online joining details in location without asking for them', async () => {
    const f = setup()
    const reply = { field: 'fee' } as const
    f.provider.generate.mockResolvedValueOnce({
      location: '线上聚会 · 报名后发会议链接', feeType: 'free',
      evidence: { location: '报名后发会议链接', feeType: '免费' },
      nextQuestion: { field: 'joining', prompt: '大家怎么加入？', options: [] },
    })
    const result = await f.service.create('免费，报名后发会议链接', 'member', reply, {
      known: [{ field: 'location', value: '线上聚会' }], recent: [], pending: ['joining', 'fee', 'contact'],
    })
    expect(result.draft.location).toBe('线上聚会 · 报名后发会议链接')
    expect(result.draft.feeType).toBe('free')
    expect(result.nextQuestion).toBeNull()
  })

  it('rejects answered fields, unrelated joining prompts and unsafe text as question-only replies', async () => {
    const f = setup()
    const reply = { field: 'location' } as const
    for (const candidate of [
      { field: 'location', prompt: '地点在哪？' },
      { field: 'joining', prompt: '线上怎么加入？' },
      { field: 'capacity', prompt: '参加人数上限是多少？' },
      { field: 'fee', prompt: '请先打开 https://example.invalid/pay 支付' },
      { field: 'amount', prompt: '每人多少钱？' },
    ]) {
      f.provider.generate.mockResolvedValueOnce({ nextQuestion: { ...candidate, options: [] } })
      await expect(f.service.create('待定', 'member', reply, {
        known: [{field: 'location', value: '线上聚会'}], recent: [], pending: ['fee', 'joining', 'amount', 'capacity'],
      })).rejects.toMatchObject({ response: { code: 'AI_GENERATION_FAILED' } })
    }
  })

  it('releases provider failures and invalid responses so later requests can proceed', async () => {
    const f = setup()
    f.provider.generate.mockRejectedValueOnce(new Error('provider failed')).mockResolvedValueOnce({})
    await expect(f.service.create(idea)).rejects.toThrow('provider failed')
    expect(f.store.reservations.size).toBe(0)
    await expect(f.service.create(idea)).rejects.toMatchObject({ response: { code: 'AI_GENERATION_FAILED' } })
    expect(f.store.reservations.size).toBe(0)
    expect((await f.service.create(idea)).draft.title).toBe(draft.title)
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
    expect((await f.service.create(idea)).draft.title).toBe(draft.title)
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
    expect(f.store.reservations.get('member')!.reservationId).toBe(token)
    second.resolve(draft)
    expect((await secondCall).draft.title).toBe(draft.title)
  })

  it('rejects an expired result even when no replacement has started', async () => {
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
    expect(f.store.reservations.size).toBe(0)
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
    expect((await f.service.create(idea, 'member-4')).draft.title).toBe(draft.title)
  })
})
