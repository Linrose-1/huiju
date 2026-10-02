import { Injectable } from '@nestjs/common'
import { and, asc, desc, eq, gt, gte, inArray, ne, sql } from 'drizzle-orm'
import { FlowDatabase } from './common.js'
import { activities } from '../database/schema/activities.js'
import { registrations } from '../database/schema/registrations.js'
import type { ParsedSearch, PublicCandidate } from '../recommendations/types.js'

const projection = { id: activities.id, title: activities.title, description: activities.description, location: activities.location,
  startsAt: activities.startsAt, endsAt: activities.endsAt, feeType: activities.feeType, feeAmountCents: activities.feeAmountCents, coverUrl: activities.coverUrl }
export type RecommendationCandidate = PublicCandidate & { coverUrl: string | null }

@Injectable()
export class RecommendationCandidatesService {
  constructor(private readonly database: FlowDatabase) {}
  private eligible(memberId: string, now = new Date()) {
    return and(eq(activities.lifecycle, 'published'), eq(activities.moderation, 'normal'), ne(activities.organizerMemberId, memberId),
      gt(activities.startsAt, now), sql`(${activities.registrationDeadline} is null or ${activities.registrationDeadline} > ${now})`,
      sql`(${activities.capacity} is null or ${activities.activeRegistrationCount} < ${activities.capacity})`,
      sql`not exists (select 1 from ${registrations} where ${registrations.activityId} = ${activities.id} and ${registrations.memberId} = ${memberId} and ${registrations.status} = 'active')`)
  }
  async find(memberId: string, parsed: ParsedSearch, limit: number): Promise<RecommendationCandidate[]> {
    const { location, time, feeType, themes } = parsed.hard
    const rows = await this.database.db.select(projection).from(activities).where(and(this.eligible(memberId),
      location ? sql`instr(${activities.location}, ${location.value}) > 0` : undefined,
      time ? and(gte(activities.startsAt, new Date(time.from)), sql`${activities.startsAt} < ${new Date(time.to)}`) : undefined,
      feeType ? eq(activities.feeType, feeType.value) : undefined,
      ...(themes ?? []).map(theme => sql`(instr(${activities.title}, ${theme.value}) > 0 or instr(${activities.description}, ${theme.value}) > 0)`)))
      .orderBy(asc(activities.startsAt), asc(activities.id)).limit(limit)
    return rows.map(row => ({ ...row, startsAt: row.startsAt.toISOString(), endsAt: row.endsAt.toISOString() }))
  }
  async available(memberId: string, ids: string[]): Promise<RecommendationCandidate[]> {
    if (!ids.length) return []
    const rows = await this.database.db.select(projection).from(activities).where(and(this.eligible(memberId), inArray(activities.id, ids)))
    return rows.map(row => ({ ...row, startsAt: row.startsAt.toISOString(), endsAt: row.endsAt.toISOString() }))
  }
  async registrationHistory(memberId: string) {
    return this.database.db.select({ title: activities.title, location: activities.location }).from(registrations)
      .innerJoin(activities, eq(activities.id, registrations.activityId)).where(and(eq(registrations.memberId, memberId),
        gte(registrations.currentRegisteredAt, new Date(Date.now() - 30 * 86400000)), eq(activities.lifecycle, 'published'), eq(activities.moderation, 'normal')))
      .orderBy(desc(registrations.currentRegisteredAt)).limit(20)
  }
}
