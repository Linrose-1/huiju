import { Injectable } from '@nestjs/common'
import { and, eq } from 'drizzle-orm'
import { randomUUID } from 'node:crypto'
import { notifications } from '../database/schema/notifications.js'
import { registrations } from '../database/schema/registrations.js'
import type { FlowDatabase } from '../flow/common.js'

type Transaction = Parameters<Parameters<FlowDatabase['db']['transaction']>[0]>[0]
type NotificationType = typeof notifications.$inferInsert['type']

@Injectable()
export class NotificationDelivery {
  // The activity owner holds its row lock; delivery participates in that transaction.
  async activityChanged(tx: Transaction, activityId: string, type: NotificationType, title: string, body: string) {
    const recipients = await tx.select({ memberId: registrations.memberId }).from(registrations)
      .where(and(eq(registrations.activityId, activityId), eq(registrations.status, 'active')))
    for (let i = 0; i < recipients.length; i += 200) {
      await tx.insert(notifications).values(recipients.slice(i, i + 200).map(row => ({
        id: randomUUID(), recipientMemberId: row.memberId, activityId, type, title, body,
      })))
    }
  }
}
