import { and, asc, count, desc, eq, gte, lt, ne, sql } from 'drizzle-orm'
import { activities } from '../database/schema/activities.js'
import { members } from '../database/schema/members.js'
import { registrations } from '../database/schema/registrations.js'
import { FlowDatabase } from './common.js'
import type { LeaderboardDto, LeaderboardQuery } from './leaderboard-dto.js'

export const publishedForCount = eq(activities.lifecycle, 'published')
export const attendedForCount = and(publishedForCount, eq(registrations.attended, true), eq(registrations.status, 'active'))

export function beijingMonth(now: Date) {
  const offset = 8 * 60 * 60 * 1000
  const local = new Date(now.getTime() + offset)
  const year = local.getUTCFullYear()
  const month = local.getUTCMonth()
  return {
    label: local.toISOString().slice(0, 7),
    start: new Date(Date.UTC(year, month, 1) - offset),
    end: new Date(Date.UTC(year, month + 1, 1) - offset),
  }
}

export async function readLeaderboard(db: FlowDatabase['db'], query: LeaderboardQuery, now = new Date()): Promise<LeaderboardDto> {
  const month = query.period === 'month' ? beijingMonth(now) : null
  const dateColumn = query.kind === 'attendance' ? activities.startsAt : activities.publishedAt
  const dates = month && and(gte(dateColumn, month.start), lt(dateColumn, month.end))
  // One current registration per member and activity (registrations_activity_member_uq).
  const totals = query.kind === 'attendance'
    ? db.select({ memberId: registrations.memberId, total: count().as('total') }).from(registrations)
      .innerJoin(activities, eq(activities.id, registrations.activityId))
      .where(and(attendedForCount, dates ?? undefined))
      .groupBy(registrations.memberId).as('totals')
    : db.select({ memberId: activities.organizerMemberId, total: count().as('total') }).from(activities)
      .where(and(publishedForCount, dates ?? undefined))
      .groupBy(activities.organizerMemberId).as('totals')

  const rows = await db.select({ memberId: members.id, displayName: members.displayName, avatarUrl: members.avatarUrl, count: totals.total })
    .from(totals).innerJoin(members, eq(members.id, totals.memberId))
    .where(and(eq(members.kind, 'member'), eq(members.nameSetByUser, true), eq(members.avatarSetByUser, true),
      ne(members.boundPhone, ''), ne(members.avatarUrl, ''), sql`trim(${members.displayName}) <> ''`))
    .orderBy(desc(totals.total), asc(members.id)).limit(20)
  return { items: rows.map(row => ({ ...row, displayName: row.displayName! })), month: month?.label ?? null }
}
