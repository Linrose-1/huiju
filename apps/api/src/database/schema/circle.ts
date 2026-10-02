import { sql } from 'drizzle-orm'
import { char, datetime, index, int, mysqlEnum, mysqlTable, text, uniqueIndex, varchar } from 'drizzle-orm/mysql-core'
import { adminAccounts, members } from './members.js'
const created = () => datetime('created_at', { mode: 'date', fsp: 3 }).notNull().default(sql`CURRENT_TIMESTAMP(3)`)
export const circlePosts = mysqlTable('circle_posts', {
  id: char('id', { length: 36 }).primaryKey(),
  authorId: char('author_id', { length: 36 }).notNull().references(() => members.id, { onDelete: 'restrict' }),
  requestId: char('request_id', { length: 36 }).notNull(),
  category: mysqlEnum('category', ['park', 'operation', 'service', 'store']).notNull(),
  subtype: mysqlEnum('subtype', ['rent', 'sale', 'transfer', 'seek_rent', 'buy']),
  title: varchar('title', { length: 200 }).notNull(), body: text('body').notNull(),
  location: varchar('location', { length: 500 }), area: varchar('area', { length: 100 }),
  price: varchar('price', { length: 200 }), validUntil: varchar('valid_until', { length: 10 }),
  storeName: varchar('store_name', { length: 200 }),
  lifecycle: mysqlEnum('lifecycle', ['open', 'ended']).notNull().default('open'),
  moderation: mysqlEnum('moderation', ['normal', 'removed']).notNull().default('normal'),
  removalReason: text('removal_reason'), createdAt: created(),
  updatedAt: datetime('updated_at', { mode: 'date', fsp: 3 }).notNull().default(sql`CURRENT_TIMESTAMP(3)`),
}, t => [uniqueIndex('circle_posts_request_uq').on(t.authorId, t.requestId),
  index('circle_posts_public_idx').on(t.moderation, t.category, t.createdAt), index('circle_posts_author_idx').on(t.authorId, t.createdAt)])
export const circleImages = mysqlTable('circle_images', {
  id: char('id', { length: 36 }).primaryKey(),
  ownerId: char('owner_id', { length: 36 }).notNull().references(() => members.id, { onDelete: 'restrict' }),
  filename: varchar('filename', { length: 50 }).notNull(), createdAt: created(),
})
export const circlePostImages = mysqlTable('circle_post_images', {
  id: char('id', { length: 36 }).primaryKey(),
  postId: char('post_id', { length: 36 }).notNull().references(() => circlePosts.id, { onDelete: 'cascade' }),
  imageId: char('image_id', { length: 36 }).notNull().references(() => circleImages.id, { onDelete: 'restrict' }),
  position: int('position', { unsigned: true }).notNull(),
}, t => [uniqueIndex('circle_post_images_order_uq').on(t.postId, t.position), uniqueIndex('circle_post_images_image_uq').on(t.postId, t.imageId)])
export const circleIntents = mysqlTable('circle_intents', {
  id: char('id', { length: 36 }).primaryKey(),
  postId: char('post_id', { length: 36 }).notNull().references(() => circlePosts.id, { onDelete: 'cascade' }),
  memberId: char('member_id', { length: 36 }).notNull().references(() => members.id, { onDelete: 'restrict' }),
  requestId: char('request_id', { length: 36 }).notNull(), phone: varchar('phone', { length: 32 }).notNull(), createdAt: created(),
}, t => [uniqueIndex('circle_intents_retry_uq').on(t.postId, t.memberId, t.requestId), index('circle_intents_post_idx').on(t.postId, t.createdAt)])
export const circleOperations = mysqlTable('circle_operations', {
  id: char('id', { length: 36 }).primaryKey(),
  postId: char('post_id', { length: 36 }).notNull().references(() => circlePosts.id, { onDelete: 'cascade' }),
  adminId: char('admin_id', { length: 36 }).notNull().references(() => adminAccounts.id, { onDelete: 'restrict' }),
  action: mysqlEnum('action', ['remove', 'restore']).notNull(), reason: text('reason').notNull(), createdAt: created(),
}, t => [index('circle_operations_post_idx').on(t.postId, t.createdAt)])
