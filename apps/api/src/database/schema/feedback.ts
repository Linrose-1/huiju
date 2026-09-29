import { sql } from 'drizzle-orm'
import { char, check, datetime, index, int, mysqlTable, text, uniqueIndex } from 'drizzle-orm/mysql-core'
import { activities } from './activities.js'
import { members } from './members.js'

const fields = () => ({
  id: char('id', { length: 36 }).primaryKey(),
  activityId: char('activity_id', { length: 36 }).notNull().references(() => activities.id, { onDelete: 'cascade', onUpdate: 'restrict' }),
  memberId: char('member_id', { length: 36 }).notNull().references(() => members.id, { onDelete: 'restrict', onUpdate: 'restrict' }),
  content: text('content').notNull(),
  hiddenAt: datetime('hidden_at', { mode: 'date', fsp: 3 }),
  deletedAt: datetime('deleted_at', { mode: 'date', fsp: 3 }),
  createdAt: datetime('created_at', { mode: 'date', fsp: 3 }).notNull().default(sql`CURRENT_TIMESTAMP(3)`),
  updatedAt: datetime('updated_at', { mode: 'date', fsp: 3 }).notNull().default(sql`CURRENT_TIMESTAMP(3)`),
})

export const activityComments = mysqlTable('activity_comments', fields(), table => [
  index('activity_comments_activity_created_idx').on(table.activityId, table.createdAt),
  index('activity_comments_member_activity_idx').on(table.memberId, table.activityId),
])

export const activityReviews = mysqlTable('activity_reviews', { ...fields(), score: int('score').notNull() }, table => [
  uniqueIndex('activity_reviews_activity_member_uq').on(table.activityId, table.memberId),
  index('activity_reviews_activity_created_idx').on(table.activityId, table.createdAt),
  check('activity_reviews_score_ck', sql`${table.score} between 1 and 5`),
])
