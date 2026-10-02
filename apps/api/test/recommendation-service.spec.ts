import 'reflect-metadata'
import { randomUUID } from 'node:crypto'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { fail } from '../src/common/errors.js'
import { recommendationSearches } from '../src/database/schema/recommendations.js'
import { IdentityService } from '../src/flow/identity.js'
import { ReadingService } from '../src/flow/reading.js'
import { RecommendationCandidatesService, type RecommendationCandidate } from '../src/flow/recommendation-candidates.js'
import { RecommendationProvider } from '../src/recommendations/provider.js'
import { RecommendationRecordsService } from '../src/recommendations/records.js'
import { ActivitySearchService, orderWithLocalHints } from '../src/recommendations/service.js'
import type { ParsedSearch, RankedCandidate } from '../src/recommendations/types.js'
import { recommendationRepository } from './recommendation-repository.js'

const parsed: ParsedSearch = { hard: {}, preferences: [], summary: '可报名活动', clarify: null }
const candidate = (): RecommendationCandidate => ({ id: randomUUID(), title: '产业园交流会', description: '介绍产业园运营经验', location: '深圳产业园',
  startsAt: '2027-10-20T06:00:00.000Z', endsAt: '2027-10-20T08:00:00.000Z', feeType: 'free', feeAmountCents: null, coverUrl: '/public-cover' })
function fixture(length = 7) {
  const store = recommendationRepository(['member', 'other', 'third', 'fourth', 'fifth'])
  const records = new RecommendationRecordsService(store.database)
  const inventory = Array.from({ length }, candidate)
  const visible = new Map(inventory.map(item => [item.id, item]))
  const identity = { require: vi.fn(async (header = 'member') => ({ id: header, boundPhone: null })),
    recommendationProfile: vi.fn(async () => ({ resources: '私人资源字样', needs: '私人需求字样', hometown: '私人家乡字样', bio: '私人简介字样' })) }
  const candidates = { find: vi.fn(async () => inventory), available: vi.fn(async (_member: string, ids: string[]) => ids.flatMap(id => visible.has(id) ? [visible.get(id)!] : [])),
    registrationHistory: vi.fn(async () => [{ title: '私人报名历史字样', location: '历史活动地点' }]) }
  const reading = { recommendationHistory: vi.fn(async () => [{ title: '私人浏览历史字样', location: '浏览活动地点' }]) }
  const provider = { parse: vi.fn(async () => { expect(store.activeTransactions).toBe(0); return parsed }),
    rank: vi.fn(async (_messages: string[], _parsed: ParsedSearch, entries: RecommendationCandidate[]): Promise<RankedCandidate[]> => {
      expect(store.activeTransactions).toBe(0)
      return entries.map(item => ({ id: item.id, reason: '活动公开信息介绍产业园运营经验', preferenceDifferences: [] }))
    }) }
  const service = new ActivitySearchService(identity as unknown as IdentityService, records, candidates as unknown as RecommendationCandidatesService,
    reading as unknown as ReadingService, provider as unknown as RecommendationProvider)
  return { service, store, records, inventory, visible, identity, candidates, reading, provider }
}
const input = () => ({ requestId: randomUUID(), messages: ['找个产业园活动'] })
afterEach(() => { vi.useRealTimers() })

describe('recommendation orchestration without database or real provider', () => {
  it('allows an incomplete member and keeps profile/history out of provider arguments and result reasons', async () => {
    const f = fixture()
    const request = input(), result = await f.service.create(request)
    expect(result.items).toHaveLength(3)
    expect(result.remainingToday).toBe(9)
    expect(f.provider.parse).toHaveBeenCalledWith(request.messages)
    expect(f.identity.recommendationProfile).toHaveBeenCalledWith('member')
    expect(f.reading.recommendationHistory).toHaveBeenCalledWith('member')
    expect(f.candidates.registrationHistory).toHaveBeenCalledWith('member')
    expect(JSON.stringify(f.provider.rank.mock.calls)).not.toContain('私人')
    expect(JSON.stringify(result)).not.toMatch(/私人|boundPhone|description|fingerprint|inputHash|cursorSecret/)
  })
  it('paginates at most three and skips removed, enrolled or changed public fields without another model call or charge', async () => {
    const f = fixture(), first = await f.service.create(input())
    expect(first.items.map(item => item.id)).toEqual(f.inventory.slice(0, 3).map(item => item.id))
    f.visible.delete(f.inventory[3].id)
    f.visible.set(f.inventory[4].id, { ...f.inventory[4], feeType: 'paid', feeAmountCents: 100 })
    const next = await f.service.page(first.searchId!, first.cursor!)
    expect(next.items.map(item => item.id)).toEqual(f.inventory.slice(5).map(item => item.id))
    expect(next.hasMore).toBe(false)
    expect(next.cursor).toBeNull()
    expect(await f.service.page(first.searchId!, first.cursor!)).toEqual(next)
    expect(next.remainingToday).toBe(9)
    expect(f.provider.parse).toHaveBeenCalledTimes(1)
    expect(f.provider.rank).toHaveBeenCalledTimes(1)
  })
  it('rejects a public-field change during ranking before saving a result', async () => {
    const f = fixture(1)
    f.provider.rank.mockImplementation(async () => {
      f.visible.set(f.inventory[0].id, { ...f.inventory[0], description: '活动已改成其他主题' })
      return [{ id: f.inventory[0].id, reason: '旧主题理由', preferenceDifferences: [] }]
    })
    const result = await f.service.create(input())
    expect(result.items).toEqual([])
    expect(result.remainingToday).toBe(9)
    expect(f.store.rows(recommendationSearches)[0].payload).toMatchObject({ results: [] })
  })
  it('replays a completed request after its response failed without invoking either model stage again', async () => {
    const f = fixture(1), request = input()
    const delivered = vi.spyOn(f.records, 'delivered').mockRejectedValueOnce(new Error('response unavailable'))
    await expect(f.service.create(request)).rejects.toThrow('response unavailable')
    expect(await f.records.remaining('member')).toBe(9)
    delivered.mockRestore()
    const result = await f.service.create(request)
    expect(result.items).toHaveLength(1)
    expect(result.remainingToday).toBe(9)
    expect(f.provider.parse).toHaveBeenCalledTimes(1)
    expect(f.provider.rank).toHaveBeenCalledTimes(1)
  })
  it('counts a legitimate no-match response while bypassing ranking for an empty candidate set', async () => {
    const f = fixture(0), result = await f.service.create(input())
    expect(result).toMatchObject({ status: 'results', items: [], remainingToday: 9, hasMore: false })
    expect(f.provider.rank).not.toHaveBeenCalled()
  })
  it('distinguishes clarification and candidate budget from no matches without charging success', async () => {
    const f = fixture(61)
    const broad = await f.service.create(input())
    expect(broad).toMatchObject({ status: 'clarify', items: [], remainingToday: 10 })
    expect(broad.question).toContain('候选活动较多')
    expect(f.provider.rank).not.toHaveBeenCalled()
    f.provider.parse.mockResolvedValue({ ...parsed, clarify: '请确认地点' })
    expect(await f.service.create(input())).toMatchObject({ status: 'clarify', question: '请确认地点', remainingToday: 10 })
    expect(f.candidates.find).toHaveBeenCalledTimes(1)
    const largeText = fixture(1)
    largeText.inventory[0].description = '正'.repeat(61000)
    expect(await largeText.service.create(input())).toMatchObject({ status: 'clarify', remainingToday: 10 })
    expect(largeText.provider.rank).not.toHaveBeenCalled()
  })
  it('does not charge or retain a reservation on either provider-stage failure', async () => {
    const f = fixture(1)
    f.provider.parse.mockImplementationOnce(async () => fail('RECOMMENDATION_AI_TIMEOUT', 'hidden upstream', 504))
    await expect(f.service.create(input())).rejects.toMatchObject({ response: { code: 'SEARCH_TIMEOUT' } })
    f.provider.rank.mockImplementationOnce(async () => fail('RECOMMENDATION_AI_FAILED', 'hidden upstream', 502))
    await expect(f.service.create(input())).rejects.toMatchObject({ response: { code: 'SEARCH_GENERATION_FAILED' } })
    expect(await f.records.remaining('member')).toBe(10)
    expect((await f.service.create(input())).remainingToday).toBe(9)
  })
  it('requires authentication before reservation or provider and rejects oversized conversation before provider', async () => {
    const f = fixture()
    f.identity.require.mockRejectedValueOnce(new Error('login required'))
    await expect(f.service.create(input())).rejects.toThrow('login required')
    await expect(f.service.create({ requestId: randomUUID(), messages: Array(5).fill('长'.repeat(2000)) })).rejects.toMatchObject({ response: { code: 'SEARCH_INPUT_TOO_LONG' } })
    expect(f.provider.parse).not.toHaveBeenCalled()
    expect(f.store.rows(recommendationSearches)).toEqual([])
  })
  it('limits process-wide concurrency while no database transaction is held during provider waits', async () => {
    const f = fixture(0)
    const resolve: ((value: ParsedSearch) => void)[] = []
    f.provider.parse.mockImplementation(() => new Promise<ParsedSearch>(yes => { resolve.push(yes) }))
    const calls = ['member', 'other', 'third', 'fourth'].map(member => f.service.create(input(), member))
    await vi.waitFor(() => expect(f.provider.parse).toHaveBeenCalledTimes(4))
    expect(f.store.activeTransactions).toBe(0)
    await expect(f.service.create(input(), 'fifth')).rejects.toMatchObject({ response: { code: 'SEARCH_BUSY' } })
    resolve.forEach(complete => complete(parsed))
    await Promise.all(calls)
  })
  it('keeps explicit preference satisfaction ahead of strong private-profile overlap', () => {
    const preferred = candidate(), profileMatch = { ...candidate(), title: '私人资源字样' }
    const ranked = [{ id: preferred.id, reason: '公开', preferenceDifferences: [] },
      { id: profileMatch.id, reason: '公开', preferenceDifferences: ['未满足免费偏好'] }]
    expect(orderWithLocalHints(ranked, [preferred, profileMatch], ['私人资源字样'])[0].id).toBe(preferred.id)
    expect(JSON.stringify(orderWithLocalHints(ranked, [preferred, profileMatch], ['私人资源字样']))).not.toContain('私人资源字样')
  })
})
