import { ApiPropertyOptional } from '@nestjs/swagger'
import { Type } from 'class-transformer'
import { IsIn, IsInt, IsOptional, IsUUID, Max, Min } from 'class-validator'
import { sql } from 'drizzle-orm'
import { activities } from '../database/schema/activities.js'
import { registrations, registrationAnswers } from '../database/schema/registrations.js'
import { inArray } from 'drizzle-orm'
import type { FlowDatabase } from './common.js'

export class PageQuery {
  @ApiPropertyOptional({ default: 0, minimum: 0, maximum: 1000000 })
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) @Max(1000000)
  offset: number = 0

  @ApiPropertyOptional({ default: 20, minimum: 1, maximum: 100 })
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100)
  limit: number = 20
}
export const activityStatuses = ['all', 'ongoing', 'upcoming', 'ended', 'cancelled', 'draft', 'removed'] as const
export class MyActivityQuery extends PageQuery {
  @ApiPropertyOptional({ enum: activityStatuses, default: 'all' })
  @IsOptional() @IsIn(activityStatuses)
  status: typeof activityStatuses[number] = 'all'
}
export class MyRegistrationQuery extends PageQuery {
  @ApiPropertyOptional({ enum: ['all', 'ongoing', 'upcoming', 'ended', 'cancelled', 'removed'], default: 'all' })
  @IsOptional() @IsIn(['all', 'ongoing', 'upcoming', 'ended', 'cancelled', 'removed'])
  status: Exclude<typeof activityStatuses[number], 'draft'> = 'all'
}
export class RosterQuery extends PageQuery {
  @ApiPropertyOptional({ description: '仅发起人管理名单按报名ID定位，不改变权限' }) @IsOptional() @IsUUID() registrationId?: string
  @ApiPropertyOptional({ enum: ['all', 'active', 'cancelled'], default: 'all' })
  @IsOptional() @IsIn(['all', 'active', 'cancelled'])
  status: 'all' | 'active' | 'cancelled' = 'all'
}
export function activityStatusSql(registered = false, now = new Date()) {
  return sql<string>`case when ${activities.moderation} = 'removed' then 'removed'
    ${registered ? sql`` : sql`when ${activities.lifecycle} = 'draft' then 'draft'`}
    when ${activities.lifecycle} = 'cancelled' ${registered ? sql`or ${registrations.status} = 'cancelled'` : sql``} then 'cancelled'
    when ${activities.endsAt} <= ${now} then 'ended'
    when ${activities.startsAt} <= ${now} then 'ongoing' else 'upcoming' end`
}
export function activityCounts(rows: { status: string; value: number | string }[]) {
  const counts = { all: 0, ongoing: 0, upcoming: 0, ended: 0, cancelled: 0, draft: 0, removed: 0 }
  for (const row of rows) {
    if (activityStatuses.includes(row.status as typeof activityStatuses[number]) && row.status !== 'all') {
      counts[row.status as Exclude<typeof activityStatuses[number], 'all'>] = Number(row.value)
      counts.all += Number(row.value)
    }
  }
  return counts
}
export async function answersForRegistrations(db: FlowDatabase['db'], ids: string[]) {
  const result = new Map<string, { questionId: string; value: string | string[] }[]>()
  if (!ids.length) return result
  const rows = await db.select({ registrationId: registrationAnswers.registrationId, questionId: registrationAnswers.questionId, value: registrationAnswers.answer })
    .from(registrationAnswers).where(inArray(registrationAnswers.registrationId, ids))
  for (const { registrationId, ...answer } of rows) {
    const answers = result.get(registrationId) ?? []
    answers.push(answer)
    result.set(registrationId, answers)
  }
  return result
}
