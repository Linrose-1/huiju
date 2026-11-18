import { sql } from 'drizzle-orm'
import { boolean, char, datetime, index, int, json, mediumtext, mysqlTable, varchar } from 'drizzle-orm/mysql-core'
import { adminAccounts } from './members.js'

export type BrandTabNames = { circle: string; activity: string; assistant: string; mine: string }
export type BrandPartner = { name: string; description: string; logoImageId: string | null; codeImageId: string | null; sortOrder: number; visible: boolean }
export type BrandAppearance = { logoImageId: string | null; tabNames: BrandTabNames; partners: BrandPartner[] }
export type BrandSnapshot = { displayName: string; visible: boolean; version: number; appearance?: BrandAppearance }

export const platformBrandImages = mysqlTable('platform_brand_images', {
  id: char('id', { length: 36 }).primaryKey(),
  purpose: varchar('purpose', { length: 4 }).$type<'logo' | 'code'>().notNull(),
  mimeType: varchar('mime_type', { length: 20 }).$type<'image/png' | 'image/jpeg'>().notNull(),
  base64: mediumtext('base64').notNull(),
  uploadedBy: char('uploaded_by', { length: 36 }).notNull().references(() => adminAccounts.id, { onDelete: 'restrict' }),
  createdAt: datetime('created_at', { mode: 'date', fsp: 3 }).notNull().default(sql`CURRENT_TIMESTAMP(3)`),
})

export const platformBrand = mysqlTable('platform_brand', {
  id: varchar('id', { length: 32 }).primaryKey(),
  displayName: varchar('display_name', { length: 30 }).notNull(),
  visible: boolean('visible').notNull().default(true),
  version: int('version', { unsigned: true }).notNull().default(1),
  appearance: json('appearance').$type<BrandAppearance>(),
})

export const platformBrandAudit = mysqlTable('platform_brand_audit', {
  id: char('id', { length: 36 }).primaryKey(),
  actorId: char('actor_id', { length: 36 }).notNull().references(() => adminAccounts.id, { onDelete: 'restrict' }),
  before: json('before_value').$type<BrandSnapshot>().notNull(),
  after: json('after_value').$type<BrandSnapshot>().notNull(),
  createdAt: datetime('created_at', { mode: 'date', fsp: 3 }).notNull().default(sql`CURRENT_TIMESTAMP(3)`),
}, table => [index('platform_brand_audit_created_idx').on(table.createdAt, table.id)])
