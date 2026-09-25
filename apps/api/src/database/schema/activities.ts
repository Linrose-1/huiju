import { sql } from 'drizzle-orm'
import {
  boolean,
  char,
  check,
  datetime,
  index,
  int,
  json,
  mysqlEnum,
  mysqlTable,
  text,
  timestamp,
  varchar,
} from 'drizzle-orm/mysql-core'
import { adminAccounts, members } from './members.js'

export const activities = mysqlTable(
  'activities',
  {
    id: char('id', { length: 36 }).primaryKey(),
    organizerMemberId: char('organizer_member_id', { length: 36 })
      .notNull()
      .references(() => members.id, {
        onDelete: 'restrict',
        onUpdate: 'restrict',
      }),
    title: varchar('title', { length: 200 }).notNull(),
    description: text('description').notNull(),
    coverUrl: varchar('cover_url', { length: 2048 }),
    location: varchar('location', { length: 500 }).notNull(),
    consultationContact: text('consultation_contact').notNull(),
    startsAt: datetime('starts_at', { mode: 'date', fsp: 3 }).notNull(),
    endsAt: datetime('ends_at', { mode: 'date', fsp: 3 }).notNull(),
    registrationDeadline: datetime('registration_deadline', {
      mode: 'date',
      fsp: 3,
    }),
    capacity: int('capacity', { unsigned: true }),
    activeRegistrationCount: int('active_registration_count', {
      unsigned: true,
    })
      .notNull()
      .default(0),
    cancellationRegistrationCount: int('cancellation_registration_count', {
      unsigned: true,
    }),
    hasRegistrationEver: boolean('has_registration_ever')
      .notNull()
      .default(false),
    feeType: mysqlEnum('fee_type', ['free', 'paid']).notNull(),
    feeAmountCents: int('fee_amount_cents', { unsigned: true }),
    lifecycle: mysqlEnum('lifecycle', ['draft', 'published', 'cancelled'])
      .notNull()
      .default('draft'),
    moderation: mysqlEnum('moderation', ['normal', 'removed'])
      .notNull()
      .default('normal'),
    publishedAt: datetime('published_at', { mode: 'date', fsp: 3 }),
    cancelledAt: datetime('cancelled_at', { mode: 'date', fsp: 3 }),
    cancellationReason: text('cancellation_reason'),
    createdAt: datetime('created_at', { mode: 'date', fsp: 3 })
      .notNull()
      .default(sql`CURRENT_TIMESTAMP(3)`),
    updatedAt: timestamp('updated_at', { mode: 'date', fsp: 3 })
      .notNull()
      .default(sql`CURRENT_TIMESTAMP(3)`)
      .$onUpdate(() => new Date()),
  },
  (table) => [
    index('activities_organizer_member_id_idx').on(table.organizerMemberId),
    index('activities_public_list_idx').on(
      table.lifecycle,
      table.moderation,
      table.startsAt,
    ),
    check('activities_time_order_ck', sql`${table.endsAt} > ${table.startsAt}`),
    check(
      'activities_registration_deadline_ck',
      sql`${table.registrationDeadline} is null or ${table.registrationDeadline} <= ${table.startsAt}`,
    ),
    check(
      'activities_capacity_ck',
      sql`${table.capacity} is null or ${table.capacity} > 0`,
    ),
    check(
      'activities_active_count_ck',
      sql`${table.activeRegistrationCount} >= 0 and (${table.capacity} is null or ${table.activeRegistrationCount} <= ${table.capacity})`,
    ),
    check(
      'activities_fee_ck',
      sql`(${table.feeType} = 'free' and ${table.feeAmountCents} is null) or (${table.feeType} = 'paid' and ${table.feeAmountCents} is not null and ${table.feeAmountCents} > 0)`,
    ),
    check(
      'activities_cancellation_ck',
      sql`(${table.lifecycle} = 'cancelled' and ${table.cancelledAt} is not null and ${table.cancellationReason} is not null and ${table.cancellationRegistrationCount} is not null) or (${table.lifecycle} <> 'cancelled' and ${table.cancellationRegistrationCount} is null)`,
    ),
  ],
)

export const registrationQuestions = mysqlTable(
  'registration_questions',
  {
    id: char('id', { length: 36 }).primaryKey(),
    activityId: char('activity_id', { length: 36 })
      .notNull()
      .references(() => activities.id, {
        onDelete: 'cascade',
        onUpdate: 'restrict',
      }),
    type: mysqlEnum('type', ['short_text', 'long_text', 'single', 'multiple'])
      .notNull(),
    prompt: text('prompt').notNull(),
    required: boolean('required').notNull().default(false),
    sortOrder: int('sort_order', { unsigned: true }).notNull(),
    options: json('options').$type<string[]>(),
    createdAt: datetime('created_at', { mode: 'date', fsp: 3 })
      .notNull()
      .default(sql`CURRENT_TIMESTAMP(3)`),
    updatedAt: timestamp('updated_at', { mode: 'date', fsp: 3 })
      .notNull()
      .default(sql`CURRENT_TIMESTAMP(3)`)
      .$onUpdate(() => new Date()),
  },
  (table) => [
    index('registration_questions_activity_sort_idx').on(
      table.activityId,
      table.sortOrder,
    ),
  ],
)

export const activityOperations = mysqlTable(
  'activity_operations',
  {
    id: char('id', { length: 36 }).primaryKey(),
    activityId: char('activity_id', { length: 36 })
      .notNull()
      .references(() => activities.id, {
        onDelete: 'cascade',
        onUpdate: 'restrict',
      }),
    actorType: mysqlEnum('actor_type', ['member', 'admin']).notNull(),
    actorMemberId: char('actor_member_id', { length: 36 }).references(
      () => members.id,
      { onDelete: 'restrict', onUpdate: 'restrict' },
    ),
    actorAdminAccountId: char('actor_admin_account_id', {
      length: 36,
    }).references(() => adminAccounts.id, {
      onDelete: 'restrict',
      onUpdate: 'restrict',
    }),
    action: mysqlEnum('action', [
      'publish',
      'cancel',
      'remove',
      'restore',
      'update_consultation_contact',
    ]).notNull(),
    reason: text('reason'),
    changeSummary: json('change_summary').$type<Record<string, unknown>>(),
    createdAt: datetime('created_at', { mode: 'date', fsp: 3 })
      .notNull()
      .default(sql`CURRENT_TIMESTAMP(3)`),
  },
  (table) => [
    index('activity_operations_activity_created_at_idx').on(
      table.activityId,
      table.createdAt,
    ),
    check(
      'activity_operations_actor_ck',
      sql`(${table.actorType} = 'member' and ${table.actorMemberId} is not null and ${table.actorAdminAccountId} is null) or (${table.actorType} = 'admin' and ${table.actorAdminAccountId} is not null and ${table.actorMemberId} is null)`,
    ),
    check(
      'activity_operations_reason_ck',
      sql`${table.action} not in ('cancel', 'remove', 'restore') or ${table.reason} is not null`,
    ),
  ],
)
