import { sql } from 'drizzle-orm'
import { char, datetime, foreignKey, index, int, json, mysqlEnum, mysqlTable, varchar } from 'drizzle-orm/mysql-core'
import { adminAccounts } from './members.js'
const created = () => datetime('created_at', { mode: 'date', fsp: 3 }).notNull().default(sql`CURRENT_TIMESTAMP(3)`)
const updated = () => datetime('updated_at', { mode: 'date', fsp: 3 }).notNull().default(sql`CURRENT_TIMESTAMP(3)`)
export type AdvertisingBlock = { type: 'text' | 'image'; text?: string; imageId?: string }
export const advertisingImages = mysqlTable('advertising_images', {
  id: char('id', { length: 36 }).primaryKey(), file: varchar('file', { length: 64 }).notNull(),
  uploadedBy: char('uploaded_by', { length: 36 }).notNull().references(() => adminAccounts.id, { onDelete: 'restrict' }),
  purpose: mysqlEnum('purpose', ['source', 'wide', 'tall', 'detail']).notNull(),
  sourceImageId: char('source_image_id', { length: 36 }), width: int('width', { unsigned: true }).notNull(), height: int('height', { unsigned: true }).notNull(), createdAt: created(),
})
export const advertisingIntroductions = mysqlTable('advertising_introductions', {
  id: char('id', { length: 36 }).primaryKey(), name: varchar('name', { length: 100 }).notNull(), companyName: varchar('company_name', { length: 200 }).notNull(),
  contactName: varchar('contact_name', { length: 100 }).notNull(), phone: varchar('phone', { length: 40 }).notNull(), wechatId: varchar('wechat_id', { length: 100 }).notNull(),
  summary: varchar('summary', { length: 500 }).notNull(), coverImageId: char('cover_image_id', { length: 36 }),
  blocks: json('blocks').$type<AdvertisingBlock[]>().notNull(), status: mysqlEnum('status', ['draft', 'published', 'offline']).notNull().default('draft'),
  version: int('version', { unsigned: true }).notNull().default(1), createdAt: created(), updatedAt: updated(),
}, t => [foreignKey({ name: 'advertising_intro_cover_image_fk', columns: [t.coverImageId], foreignColumns: [advertisingImages.id] }).onDelete('restrict'), index('advertising_introductions_status_idx').on(t.status, t.createdAt, t.id)])
export const advertisingAds = mysqlTable('advertising_ads', {
  id: char('id', { length: 36 }).primaryKey(), title: varchar('title', { length: 100 }).notNull(), introductionId: char('introduction_id', { length: 36 }).notNull().references(() => advertisingIntroductions.id, { onDelete: 'restrict' }),
  placements: json('placements').$type<('activity' | 'circle' | 'assistant')[]>().notNull(),
  wideImageId: char('wide_image_id', { length: 36 }).references(() => advertisingImages.id, { onDelete: 'restrict' }), tallImageId: char('tall_image_id', { length: 36 }).references(() => advertisingImages.id, { onDelete: 'restrict' }),
  sortOrder: int('sort_order').notNull().default(0), status: mysqlEnum('status', ['draft', 'published', 'offline']).notNull().default('draft'),
  version: int('version', { unsigned: true }).notNull().default(1), createdAt: created(), updatedAt: updated(),
}, t => [index('advertising_ads_order_idx').on(t.status, t.sortOrder, t.createdAt, t.id)])
export const advertisingBackground = mysqlTable('advertising_background', {
  id: varchar('id', { length: 16 }).primaryKey(), imageId: char('image_id', { length: 36 }).references(() => advertisingImages.id, { onDelete: 'restrict' }),
  version: int('version', { unsigned: true }).notNull().default(0), updatedAt: updated(),
})
export const advertisingAudit = mysqlTable('advertising_audit', {
  id: char('id', { length: 36 }).primaryKey(), actorId: char('actor_id', { length: 36 }).notNull().references(() => adminAccounts.id, { onDelete: 'restrict' }),
  targetId: varchar('target_id', { length: 36 }).notNull(), action: varchar('action', { length: 40 }).notNull(), before: json('before_value').$type<unknown>(), after: json('after_value').$type<unknown>(), createdAt: created(),
}, t => [index('advertising_audit_created_idx').on(t.createdAt, t.id)])
