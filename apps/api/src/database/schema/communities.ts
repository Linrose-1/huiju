import { sql } from 'drizzle-orm'
import { boolean, char, datetime, int, json, mysqlTable, primaryKey, uniqueIndex, varchar } from 'drizzle-orm/mysql-core'
import { adminAccounts, members } from './members.js'

export const DEFAULT_COMMUNITY_ID = 'xuejia'

export const communities = mysqlTable('communities', {
  id: varchar('id', { length: 32 }).primaryKey(),
  name: varchar('name', { length: 64 }).notNull(),
  numberPrefix: char('number_prefix', { length: 2 }).notNull(),
  lastSequence: int('last_sequence', { unsigned: true }).notNull().default(0),
})

export const communityMembers = mysqlTable('community_members', {
  communityId: varchar('community_id', { length: 32 }).notNull().references(() => communities.id),
  memberId: char('member_id', { length: 36 }).notNull().references(() => members.id, { onDelete: 'cascade' }),
  isAdmin: boolean('is_admin').notNull().default(false),
  canViewRoster: boolean('can_view_roster').notNull().default(false),
  isRegistered: boolean('is_registered').notNull().default(false),
  sequenceNo: int('sequence_no', { unsigned: true }).notNull(),
  userNumber: varchar('user_number', { length: 32 }).notNull(),
  joinedAt: datetime('joined_at', { mode: 'date', fsp: 3 }).notNull(),
}, table => [
  primaryKey({ columns: [table.communityId, table.memberId] }),
  uniqueIndex('community_members_sequence_uq').on(table.communityId, table.sequenceNo),
  uniqueIndex('community_members_number_uq').on(table.communityId, table.userNumber),
])

type RosterPermissions = { canViewRoster: boolean; canRecognizeMembers: boolean }
export const rosterPermissionAudit = mysqlTable('roster_permission_audit', {
  id: char('id', { length: 36 }).primaryKey(),
  communityId: varchar('community_id', { length: 32 }).notNull().references(() => communities.id),
  memberId: char('member_id', { length: 36 }).notNull().references(() => members.id),
  actorId: char('actor_id', { length: 36 }).notNull().references(() => adminAccounts.id),
  before: json('before_value').$type<RosterPermissions>().notNull(),
  after: json('after_value').$type<RosterPermissions>().notNull(),
  createdAt: datetime('created_at', { mode: 'date', fsp: 3 }).notNull().default(sql`CURRENT_TIMESTAMP(3)`),
})
