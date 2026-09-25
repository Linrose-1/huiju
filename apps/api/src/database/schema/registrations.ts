import { sql } from 'drizzle-orm'
import {
  boolean,
  char,
  check,
  datetime,
  index,
  json,
  mysqlEnum,
  mysqlTable,
  timestamp,
  uniqueIndex,
  varchar,
} from 'drizzle-orm/mysql-core'
import { activities, registrationQuestions } from './activities.js'
import { members } from './members.js'

export const registrations = mysqlTable(
  'registrations',
  {
    id: char('id', { length: 36 }).primaryKey(),
    activityId: char('activity_id', { length: 36 })
      .notNull()
      .references(() => activities.id, {
        onDelete: 'cascade',
        onUpdate: 'restrict',
      }),
    memberId: char('member_id', { length: 36 })
      .notNull()
      .references(() => members.id, {
        onDelete: 'restrict',
        onUpdate: 'restrict',
      }),
    status: mysqlEnum('status', ['active', 'cancelled'])
      .notNull()
      .default('active'),
    contactPhone: varchar('contact_phone', { length: 32 }).notNull(),
    firstRegisteredAt: datetime('first_registered_at', {
      mode: 'date',
      fsp: 3,
    }).notNull(),
    currentRegisteredAt: datetime('current_registered_at', {
      mode: 'date',
      fsp: 3,
    }).notNull(),
    cancelledAt: datetime('cancelled_at', { mode: 'date', fsp: 3 }),
    attended: boolean('attended').notNull().default(false),
    attendedAt: datetime('attended_at', { mode: 'date', fsp: 3 }),
    attendanceMarkedByMemberId: char('attendance_marked_by_member_id', {
      length: 36,
    }).references(() => members.id, {
      onDelete: 'restrict',
      onUpdate: 'restrict',
    }),
    createdAt: datetime('created_at', { mode: 'date', fsp: 3 })
      .notNull()
      .default(sql`CURRENT_TIMESTAMP(3)`),
    updatedAt: timestamp('updated_at', { mode: 'date', fsp: 3 })
      .notNull()
      .default(sql`CURRENT_TIMESTAMP(3)`)
      .$onUpdate(() => new Date()),
  },
  (table) => [
    uniqueIndex('registrations_activity_member_uq').on(
      table.activityId,
      table.memberId,
    ),
    index('registrations_activity_status_idx').on(
      table.activityId,
      table.status,
    ),
    index('registrations_member_status_idx').on(table.memberId, table.status),
    check(
      'registrations_status_ck',
      sql`(${table.status} = 'active' and ${table.cancelledAt} is null) or (${table.status} = 'cancelled' and ${table.cancelledAt} is not null)`,
    ),
    check(
      'registrations_attendance_ck',
      sql`(${table.attended} = false and ${table.attendedAt} is null and ${table.attendanceMarkedByMemberId} is null) or (${table.attended} = true and ${table.attendedAt} is not null and ${table.attendanceMarkedByMemberId} is not null)`,
    ),
  ],
)

export const registrationAnswers = mysqlTable(
  'registration_answers',
  {
    id: char('id', { length: 36 }).primaryKey(),
    registrationId: char('registration_id', { length: 36 })
      .notNull()
      .references(() => registrations.id, {
        onDelete: 'cascade',
        onUpdate: 'restrict',
      }),
    questionId: char('question_id', { length: 36 })
      .notNull()
      .references(() => registrationQuestions.id, {
        onDelete: 'restrict',
        onUpdate: 'restrict',
      }),
    answer: json('answer').$type<string | string[]>().notNull(),
    createdAt: datetime('created_at', { mode: 'date', fsp: 3 })
      .notNull()
      .default(sql`CURRENT_TIMESTAMP(3)`),
    updatedAt: timestamp('updated_at', { mode: 'date', fsp: 3 })
      .notNull()
      .default(sql`CURRENT_TIMESTAMP(3)`)
      .$onUpdate(() => new Date()),
  },
  (table) => [
    uniqueIndex('registration_answers_registration_question_uq').on(
      table.registrationId,
      table.questionId,
    ),
  ],
)

export const registrationOperations = mysqlTable(
  'registration_operations',
  {
    id: char('id', { length: 36 }).primaryKey(),
    registrationId: char('registration_id', { length: 36 })
      .notNull()
      .references(() => registrations.id, {
        onDelete: 'cascade',
        onUpdate: 'restrict',
      }),
    actorMemberId: char('actor_member_id', { length: 36 })
      .notNull()
      .references(() => members.id, {
        onDelete: 'restrict',
        onUpdate: 'restrict',
      }),
    action: mysqlEnum('action', [
      'registered',
      'cancelled',
      'reregistered',
    ]).notNull(),
    createdAt: datetime('created_at', { mode: 'date', fsp: 3 })
      .notNull()
      .default(sql`CURRENT_TIMESTAMP(3)`),
  },
  (table) => [
    index('registration_operations_registration_created_at_idx').on(
      table.registrationId,
      table.createdAt,
    ),
  ],
)
