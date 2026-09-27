import { Injectable } from '@nestjs/common'
import { count, countDistinct, desc, eq, sql } from 'drizzle-orm'
import { createHash } from 'node:crypto'
import { activities } from '../database/schema/activities.js'
import { readingEvents, readingVisitors } from '../database/schema/interactions.js'
import { members } from '../database/schema/members.js'
import { fail, FlowDatabase } from './common.js'
import { complete, IdentityService, type Member } from './identity.js'
import { RecordViewInput, type ReaderDto, type ReadingListDto, type ReadingStatsDto } from './reading-dto.js'

export function readerDto(member: Member): ReaderDto {
  return complete(member)
    ? { memberId: member.id, avatarUrl: member.avatarUrl, displayName: member.displayName! }
    : { memberId: member.id, avatarUrl: null, displayName: `会员${member.memberNumber}` }
}

export function viewStats(views: number, visitors: number, registrations: number): ReadingStatsDto {
  return { views, visitors, conversionRate: visitors ? Math.round(registrations / visitors * 10000) / 100 : null }
}

@Injectable()
export class ReadingService {
  constructor(private readonly database: FlowDatabase, private readonly identity: IdentityService) {}

  async record(id: string, input: RecordViewInput, header?: string) {
    id = id.toLowerCase()
    const member = await this.identity.require(header, true)
    const visitorHash = createHash('sha256').update(input.visitorId.toLowerCase()).digest('hex')
    const eventId = input.eventId.toLowerCase()
    await this.database.db.transaction(async tx => {
      const [activity] = await tx.select().from(activities).where(eq(activities.id, id)).for('update')
      if (!activity || activity.lifecycle === 'draft') fail('NOT_FOUND', '活动不存在', 404)
      if (activity.moderation === 'removed') return
      // Lock the visitor across all activities before associating anonymous history.
      await tx.insert(readingVisitors).values({ visitorHash }).onDuplicateKeyUpdate({ set: { visitorHash: sql`${readingVisitors.visitorHash}` } })
      const [visitor] = await tx.select().from(readingVisitors).where(eq(readingVisitors.visitorHash, visitorHash)).for('update')
      if (visitor.memberId && visitor.memberId !== member?.id) fail('VISITOR_CHANGED', '浏览身份已变化，请重试', 409)
      // A duplicate request is harmless; a reused id from another visitor/activity is rejected.
      await tx.insert(readingEvents).values({ id: eventId, visitorHash, activityId: id })
        .onDuplicateKeyUpdate({ set: { id: sql`${readingEvents.id}` } })
      const [event] = await tx.select().from(readingEvents).where(eq(readingEvents.id, eventId)).for('update')
      if (event.visitorHash !== visitorHash || event.activityId !== id) fail('READING_EVENT_CONFLICT', '浏览记录标识已使用，请重新打开活动', 409)
      if (member && !visitor.memberId) await tx.update(readingVisitors).set({ memberId: member.id }).where(eq(readingVisitors.visitorHash, visitorHash))
    })
    return { ok: true }
  }

  async readers(id: string, offset = 0): Promise<ReadingListDto> {
    return this.database.db.transaction(async tx => {
      const [activity] = await tx.select().from(activities).where(eq(activities.id, id)).limit(1)
      if (!activity || activity.lifecycle === 'draft') fail('NOT_FOUND', '活动不存在', 404)
      if (activity.moderation === 'removed') return { items: [], total: 0, hasMore: false }
      const [{ total }] = await tx.select({ total: countDistinct(readingVisitors.memberId) })
        .from(readingEvents).innerJoin(readingVisitors, eq(readingVisitors.visitorHash, readingEvents.visitorHash))
        .where(eq(readingEvents.activityId, id))
      const rows = await tx.select({ member: members, lastRead: sql`max(${readingEvents.recordedAt})` })
        .from(readingEvents).innerJoin(readingVisitors, eq(readingVisitors.visitorHash, readingEvents.visitorHash))
        .innerJoin(members, eq(members.id, readingVisitors.memberId))
        .where(eq(readingEvents.activityId, id)).groupBy(members.id)
        .orderBy(desc(sql`max(${readingEvents.recordedAt})`), desc(members.id)).limit(40).offset(offset)
      return { items: rows.map(row => readerDto(row.member)), total, hasMore: offset + rows.length < total }
    })
  }

  async stats(id: string, header?: string): Promise<ReadingStatsDto> {
    const member = (await this.identity.require(header))!
    return this.database.db.transaction(async tx => {
      const [activity] = await tx.select().from(activities).where(eq(activities.id, id)).limit(1)
      if (!activity) fail('NOT_FOUND', '活动不存在', 404)
      if (activity.organizerMemberId !== member.id) fail('FORBIDDEN', '仅活动发起人可查看浏览统计', 403)
      const [totals] = await tx.select({ views: count(), visitors: countDistinct(sql`coalesce(concat('member:', ${readingVisitors.memberId}), concat('visitor:', ${readingVisitors.visitorHash}))`) })
        .from(readingEvents).innerJoin(readingVisitors, eq(readingVisitors.visitorHash, readingEvents.visitorHash))
        .where(eq(readingEvents.activityId, id))
      return viewStats(totals.views, totals.visitors, activity.activeRegistrationCount)
    })
  }
}
