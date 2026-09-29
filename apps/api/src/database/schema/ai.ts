import { sql } from 'drizzle-orm'
import { char, datetime, index, mysqlTable } from 'drizzle-orm/mysql-core'
import { members } from './members.js'

// Only successful drafts are recorded. The submitted idea and provider response are never stored.
export const aiActivityDraftUsages = mysqlTable('ai_activity_draft_usages', {
  id: char('id', { length: 36 }).primaryKey(),
  memberId: char('member_id', { length: 36 }).notNull().references(() => members.id, { onDelete: 'restrict', onUpdate: 'restrict' }),
  createdAt: datetime('created_at', { mode: 'date', fsp: 3 }).notNull().default(sql`CURRENT_TIMESTAMP(3)`),
}, table => [index('ai_activity_draft_usages_member_created_idx').on(table.memberId, table.createdAt)])
