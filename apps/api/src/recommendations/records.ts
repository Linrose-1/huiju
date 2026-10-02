import { Injectable } from '@nestjs/common'
import { and, count, eq, gte, isNotNull, lt, lte } from 'drizzle-orm'
import { createHash, createHmac, randomBytes, randomUUID } from 'node:crypto'
import { FlowDatabase, fail } from '../flow/common.js'
import { members } from '../database/schema/members.js'
import { activities } from '../database/schema/activities.js'
import { recommendationConversions, recommendationEvents, recommendationReservations, recommendationSearches, type SearchPayload } from '../database/schema/recommendations.js'
import { beijingDayBounds } from '../ai/service.js'

export type RecommendationTx = Parameters<Parameters<FlowDatabase['db']['transaction']>[0]>[0]
export type SearchRow = typeof recommendationSearches.$inferSelect
export const SEARCH_RESULT_TTL_MS = 30 * 60 * 1000
export const SEARCH_RESERVATION_TTL_MS = 120000
const digest = (value: string) => createHash('sha256').update(value).digest('hex')
const signature = (row: SearchRow, value: string) => createHmac('sha256', row.cursorSecret).update(value).digest('base64url')

export function searchCursor(row: SearchRow, offset: number) {
  return Buffer.from(`${offset}:${signature(row, `page:${row.id}:${offset}`)}`).toString('base64url')
}
export function searchOffset(row: SearchRow, cursor?: string) {
  if (!cursor) return 0
  const decoded = Buffer.from(cursor, 'base64url').toString()
  const [value, supplied] = decoded.split(':')
  const offset = Number(value)
  if (!/^\d+$/.test(value) || !Number.isSafeInteger(offset) || offset > (row.payload?.results.length ?? 0)
    || supplied !== signature(row, `page:${row.id}:${offset}`) || searchCursor(row, offset) !== cursor) fail('SEARCH_CURSOR_INVALID', '推荐分页已失效，请返回已有结果', 400)
  return offset
}

@Injectable()
export class RecommendationRecordsService {
  constructor(private readonly database: FlowDatabase) {}

  private async lockMember(tx: RecommendationTx, memberId: string) {
    const [member] = await tx.select({ id: members.id, kind: members.kind }).from(members).where(eq(members.id, memberId)).for('update')
    if (!member || member.kind !== 'member') fail('SESSION_REQUIRED', '请先登录', 401)
  }
  private async used(tx: RecommendationTx | FlowDatabase['db'], memberId: string, now = new Date()) {
    const [from, to] = beijingDayBounds(now)
    const [usage] = await tx.select({ total: count() }).from(recommendationSearches).where(and(
      eq(recommendationSearches.memberId, memberId), eq(recommendationSearches.status, 'results'),
      gte(recommendationSearches.completedAt, from), lt(recommendationSearches.completedAt, to)))
    return Number(usage?.total ?? 0)
  }
  async remaining(memberId: string) { return Math.max(0, 10 - await this.used(this.database.db, memberId)) }

  async reserve(memberId: string, requestId: string, messages: string[]) {
    const inputHash = digest(JSON.stringify(messages))
    return this.database.db.transaction(async tx => {
      await this.lockMember(tx, memberId)
      const now = new Date()
      const [existing] = await tx.select().from(recommendationSearches).where(and(eq(recommendationSearches.memberId, memberId), eq(recommendationSearches.requestId, requestId))).for('update')
      if (existing) {
        if (existing.inputHash !== inputHash) fail('SEARCH_REQUEST_CONFLICT', '本次请求内容已变化，请重新发起检索', 409)
        if (existing.status === 'results' || existing.status === 'clarify') {
          this.available(existing, memberId)
          return { search: existing, reservationId: null }
        }
        if (existing.status === 'failed') fail('SEARCH_REQUEST_FAILED', '上次检索失败，请手动重新发起', 409)
        const [lease] = await tx.select().from(recommendationReservations).where(eq(recommendationReservations.memberId, memberId)).for('update')
        if (lease?.searchId === existing.id && lease.expiresAt > now) fail('SEARCH_IN_PROGRESS', '正在检索，请等待本次完成', 409)
        fail('SEARCH_GENERATION_EXPIRED', '上次检索已超时，请手动重新发起', 409)
      }
      const [lease] = await tx.select().from(recommendationReservations).where(eq(recommendationReservations.memberId, memberId)).for('update')
      if (lease && lease.expiresAt > now) fail('SEARCH_IN_PROGRESS', '正在检索，请等待本次完成', 409)
      if (await this.used(tx, memberId, now) >= 10) fail('SEARCH_DAILY_LIMIT', '今天的 10 次找活动机会已用完，请明天再试', 429)
      const [recent] = await tx.select({ total: count() }).from(recommendationSearches).where(and(eq(recommendationSearches.memberId, memberId), gte(recommendationSearches.createdAt, new Date(now.getTime() - 60000))))
      if (Number(recent?.total ?? 0) >= 6) fail('SEARCH_BUSY', '检索请求较频繁，请稍后手动重试', 429)
      const search: SearchRow = { id: randomUUID(), memberId, requestId, inputHash, status: 'pending', cursorSecret: randomBytes(32).toString('hex'),
        payload: null, createdAt: now, completedAt: null, expiresAt: new Date(now.getTime() + SEARCH_RESULT_TTL_MS) }
      const reservationId = randomUUID()
      await tx.insert(recommendationSearches).values(search)
      const values = { searchId: search.id, reservationId, createdAt: now, expiresAt: new Date(now.getTime() + SEARCH_RESERVATION_TTL_MS) }
      await tx.insert(recommendationReservations).values({ memberId, ...values }).onDuplicateKeyUpdate({ set: values })
      return { search, reservationId }
    })
  }

  async finish(search: SearchRow, reservationId: string, status: 'results' | 'clarify', payload: SearchPayload) {
    await this.database.db.transaction(async tx => {
      await this.lockMember(tx, search.memberId)
      const now = new Date()
      const [lease] = await tx.select().from(recommendationReservations).where(eq(recommendationReservations.memberId, search.memberId)).for('update')
      if (!lease || lease.searchId !== search.id || lease.reservationId !== reservationId || lease.expiresAt <= now) fail('SEARCH_GENERATION_EXPIRED', '本次检索已超时，请手动重试', 409)
      if (status === 'results' && await this.used(tx, search.memberId, now) >= 10) fail('SEARCH_DAILY_LIMIT', '今天的 10 次找活动机会已用完，请明天再试', 429)
      await tx.update(recommendationSearches).set({ status, payload, completedAt: now, expiresAt: new Date(now.getTime() + SEARCH_RESULT_TTL_MS) }).where(and(eq(recommendationSearches.id, search.id), eq(recommendationSearches.status, 'pending')))
      await tx.delete(recommendationReservations).where(and(eq(recommendationReservations.memberId, search.memberId), eq(recommendationReservations.reservationId, reservationId)))
    })
  }

  async release(search: SearchRow, reservationId: string) {
    await this.database.db.transaction(async tx => {
      await this.lockMember(tx, search.memberId)
      await tx.update(recommendationSearches).set({ status: 'failed' }).where(and(eq(recommendationSearches.id, search.id), eq(recommendationSearches.status, 'pending')))
      await tx.delete(recommendationReservations).where(and(eq(recommendationReservations.memberId, search.memberId), eq(recommendationReservations.reservationId, reservationId)))
    })
  }

  private available(row: SearchRow | undefined, memberId: string): asserts row is SearchRow & { payload: SearchPayload; status: 'results' | 'clarify' } {
    if (!row || row.memberId !== memberId) fail('SEARCH_NOT_FOUND', '推荐结果不存在', 404)
    if (row.expiresAt <= new Date() || !row.payload) fail('SEARCH_EXPIRED', '本次推荐已过期，可重新输入需求查找活动', 410)
    if (row.status !== 'results' && row.status !== 'clarify') fail('SEARCH_IN_PROGRESS', '推荐结果尚不可用', 409)
  }
  async read(id: string, memberId: string) {
    const [row] = await this.database.db.select().from(recommendationSearches).where(eq(recommendationSearches.id, id))
    this.available(row, memberId)
    return row
  }
  private async locked(tx: RecommendationTx, id: string, memberId: string) {
    const [row] = await tx.select().from(recommendationSearches).where(eq(recommendationSearches.id, id)).for('update')
    this.available(row, memberId)
    return row
  }
  async delivered(id: string, memberId: string, activityIds: string[]) {
    await this.database.db.transaction(async tx => {
      const row = await this.locked(tx, id, memberId)
      const known = new Set(row.payload.results.map(item => item.id))
      if (activityIds.some(activityId => !known.has(activityId))) fail('SEARCH_RESULT_INVALID', '推荐结果不匹配', 400)
      await tx.update(recommendationSearches).set({ payload: { ...row.payload, deliveredIds: [...new Set([...row.payload.deliveredIds, ...activityIds])] } }).where(eq(recommendationSearches.id, id))
    })
  }
  async impressions(id: string, memberId: string, activityIds: string[]) {
    await this.database.db.transaction(async tx => {
      await this.lockEventActivities(tx, activityIds)
      await this.lockMember(tx, memberId)
      const row = await this.locked(tx, id, memberId)
      if (activityIds.some(activityId => !row.payload.deliveredIds.includes(activityId))) fail('SEARCH_RESULT_INVALID', '只可确认已展示的推荐结果', 400)
      for (const activityId of activityIds) await tx.insert(recommendationEvents).values({ id: randomUUID(), searchId: id, activityId, memberId, kind: 'impression', expiresAt: row.expiresAt })
        .onDuplicateKeyUpdate({ set: { searchId: id } })
    })
    return { ok: true }
  }
  async view(id: string, memberId: string, activityId: string) {
    return this.database.db.transaction(async tx => {
      await this.lockEventActivities(tx, [activityId])
      await this.lockMember(tx, memberId)
      const row = await this.locked(tx, id, memberId)
      const [impression] = await tx.select().from(recommendationEvents).where(and(eq(recommendationEvents.searchId, id), eq(recommendationEvents.activityId, activityId), eq(recommendationEvents.memberId, memberId), eq(recommendationEvents.kind, 'impression')))
      if (!impression || !row.payload.deliveredIds.includes(activityId)) return { sourceToken: null }
      const sourceToken = signature(row, `view:${memberId}:${activityId}`)
      await tx.insert(recommendationEvents).values({ id: randomUUID(), searchId: id, activityId, memberId, kind: 'view', tokenHash: digest(sourceToken), expiresAt: row.expiresAt })
        .onDuplicateKeyUpdate({ set: { searchId: id } })
      return { sourceToken }
    })
  }

  private async lockEventActivities(tx: RecommendationTx, ids: string[]) {
    // Event foreign keys also lock activities. Match registration's activity -> member -> search -> event
    // ordering before taking search locks, including idempotent event retries.
    for (const id of [...new Set(ids)].sort()) await tx.select({ id: activities.id }).from(activities).where(eq(activities.id, id)).for('update')
  }

  // ActivityService owns the registration transaction; no recommendation access without a token.
  async conversion(tx: RecommendationTx, token: string | undefined, memberId: string, activityId: string, registrationOperationId: string) {
    if (!token || !/^[A-Za-z0-9_-]{43}$/.test(token)) return
    const [candidate] = await tx.select().from(recommendationEvents).where(eq(recommendationEvents.tokenHash, digest(token)))
    if (!candidate || candidate.kind !== 'view' || candidate.memberId !== memberId || candidate.activityId !== activityId) return
    await this.lockMember(tx, memberId)
    // Keep search -> event lock order consistent with impression/view writes and cleanup.
    const [search] = await tx.select().from(recommendationSearches).where(eq(recommendationSearches.id, candidate.searchId)).for('update')
    const [view] = await tx.select().from(recommendationEvents).where(eq(recommendationEvents.id, candidate.id)).for('update')
    const now = new Date()
    if (!search || search.memberId !== memberId || search.status !== 'results' || search.expiresAt <= now || !view || view.expiresAt <= now) return
    await tx.insert(recommendationConversions).values({ registrationOperationId, viewId: view.id, searchId: search.id, activityId, memberId })
  }

  // Explicit maintenance entry point only; no timer, startup hook or implicit writes on reads.
  async cleanup(now = new Date()) {
    const cutoff = new Date(now.getTime() - 90 * 86400000)
    // Independent autocommit steps avoid holding search locks while waiting for leases.
    // Each predicate is idempotent, so interrupted maintenance can safely be rerun.
    const db = this.database.db
    await db.update(recommendationSearches).set({ payload: null }).where(and(lte(recommendationSearches.expiresAt, now), isNotNull(recommendationSearches.payload)))
    await db.delete(recommendationReservations).where(lte(recommendationReservations.expiresAt, now))
    await db.delete(recommendationConversions).where(lt(recommendationConversions.createdAt, cutoff))
    await db.delete(recommendationEvents).where(lt(recommendationEvents.expiresAt, cutoff))
    await db.delete(recommendationSearches).where(lt(recommendationSearches.expiresAt, cutoff))
    return { ok: true }
  }
}
