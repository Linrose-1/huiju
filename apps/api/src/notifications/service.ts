import { Injectable } from '@nestjs/common'
import { and, count, desc, eq, isNull } from 'drizzle-orm'
import { notifications } from '../database/schema/notifications.js'
import { FlowDatabase } from '../database/service.js'
import { fail } from '../common/errors.js'
import { IdentityService } from '../flow/identity.js'
import { PageQuery } from '../flow/pagination.js'

@Injectable()
export class NotificationService {
  constructor(private readonly database: FlowDatabase, private readonly identity: IdentityService) {}

  async list(header?: string, query: PageQuery = new PageQuery()) {
    const member = (await this.identity.require(header))!
    const where = eq(notifications.recipientMemberId, member.id)
    const [unread] = await this.database.db.select({ value: count() }).from(notifications).where(and(where, isNull(notifications.readAt)))
    const [total] = await this.database.db.select({ value: count() }).from(notifications).where(where)
    const rows = await this.database.db.select().from(notifications).where(where)
      .orderBy(desc(notifications.createdAt), desc(notifications.id)).limit(query.limit + 1).offset(query.offset)
    return { items: rows.slice(0, query.limit).map(row => ({ id: row.id, activityId: row.activityId, type: row.type,
      title: row.title, body: row.body, readAt: row.readAt?.toISOString() ?? null, createdAt: row.createdAt.toISOString() })),
    hasMore: rows.length > query.limit, unreadCount: Number(unread!.value), total: Number(total!.value) }
  }

  async read(id: string, header?: string) {
    const member = (await this.identity.require(header))!
    const where = and(eq(notifications.id, id), eq(notifications.recipientMemberId, member.id))
    const [row] = await this.database.db.select({ id: notifications.id }).from(notifications).where(where)
    if (!row) fail('NOT_FOUND', '通知不存在', 404)
    await this.database.db.update(notifications).set({ readAt: new Date() }).where(and(where, isNull(notifications.readAt)))
    return { ok: true }
  }
}
