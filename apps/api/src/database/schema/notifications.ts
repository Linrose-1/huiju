import { sql } from 'drizzle-orm'
import {
  char,
  datetime,
  index,
  mysqlEnum,
  mysqlTable,
  text,
  varchar,
} from 'drizzle-orm/mysql-core'
import { activities } from './activities.js'
import { members } from './members.js'

export const notifications = mysqlTable(
  'notifications',
  {
    id: char('id', { length: 36 }).primaryKey(),
    recipientMemberId: char('recipient_member_id', { length: 36 })
      .notNull()
      .references(() => members.id, {
        onDelete: 'cascade',
        onUpdate: 'restrict',
      }),
    activityId: char('activity_id', { length: 36 }).references(
      () => activities.id,
      { onDelete: 'cascade', onUpdate: 'restrict' },
    ),
    type: mysqlEnum('type', [
      'activity_cancelled',
      'activity_removed',
      'activity_restored',
      'consultation_contact_updated',
    ]).notNull(),
    title: varchar('title', { length: 200 }).notNull(),
    body: text('body').notNull(),
    readAt: datetime('read_at', { mode: 'date', fsp: 3 }),
    createdAt: datetime('created_at', { mode: 'date', fsp: 3 })
      .notNull()
      .default(sql`CURRENT_TIMESTAMP(3)`),
  },
  (table) => [
    index('notifications_recipient_read_created_idx').on(
      table.recipientMemberId,
      table.readAt,
      table.createdAt,
    ),
    index('notifications_activity_id_idx').on(table.activityId),
  ],
)
