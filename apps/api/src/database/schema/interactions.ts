import { sql } from 'drizzle-orm'
import { char, datetime, index, mysqlTable } from 'drizzle-orm/mysql-core'
import { activities } from './activities.js'
import { members } from './members.js'

export const readingVisitors = mysqlTable('reading_visitors', {
  visitorHash: char('visitor_hash', { length: 64 }).primaryKey(),
  memberId: char('member_id', { length: 36 }).references(() => members.id, { onDelete: 'restrict', onUpdate: 'restrict' }),
}, table => [index('reading_visitors_member_idx').on(table.memberId)])

export const readingEvents = mysqlTable('reading_events', {
  id: char('id', { length: 36 }).primaryKey(),
  visitorHash: char('visitor_hash', { length: 64 }).notNull().references(() => readingVisitors.visitorHash, { onDelete: 'restrict', onUpdate: 'restrict' }),
  activityId: char('activity_id', { length: 36 }).notNull().references(() => activities.id, { onDelete: 'restrict', onUpdate: 'restrict' }),
  recordedAt: datetime('recorded_at', { mode: 'date', fsp: 3 }).notNull().default(sql`CURRENT_TIMESTAMP(3)`),
}, table => [
  index('reading_events_activity_visitor_idx').on(table.activityId, table.visitorHash),
  index('reading_events_visitor_idx').on(table.visitorHash),
])
