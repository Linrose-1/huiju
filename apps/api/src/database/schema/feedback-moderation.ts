import { sql } from 'drizzle-orm'
import { char, datetime, mysqlEnum, mysqlTable, text, uniqueIndex, varchar } from 'drizzle-orm/mysql-core'
import { adminAccounts } from './members.js'

// No cascading content FK: moderation evidence survives removal of its source.
export const feedbackModerationLogs = mysqlTable('feedback_moderation_logs', {
  id: char('id', { length: 36 }).primaryKey(),
  kind: mysqlEnum('kind', ['comment', 'review']).notNull(),
  targetId: char('target_id', { length: 36 }).notNull(),
  adminId: char('admin_id', { length: 36 }).notNull().references(() => adminAccounts.id, { onDelete: 'restrict', onUpdate: 'restrict' }),
  adminName: varchar('admin_name', { length: 100 }).notNull(),
  reason: varchar('reason', { length: 500 }).notNull(),
  contentSnapshot: text('content_snapshot').notNull(),
  createdAt: datetime('created_at', { mode: 'date', fsp: 3 }).notNull().default(sql`CURRENT_TIMESTAMP(3)`),
}, table => [uniqueIndex('feedback_moderation_target_uq').on(table.kind, table.targetId)])
