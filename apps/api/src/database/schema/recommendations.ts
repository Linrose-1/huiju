import { sql } from 'drizzle-orm'
import { char, datetime, foreignKey, index, json, mysqlEnum, mysqlTable, uniqueIndex } from 'drizzle-orm/mysql-core'
import { members } from './members.js'
import { activities } from './activities.js'
import { registrationOperations } from './registrations.js'

export interface SearchPayload {
  conditions: string[]
  question: string | null
  results: { id: string; reason: string; differences: string[]; fingerprint: string }[]
  deliveredIds: string[]
}
const created = () => datetime('created_at', { mode: 'date', fsp: 3 }).notNull().default(sql`CURRENT_TIMESTAMP(3)`)
export const recommendationSearches = mysqlTable('activity_recommendation_searches', {
  id: char('id', { length: 36 }).primaryKey(),
  memberId: char('member_id', { length: 36 }).notNull().references(() => members.id, { onDelete: 'restrict' }),
  requestId: char('request_id', { length: 36 }).notNull(),
  inputHash: char('input_hash', { length: 64 }).notNull(),
  status: mysqlEnum('status', ['pending', 'results', 'clarify', 'failed']).notNull(),
  cursorSecret: char('cursor_secret', { length: 64 }).notNull(),
  payload: json('payload').$type<SearchPayload>(),
  createdAt: created(),
  completedAt: datetime('completed_at', { mode: 'date', fsp: 3 }),
  expiresAt: datetime('expires_at', { mode: 'date', fsp: 3 }).notNull(),
}, t => [uniqueIndex('recommendation_search_request_uq').on(t.memberId, t.requestId),
  index('recommendation_search_usage_idx').on(t.memberId, t.completedAt),
  index('recommendation_search_created_idx').on(t.createdAt), index('recommendation_search_expiry_idx').on(t.expiresAt)])

export const recommendationReservations = mysqlTable('activity_recommendation_reservations', {
  memberId: char('member_id', { length: 36 }).primaryKey().references(() => members.id, { onDelete: 'restrict' }),
  searchId: char('search_id', { length: 36 }).notNull(),
  reservationId: char('reservation_id', { length: 36 }).notNull(),
  createdAt: created(), expiresAt: datetime('expires_at', { mode: 'date', fsp: 3 }).notNull(),
}, t => [foreignKey({ name: 'recommendation_reservation_search_fk', columns: [t.searchId], foreignColumns: [recommendationSearches.id] }).onDelete('cascade')])

export const recommendationEvents = mysqlTable('activity_recommendation_events', {
  id: char('id', { length: 36 }).primaryKey(),
  searchId: char('search_id', { length: 36 }).notNull(),
  activityId: char('activity_id', { length: 36 }).notNull().references(() => activities.id, { onDelete: 'restrict' }),
  memberId: char('member_id', { length: 36 }).notNull().references(() => members.id, { onDelete: 'restrict' }),
  kind: mysqlEnum('kind', ['impression', 'view']).notNull(),
  tokenHash: char('token_hash', { length: 64 }),
  createdAt: created(), expiresAt: datetime('expires_at', { mode: 'date', fsp: 3 }).notNull(),
}, t => [uniqueIndex('recommendation_event_once_uq').on(t.searchId, t.activityId, t.kind),
  uniqueIndex('recommendation_event_token_uq').on(t.tokenHash), index('recommendation_event_created_idx').on(t.createdAt),
  foreignKey({ name: 'recommendation_event_search_fk', columns: [t.searchId], foreignColumns: [recommendationSearches.id] }).onDelete('cascade')])

export const recommendationConversions = mysqlTable('activity_recommendation_conversions', {
  registrationOperationId: char('registration_operation_id', { length: 36 }).primaryKey(),
  viewId: char('view_id', { length: 36 }).notNull(),
  searchId: char('search_id', { length: 36 }).notNull(),
  activityId: char('activity_id', { length: 36 }).notNull().references(() => activities.id, { onDelete: 'restrict' }),
  memberId: char('member_id', { length: 36 }).notNull().references(() => members.id, { onDelete: 'restrict' }),
  createdAt: created(),
}, t => [index('recommendation_conversion_created_idx').on(t.createdAt),
  foreignKey({ name: 'recommendation_conversion_operation_fk', columns: [t.registrationOperationId], foreignColumns: [registrationOperations.id] }).onDelete('restrict'),
  foreignKey({ name: 'recommendation_conversion_view_fk', columns: [t.viewId], foreignColumns: [recommendationEvents.id] }).onDelete('cascade'),
  foreignKey({ name: 'recommendation_conversion_search_fk', columns: [t.searchId], foreignColumns: [recommendationSearches.id] }).onDelete('cascade')])
