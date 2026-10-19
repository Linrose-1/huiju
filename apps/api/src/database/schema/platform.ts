import { sql } from 'drizzle-orm'
import { boolean, char, datetime, index, json, mysqlEnum, mysqlTable, varchar } from 'drizzle-orm/mysql-core'
import { members } from './members.js'

export const platformContent = mysqlTable('platform_content', {
  id: varchar('id', { length: 32 }).primaryKey(),
  activityText: varchar('activity_text', { length: 200 }).notNull(),
  assistantText: varchar('assistant_text', { length: 200 }).notNull(),
})
export const platformEditors = mysqlTable('platform_editors', {
  memberId: char('member_id', { length: 36 }).primaryKey().references(() => members.id, { onDelete: 'restrict' }),
  enabled: boolean('enabled').notNull().default(false),
  updatedAt: datetime('updated_at', { mode: 'date', fsp: 3 }).notNull().default(sql`CURRENT_TIMESTAMP(3)`),
})
export const platformAudit = mysqlTable('platform_audit', {
  id: char('id', { length: 36 }).primaryKey(),
  actorType: mysqlEnum('actor_type', ['admin', 'member']).notNull(),
  actorId: char('actor_id', { length: 36 }).notNull(),
  action: mysqlEnum('action', ['content', 'editor']).notNull(),
  targetMemberId: char('target_member_id', { length: 36 }),
  before: json('before_value').$type<Record<string, string | boolean>>().notNull(),
  after: json('after_value').$type<Record<string, string | boolean>>().notNull(),
  createdAt: datetime('created_at', { mode: 'date', fsp: 3 }).notNull().default(sql`CURRENT_TIMESTAMP(3)`),
}, t => [index('platform_audit_created_idx').on(t.createdAt, t.id)])
export const legalConsents = mysqlTable('legal_consents', {
  id: char('id', { length: 36 }).primaryKey(),
  memberId: char('member_id', { length: 36 }).notNull().references(() => members.id, { onDelete: 'restrict' }),
  termsVersion: varchar('terms_version', { length: 64 }).notNull(),
  privacyVersion: varchar('privacy_version', { length: 64 }).notNull(),
  agreedAt: datetime('agreed_at', { mode: 'date', fsp: 3 }).notNull().default(sql`CURRENT_TIMESTAMP(3)`),
}, t => [index('legal_consents_member_idx').on(t.memberId, t.agreedAt)])
