import { Injectable } from '@nestjs/common'
import { and, count, desc, eq, inArray, ne, sql } from 'drizzle-orm'
import { randomUUID } from 'node:crypto'
import { activities, activityOperations } from '../database/schema/activities.js'
import { adminAccounts, members } from '../database/schema/members.js'
import { NotificationDelivery } from '../notifications/delivery.js'
import { fail, type FlowDatabase } from './common.js'
import { AdminActivityQuery } from './activity-moderation-dto.js'

type Transaction = Parameters<Parameters<FlowDatabase['db']['transaction']>[0]>[0]

@Injectable()
export class ActivityModerationService {
  constructor(private readonly delivery: NotificationDelivery) {}

  async list(tx: Transaction, query: AdminActivityQuery) {
    const where = and(ne(activities.lifecycle, 'draft'),
      query.status === 'all' ? undefined : eq(activities.moderation, query.status),
      query.q?.trim() ? sql`locate(${query.q.trim()}, ${activities.title}) > 0` : undefined)
    const [total] = await tx.select({ value: count() }).from(activities).where(where)
    const rows = await tx.select({ activity: activities, organizerName: members.displayName }).from(activities)
      .innerJoin(members, eq(members.id, activities.organizerMemberId)).where(where)
      .orderBy(desc(activities.createdAt), desc(activities.id)).limit(20).offset(query.offset)
    return { total: Number(total!.value), hasMore: query.offset + rows.length < Number(total!.value),
      items: rows.map(({ activity: row, organizerName }) => ({
        id: row.id, title: row.title, description: row.description, location: row.location, organizerName,
        startsAt: row.startsAt.toISOString(), endsAt: row.endsAt.toISOString(), lifecycle: row.lifecycle,
        moderation: row.moderation, activeRegistrationCount: row.activeRegistrationCount,
        feeType: row.feeType, feeAmountCents: row.feeAmountCents,
      })) }
  }

  async history(tx: Transaction, id: string, offset: number) {
    const [activity] = await tx.select({ id: activities.id }).from(activities)
      .where(and(eq(activities.id, id), ne(activities.lifecycle, 'draft')))
    if (!activity) fail('NOT_FOUND', '活动不存在', 404)
    const rows = await tx.select({ operation: activityOperations, actorName: adminAccounts.displayName })
      .from(activityOperations).leftJoin(adminAccounts, eq(adminAccounts.id, activityOperations.actorAdminAccountId))
      .where(and(eq(activityOperations.activityId, id), inArray(activityOperations.action, ['remove', 'restore'])))
      .orderBy(desc(activityOperations.createdAt), desc(activityOperations.id)).limit(21).offset(offset)
    return { hasMore: rows.length > 20, items: rows.slice(0, 20).map(({ operation: row, actorName }) => ({
      id: row.id, action: row.action, actorName, reason: row.reason, createdAt: row.createdAt.toISOString(),
    })) }
  }

  async change(tx: Transaction, id: string, action: 'remove' | 'restore', reason: string, actor: { id: string }) {
    const trimmed = reason?.trim()
    if (!trimmed || trimmed.length > 1000) fail('INVALID_REASON', '请填写 1–1000 字的操作原因')
    const [activity] = await tx.select().from(activities).where(eq(activities.id, id)).for('update')
    if (!activity) fail('NOT_FOUND', '活动不存在', 404)
    if (activity.lifecycle === 'draft') fail('ACTIVITY_UNAVAILABLE', '草稿不能下架或恢复', 409)
    const moderation = action === 'remove' ? 'removed' : 'normal'
    if (activity.moderation === moderation) return { ok: true }
    // Only the moderation axis changes: times, lifecycle and registrations stay intact.
    await tx.update(activities).set({ moderation }).where(eq(activities.id, id))
    await tx.insert(activityOperations).values({ id: randomUUID(), activityId: id, actorType: 'admin',
      actorAdminAccountId: actor.id, action, reason: trimmed })
    const title = action === 'remove' ? '活动已下架' : '活动已恢复'
    await this.delivery.activityChanged(tx, id, action === 'remove' ? 'activity_removed' : 'activity_restored',
      title, `《${activity.title}》${action === 'remove' ? '已下架' : '已恢复'}。原因：${trimmed}${action === 'restore' ? '。活动状态、原定时间和名额保持不变，请进入活动查看当前报名状态。' : ''}`)
    return { ok: true }
  }
}
