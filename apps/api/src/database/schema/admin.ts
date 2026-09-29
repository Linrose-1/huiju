import { sql } from 'drizzle-orm'
import { boolean, char, datetime, int, mysqlEnum, mysqlTable, uniqueIndex, varchar } from 'drizzle-orm/mysql-core'
import { adminAccounts } from './members.js'

// Existing administrator rows without credentials remain unable to log in.
export const adminCredentials = mysqlTable('admin_credentials', {
  adminAccountId: char('admin_account_id', { length: 36 }).primaryKey().references(() => adminAccounts.id, { onDelete: 'restrict' }),
  username: varchar('username', { length: 64 }).notNull(),
  role: mysqlEnum('role', ['super_admin', 'operator']).notNull().default('operator'),
  passwordHash: varchar('password_hash', { length: 256 }).notNull(),
  mustChangePassword: boolean('must_change_password').notNull().default(true),
  failedAttempts: int('failed_attempts', { unsigned: true }).notNull().default(0),
  lockedUntil: datetime('locked_until', { mode: 'date', fsp: 3 }),
}, (table) => [uniqueIndex('admin_credentials_username_uq').on(table.username)])

export const adminAccountAudit = mysqlTable('admin_account_audit', {
  id: char('id', { length: 36 }).primaryKey(),
  actorId: char('actor_id', { length: 36 }).references(() => adminAccounts.id, { onDelete: 'restrict' }),
  targetId: char('target_id', { length: 36 }).notNull().references(() => adminAccounts.id, { onDelete: 'restrict' }),
  action: mysqlEnum('action', ['create', 'reset_password', 'change_password', 'disable', 'enable', 'bootstrap', 'recover']).notNull(),
  createdAt: datetime('created_at', { mode: 'date', fsp: 3 }).notNull().default(sql`CURRENT_TIMESTAMP(3)`),
})
