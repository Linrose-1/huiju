import { Injectable } from '@nestjs/common'
import { createHash } from 'node:crypto'
import { IdentityService } from '../flow/identity.js'
import { ReadingService } from '../flow/reading.js'
import { RecommendationCandidatesService, type RecommendationCandidate } from '../flow/recommendation-candidates.js'
import { fail } from '../common/errors.js'
import { RecommendationProvider } from './provider.js'
import { MAX_RECOMMENDATION_CANDIDATES, matchesHardConditions, publicCandidatePayload } from './matching.js'
import { RecommendationRecordsService, searchCursor, searchOffset } from './records.js'
import { ActivitySearchInput, ActivitySearchResultDto } from './dto.js'
import type { RankedCandidate } from './types.js'

export function candidateFingerprint(item: RecommendationCandidate) {
  return createHash('sha256').update(JSON.stringify([item.title, item.description, item.location, item.startsAt, item.endsAt, item.feeType, item.feeAmountCents])).digest('hex')
}

function localTerms(values: (string | null)[]) {
  const text = values.filter(Boolean).join(' ').slice(0, 20000).toLowerCase()
  return [...new Set(text.match(/[a-z0-9]{2,}|[\u4e00-\u9fff]{2}/g) ?? [])].slice(0, 200)
}
export function orderWithLocalHints(ranked: RankedCandidate[], candidates: RecommendationCandidate[], hints: (string | null)[]) {
  const terms = localTerms(hints), byId = new Map(candidates.map(item => [item.id, item]))
  const score = (id: string) => {
    const item = byId.get(id)
    if (!item) return 0
    const text = `${item.title} ${item.description} ${item.location}`.toLowerCase()
    return terms.filter(term => text.includes(term)).length
  }
  // Explicit preference satisfaction wins; private hints only break ties within that tier.
  return ranked.map((item, index) => ({ item, index, score: score(item.id) }))
    .sort((a, b) => a.item.preferenceDifferences.length - b.item.preferenceDifferences.length || b.score - a.score || a.index - b.index)
    .map(({ item }) => item)
}

@Injectable()
export class ActivitySearchService {
  private active = 0
  constructor(private readonly identity: IdentityService, private readonly records: RecommendationRecordsService,
    private readonly candidates: RecommendationCandidatesService, private readonly reading: ReadingService,
    private readonly provider: RecommendationProvider) {}

  async create(input: ActivitySearchInput, header?: string): Promise<ActivitySearchResultDto> {
    const member = (await this.identity.require(header))!
    if (input.messages.reduce((total, message) => total + message.length, 0) > 8000) fail('SEARCH_INPUT_TOO_LONG', '本次对话较长，请精简至 8000 字以内', 400)
    if (this.active >= 4) fail('SEARCH_BUSY', '当前检索较多，请稍后手动重试', 429)
    this.active++
    let reservation: Awaited<ReturnType<RecommendationRecordsService['reserve']>> | undefined
    try {
      reservation = await this.records.reserve(member.id, input.requestId.toLowerCase(), input.messages)
      if (!reservation.reservationId) return this.pageFor(reservation.search.id, undefined, member.id)
      const parsed = await this.provider.parse(input.messages)
      const conditions = [parsed.summary]
      let question = parsed.clarify
      let ranked: RankedCandidate[] = []
      const fingerprints = new Map<string, string>()
      if (!question) {
        const candidates = await this.candidates.find(member.id, parsed, MAX_RECOMMENDATION_CANDIDATES + 1)
        try { publicCandidatePayload(candidates) } catch (error) {
          if (!(error && typeof error === 'object' && 'getResponse' in error && typeof error.getResponse === 'function'
            && (error.getResponse() as { code?: string }).code === 'RECOMMENDATION_TOO_BROAD')) throw error
          question = '候选活动较多，请补充时间、地点或主题条件，以便完整筛选。'
        }
        if (!question && candidates.length) {
          const eligible = candidates.filter(item => matchesHardConditions(item, parsed))
          for (const item of eligible) fingerprints.set(item.id, candidateFingerprint(item))
          const [profile, reads, registrations] = await Promise.all([
            this.identity.recommendationProfile(member.id), this.reading.recommendationHistory(member.id), this.candidates.registrationHistory(member.id),
          ])
          // Only messages, explicit parsed conditions and public activities cross this boundary.
          const providerResults = eligible.length ? await this.provider.rank(input.messages, parsed, eligible) : []
          const refreshed = await this.candidates.available(member.id, providerResults.map(item => item.id))
          const refreshedIds = new Set(refreshed.filter(item => matchesHardConditions(item, parsed) && candidateFingerprint(item) === fingerprints.get(item.id)).map(item => item.id))
          ranked = orderWithLocalHints(providerResults.filter(item => refreshedIds.has(item.id)), eligible,
            [...Object.values(profile), ...reads.flatMap(item => [item.title, item.location]), ...registrations.flatMap(item => [item.title, item.location])])
        }
      }
      await this.records.finish(reservation.search, reservation.reservationId, question ? 'clarify' : 'results', {
        conditions, question, results: ranked.map(item => ({ id: item.id, reason: item.reason, differences: item.preferenceDifferences, fingerprint: fingerprints.get(item.id)! })), deliveredIds: [],
      })
      return await this.pageFor(reservation.search.id, undefined, member.id)
    } catch (error) {
      if (reservation?.reservationId) {
        try { await this.records.release(reservation.search, reservation.reservationId) } catch { /* Expiring leases fence off abandoned requests. */ }
      }
      if (error && typeof error === 'object' && 'getResponse' in error && typeof error.getResponse === 'function') {
        const code = (error.getResponse() as { code?: string }).code
        if (code === 'RECOMMENDATION_AI_TIMEOUT') fail('SEARCH_TIMEOUT', '智能匹配超时，请手动重试或浏览全部活动', 504)
        if (code === 'RECOMMENDATION_AI_FAILED') fail('SEARCH_GENERATION_FAILED', '暂时无法智能匹配，请手动重试或浏览全部活动', 502)
      }
      throw error
    } finally { this.active-- }
  }

  async page(id: string, cursor: string | undefined, header?: string) {
    const member = (await this.identity.require(header))!
    return this.pageFor(id.toLowerCase(), cursor, member.id)
  }
  private async pageFor(id: string, cursor: string | undefined, memberId: string): Promise<ActivitySearchResultDto> {
    const row = await this.records.read(id, memberId)
    const offset = searchOffset(row, cursor)
    const ordered = row.payload.results
    const fingerprints = new Map(ordered.map(item => [item.id, item.fingerprint]))
    const available = new Map((await this.candidates.available(memberId, ordered.slice(offset).map(item => item.id)))
      .filter(item => candidateFingerprint(item) === fingerprints.get(item.id)).map(item => [item.id, item]))
    const items: ActivitySearchResultDto['items'] = []
    let scanned = offset
    while (scanned < ordered.length && items.length < 3) {
      const result = ordered[scanned++]!, activity = available.get(result.id)
      if (activity) items.push({ id: activity.id, title: activity.title, location: activity.location, startsAt: activity.startsAt, endsAt: activity.endsAt,
        coverUrl: activity.coverUrl, feeType: activity.feeType, feeAmountCents: activity.feeAmountCents, reason: result.reason, differences: result.differences })
    }
    const hasMore = ordered.slice(scanned).some(item => available.has(item.id))
    await this.records.delivered(id, memberId, items.map(item => item.id))
    return { status: row.status, searchId: row.id, conditions: row.payload.conditions, question: row.payload.question,
      items, cursor: hasMore ? searchCursor(row, scanned) : null, hasMore, remainingToday: await this.records.remaining(memberId), expiresAt: row.expiresAt.toISOString() }
  }
  async impressions(id: string, activityIds: string[], header?: string) {
    const member = (await this.identity.require(header))!
    return this.records.impressions(id.toLowerCase(), member.id, activityIds.map(value => value.toLowerCase()))
  }
  async view(id: string, activityId: string, header?: string) {
    const member = (await this.identity.require(header))!
    const normalized = activityId.toLowerCase()
    await this.records.read(id.toLowerCase(), member.id)
    if (!(await this.candidates.available(member.id, [normalized])).length) return { sourceToken: null }
    return this.records.view(id.toLowerCase(), member.id, normalized)
  }
}
