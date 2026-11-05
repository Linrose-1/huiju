import { sql } from 'drizzle-orm'
import { char, datetime, index, int, json, mysqlTable, uniqueIndex, varchar } from 'drizzle-orm/mysql-core'
import { activities } from './activities.js'
import { members } from './members.js'

export const activityPosterCopies = mysqlTable('activity_poster_copies', {
  activityId: char('activity_id', { length: 36 }).primaryKey().references(() => activities.id, { onDelete: 'restrict' }),
  subtitle: varchar('subtitle', { length: 40 }).notNull(),
  highlights: json('highlights').$type<string[]>().notNull(),
  sourceHash: char('source_hash', { length: 64 }).notNull(),
  version: int('version', { unsigned: true }).notNull(),
  confirmedBy: char('confirmed_by', { length: 36 }).notNull().references(() => members.id, { onDelete: 'restrict' }),
  confirmedAt: datetime('confirmed_at', { mode: 'date', fsp: 3 }).notNull(),
})

export const activityPosterShares = mysqlTable('activity_poster_shares', {
  scene: varchar('scene', { length: 25 }).primaryKey(),
  activityId: char('activity_id', { length: 36 }).notNull().references(() => activities.id, { onDelete: 'restrict' }),
  memberId: char('member_id', { length: 36 }).notNull().references(() => members.id, { onDelete: 'restrict' }),
  inviteCode: varchar('invite_code', { length: 32 }).notNull(),
  createdAt: datetime('created_at', { mode: 'date', fsp: 3 }).notNull().default(sql`CURRENT_TIMESTAMP(3)`),
}, table => [uniqueIndex('activity_poster_shares_activity_member_uq').on(table.activityId, table.memberId)])

export const aiPosterUsages = mysqlTable('ai_poster_usages', {
  id: char('id', { length: 36 }).primaryKey(),
  memberId: char('member_id', { length: 36 }).notNull().references(() => members.id, { onDelete: 'restrict' }),
  createdAt: datetime('created_at', { mode: 'date', fsp: 3 }).notNull(),
}, table => [index('ai_poster_usages_member_created_idx').on(table.memberId, table.createdAt)])

export const aiPosterReservations = mysqlTable('ai_poster_reservations', {
  memberId: char('member_id', { length: 36 }).primaryKey().references(() => members.id, { onDelete: 'restrict' }),
  reservationId: char('reservation_id', { length: 36 }).notNull(),
  createdAt: datetime('created_at', { mode: 'date', fsp: 3 }).notNull(),
  expiresAt: datetime('expires_at', { mode: 'date', fsp: 3 }).notNull(),
})
