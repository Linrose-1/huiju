import { sql } from 'drizzle-orm'
import { boolean, char, datetime, index, int, json, mysqlTable, varchar } from 'drizzle-orm/mysql-core'
import { adminAccounts } from './members.js'

export const mcpOptionalFields = ['location', 'fee', 'cover', 'description'] as const
export type McpOptionalField = typeof mcpOptionalFields[number]
export type McpPermission = { enabled: boolean; fields: McpOptionalField[] }
export type McpPartnerSnapshot = {
  id: string; name: string; remark: string; enabled: boolean
  search: McpPermission; detail: McpPermission; version: number
}

export const platformMcpPartners = mysqlTable('platform_mcp_partners', {
  id: char('id', { length: 36 }).primaryKey(),
  name: varchar('name', { length: 60 }).notNull(),
  remark: varchar('remark', { length: 200 }).notNull(),
  enabled: boolean('enabled').notNull().default(false),
  search: json('search_permission').$type<McpPermission>().notNull(),
  detail: json('detail_permission').$type<McpPermission>().notNull(),
  version: int('version', { unsigned: true }).notNull().default(1),
  createdAt: datetime('created_at', { mode: 'date', fsp: 3 }).notNull().default(sql`CURRENT_TIMESTAMP(3)`),
}, table => [index('platform_mcp_partners_created_idx').on(table.createdAt, table.id)])

export const platformMcpAudit = mysqlTable('platform_mcp_audit', {
  id: char('id', { length: 36 }).primaryKey(),
  actorId: char('actor_id', { length: 36 }).notNull().references(() => adminAccounts.id, { onDelete: 'restrict' }),
  actorName: varchar('actor_name', { length: 100 }).notNull(),
  before: json('before_value').$type<McpPartnerSnapshot>(),
  after: json('after_value').$type<McpPartnerSnapshot>().notNull(),
  createdAt: datetime('created_at', { mode: 'date', fsp: 3 }).notNull().default(sql`CURRENT_TIMESTAMP(3)`),
}, table => [index('platform_mcp_audit_created_idx').on(table.createdAt, table.id)])
