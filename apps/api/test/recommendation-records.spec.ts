import 'reflect-metadata'
import { randomUUID } from 'node:crypto'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { recommendationConversions, recommendationEvents, recommendationReservations, recommendationSearches, type SearchPayload } from '../src/database/schema/recommendations.js'
import { RecommendationRecordsService, SEARCH_RESERVATION_TTL_MS, searchCursor, searchOffset, type RecommendationTx } from '../src/recommendations/records.js'
import { recommendationRepository } from './recommendation-repository.js'

const payload = (ids = ['activity']): SearchPayload => ({ conditions: ['公开条件'], question: null,
  results: ids.map(id => ({ id, reason: '公开活动内容', differences: [], fingerprint: 'public-hash' })), deliveredIds: [] })
function setup(store = recommendationRepository()) { return { store, service: new RecommendationRecordsService(store.database) } }
async function succeeded(f: ReturnType<typeof setup>, ids = ['activity']) {
  const lease = await f.service.reserve('member', randomUUID(), ['活动'])
  await f.service.finish(lease.search, lease.reservationId!, 'results', payload(ids))
  return { lease, search: await f.service.read(lease.search.id, 'member') }
}
afterEach(() => { vi.useRealTimers() })

describe('recommendation records with transactional repository substitute', () => {
  it('requires only member identity, preserves input hashes instead of messages and replays success once', async () => {
    const f = setup(), requestId = randomUUID(), messages = ['原始对话，不落库']
    const lease = await f.service.reserve('member', requestId, messages)
    expect(JSON.stringify(f.store.rows(recommendationSearches))).not.toContain(messages[0])
    await f.service.finish(lease.search, lease.reservationId!, 'results', payload([]))
    expect(await f.service.remaining('member')).toBe(9)
    const repeated = await f.service.reserve('member', requestId, messages)
    expect(repeated.reservationId).toBeNull()
    expect(repeated.search.id).toBe(lease.search.id)
    expect(await f.service.remaining('member')).toBe(9)
    await expect(f.service.reserve('member', requestId, ['改了内容'])).rejects.toMatchObject({ response: { code: 'SEARCH_REQUEST_CONFLICT' } })
  })
  it('enforces ten successful searches, including empty results, while clarify and failures do not count', async () => {
    vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date('2026-10-02T01:00:00Z'))
    const f = setup()
    const clarification = await f.service.reserve('member', randomUUID(), ['不清楚'])
    await f.service.finish(clarification.search, clarification.reservationId!, 'clarify', { ...payload([]), question: '请确认' })
    const failed = await f.service.reserve('member', randomUUID(), ['失败'])
    await f.service.release(failed.search, failed.reservationId!)
    expect(await f.service.remaining('member')).toBe(10)
    for (let n = 0; n < 10; n++) {
      vi.setSystemTime(new Date(Date.now() + 61000))
      await succeeded(f, [])
    }
    expect(await f.service.remaining('member')).toBe(0)
    await expect(f.service.reserve('member', randomUUID(), ['活动'])).rejects.toMatchObject({ response: { code: 'SEARCH_DAILY_LIMIT' } })
    await expect(f.service.reserve('member', failed.search.requestId, ['失败'])).rejects.toMatchObject({ response: { code: 'SEARCH_REQUEST_FAILED' } })
  })
  it('serializes different instances and fences expired completion and cleanup from a new lease', async () => {
    vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date('2026-10-02T01:00:00Z'))
    const f = setup(), other = setup(f.store)
    const first = await f.service.reserve('member', randomUUID(), ['第一轮'])
    await expect(other.service.reserve('member', randomUUID(), ['第二轮'])).rejects.toMatchObject({ response: { code: 'SEARCH_IN_PROGRESS' } })
    vi.setSystemTime(new Date(Date.now() + SEARCH_RESERVATION_TTL_MS))
    const second = await other.service.reserve('member', randomUUID(), ['第二轮'])
    await expect(f.service.finish(first.search, first.reservationId!, 'results', payload())).rejects.toMatchObject({ response: { code: 'SEARCH_GENERATION_EXPIRED' } })
    await f.service.release(first.search, first.reservationId!)
    expect(f.store.rows(recommendationReservations)[0].reservationId).toBe(second.reservationId)
    await other.service.finish(second.search, second.reservationId!, 'results', payload())
    expect(await f.service.remaining('member')).toBe(9)
  })
  it('counts completions on the Beijing completion day and rechecks its quota', async () => {
    vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date('2026-10-02T15:59:59Z'))
    const f = setup(), lease = await f.service.reserve('member', randomUUID(), ['跨日'])
    vi.setSystemTime(new Date('2026-10-02T16:00:01Z'))
    await f.service.finish(lease.search, lease.reservationId!, 'results', payload([]))
    expect(await f.service.remaining('member')).toBe(9)
    const next = await f.service.reserve('member', randomUUID(), ['再次'])
    for (let n = 0; n < 9; n++) f.store.rows(recommendationSearches).push({ ...lease.search, id: randomUUID(), requestId: randomUUID(), status: 'results', completedAt: new Date() })
    await expect(f.service.finish(next.search, next.reservationId!, 'results', payload([]))).rejects.toMatchObject({ response: { code: 'SEARCH_DAILY_LIMIT' } })
  })
  it('rate limits repeated uncharged clarifications across instances', async () => {
    const f = setup(), other = setup(f.store)
    for (let n = 0; n < 6; n++) {
      const lease = await f.service.reserve('member', randomUUID(), ['澄清'])
      await f.service.finish(lease.search, lease.reservationId!, 'clarify', { ...payload([]), question: '请确认' })
    }
    await expect(other.service.reserve('member', randomUUID(), ['澄清'])).rejects.toMatchObject({ response: { code: 'SEARCH_BUSY' } })
    expect(await f.service.remaining('member')).toBe(10)
  })
  it('rejects cross-member reads, forged cursors and expired idempotent replays without creating a search', async () => {
    vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date('2026-10-02T01:00:00Z'))
    const f = setup(), { search, lease } = await succeeded(f)
    await expect(f.service.read(search.id, 'other')).rejects.toMatchObject({ response: { code: 'SEARCH_NOT_FOUND' } })
    const cursor = searchCursor(search, 1)
    expect(searchOffset(search, cursor)).toBe(1)
    expect(() => searchOffset(search, Buffer.from('1:forged').toString('base64url'))).toThrow()
    vi.setSystemTime(search.expiresAt)
    await expect(f.service.reserve('member', lease.search.requestId, ['活动'])).rejects.toMatchObject({ response: { code: 'SEARCH_EXPIRED' } })
    expect(f.store.rows(recommendationSearches)).toHaveLength(1)
  })
  it('only attributes delivered, acknowledged impressions and returns a stable token on repeated direct view', async () => {
    const f = setup(), { search } = await succeeded(f)
    await expect(f.service.impressions(search.id, 'member', ['activity'])).rejects.toMatchObject({ response: { code: 'SEARCH_RESULT_INVALID' } })
    expect(await f.service.view(search.id, 'member', 'activity')).toEqual({ sourceToken: null })
    await f.service.delivered(search.id, 'member', ['activity'])
    f.store.locks.length = 0
    await f.service.impressions(search.id, 'member', ['activity'])
    expect(f.store.locks).toEqual(['activities', 'members', 'activity_recommendation_searches'])
    await f.service.impressions(search.id, 'member', ['activity'])
    const first = await f.service.view(search.id, 'member', 'activity')
    expect(first.sourceToken).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(await f.service.view(search.id, 'member', 'activity')).toEqual(first)
    expect(f.store.rows(recommendationEvents)).toHaveLength(2)
    const convert = (token: string | undefined, member = 'member', activity = 'activity', operation = randomUUID()) => f.store.database.db.transaction(tx => f.service.conversion(tx, token, member, activity, operation))
    await convert(undefined); await convert('forged'); await convert(first.sourceToken!, 'other'); await convert(first.sourceToken!, 'member', 'other')
    expect(f.store.rows(recommendationConversions)).toHaveLength(0)
    await convert(first.sourceToken!)
    expect(f.store.rows(recommendationConversions)).toHaveLength(1)
    await expect(f.store.database.db.transaction(async tx => {
      await f.service.conversion(tx, first.sourceToken!, 'member', 'activity', randomUUID())
      throw new Error('registration transaction rolled back')
    })).rejects.toThrow('rolled back')
    expect(f.store.rows(recommendationConversions)).toHaveLength(1)
  })
  it('ignores expired sources and never accesses recommendation storage for an absent token', async () => {
    const f = setup()
    const denied = { select: () => { throw new Error('must not query recommendation tables') } } as unknown as RecommendationTx
    await f.service.conversion(denied, undefined, 'member', 'activity', randomUUID())
    vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date('2026-10-02T01:00:00Z'))
    const { search } = await succeeded(f)
    await f.service.delivered(search.id, 'member', ['activity']); await f.service.impressions(search.id, 'member', ['activity'])
    const { sourceToken } = await f.service.view(search.id, 'member', 'activity')
    vi.setSystemTime(search.expiresAt)
    await f.store.database.db.transaction(tx => f.service.conversion(tx, sourceToken!, 'member', 'activity', randomUUID()))
    expect(f.store.rows(recommendationConversions)).toHaveLength(0)
  })
  it('clears expired private payloads without removing daily quota facts, and keeps younger effect events', async () => {
    vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date('2026-10-02T01:00:00Z'))
    const f = setup(), { search } = await succeeded(f)
    vi.setSystemTime(search.expiresAt)
    await f.service.cleanup()
    expect(f.store.rows(recommendationSearches)[0].payload).toBeNull()
    expect(await f.service.remaining('member')).toBe(9)
    const row = f.store.rows(recommendationSearches)[0]
    row.createdAt = new Date(Date.now() - 90 * 86400000 - 1000)
    row.expiresAt = new Date(Date.now() - 90 * 86400000 + 1000)
    await f.service.cleanup()
    expect(f.store.rows(recommendationSearches)).toHaveLength(1)
    vi.setSystemTime(new Date(Date.now() + 2000)); await f.service.cleanup()
    expect(f.store.rows(recommendationSearches)).toHaveLength(0)
  })
  it('commits cleanup steps independently and safely resumes after a partial failure', async () => {
    vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date('2026-10-02T01:00:00Z'))
    const f = setup(), { search } = await succeeded(f)
    vi.setSystemTime(search.expiresAt)
    const transaction = vi.spyOn(f.store.database.db, 'transaction')
    const deletion = vi.spyOn(f.store.database.db, 'delete').mockImplementationOnce(() => { throw new Error('maintenance interrupted') })
    await expect(f.service.cleanup()).rejects.toThrow('maintenance interrupted')
    expect(f.store.rows(recommendationSearches)[0].payload).toBeNull()
    expect(await f.service.remaining('member')).toBe(9)
    deletion.mockRestore()
    expect(await f.service.cleanup()).toEqual({ ok: true })
    expect(transaction).not.toHaveBeenCalled()
    expect(f.store.rows(recommendationSearches)).toHaveLength(1)
    expect(await f.service.remaining('member')).toBe(9)
  })
})
