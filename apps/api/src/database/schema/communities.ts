import { char, datetime, int, mysqlTable, primaryKey, uniqueIndex, varchar } from 'drizzle-orm/mysql-core'
import { members } from './members.js'

export const communities = mysqlTable('communities', {
  id: varchar('id', { length: 32 }).primaryKey(),
  name: varchar('name', { length: 64 }).notNull(),
  numberPrefix: char('number_prefix', { length: 2 }).notNull(),
  lastSequence: int('last_sequence', { unsigned: true }).notNull().default(0),
})

export const communityMembers = mysqlTable('community_members', {
  communityId: varchar('community_id', { length: 32 }).notNull().references(() => communities.id),
  memberId: char('member_id', { length: 36 }).notNull().references(() => members.id, { onDelete: 'cascade' }),
  sequenceNo: int('sequence_no', { unsigned: true }).notNull(),
  userNumber: varchar('user_number', { length: 32 }).notNull(),
  joinedAt: datetime('joined_at', { mode: 'date', fsp: 3 }).notNull(),
}, table => [
  primaryKey({ columns: [table.communityId, table.memberId] }),
  uniqueIndex('community_members_sequence_uq').on(table.communityId, table.sequenceNo),
  uniqueIndex('community_members_number_uq').on(table.communityId, table.userNumber),
])
