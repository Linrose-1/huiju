import { sql } from 'drizzle-orm'
import {
  type AnyMySqlColumn,
  boolean,
  char,
  check,
  customType,
  datetime,
  index,
  mysqlEnum,
  mysqlTable,
  text,
  timestamp,
  uniqueIndex,
  varchar,
} from 'drizzle-orm/mysql-core'

// 外部身份标识按原始字符精确匹配，不继承数据库的大小写不敏感排序规则。
const identityVarchar = customType<{
  data: string
  driverData: string
  config: { length: number }
  configRequired: true
}>({
  dataType: ({ length }) =>
    `varchar(${length}) character set utf8mb4 collate utf8mb4_0900_bin`,
})

export const members = mysqlTable(
  'members',
  {
    id: char('id', { length: 36 }).primaryKey(),
    kind: mysqlEnum('kind', ['member', 'platform_root'])
      .notNull()
      .default('member'),
    memberNumber: varchar('member_number', { length: 32 }).notNull(),
    inviteCode: varchar('invite_code', { length: 32 }).notNull(),
    inviterMemberId: char('inviter_member_id', { length: 36 }).references(
      (): AnyMySqlColumn => members.id,
      { onDelete: 'restrict', onUpdate: 'restrict' },
    ),
    avatarUrl: varchar('avatar_url', { length: 2048 }),
    displayName: varchar('display_name', { length: 100 }),
    avatarSetByUser: boolean('avatar_set_by_user').notNull().default(false),
    nameSetByUser: boolean('name_set_by_user').notNull().default(false),
    boundPhone: varchar('bound_phone', { length: 32 }),
    realName: varchar('real_name', { length: 100 }),
    email: varchar('email', { length: 320 }),
    hometown: varchar('hometown', { length: 100 }),
    resources: text('resources'),
    needs: text('needs'),
    bio: text('bio'),
    createdAt: datetime('created_at', { mode: 'date', fsp: 3 })
      .notNull()
      .default(sql`CURRENT_TIMESTAMP(3)`),
    updatedAt: timestamp('updated_at', { mode: 'date', fsp: 3 })
      .notNull()
      .default(sql`CURRENT_TIMESTAMP(3)`)
      .$onUpdate(() => new Date()),
  },
  (table) => [
    uniqueIndex('members_member_number_uq').on(table.memberNumber),
    uniqueIndex('members_invite_code_uq').on(table.inviteCode),
    index('members_inviter_member_id_idx').on(table.inviterMemberId),
    check(
      'members_inviter_ck',
      sql`(${table.kind} = 'platform_root' and ${table.inviterMemberId} is null) or (${table.kind} = 'member' and ${table.inviterMemberId} is not null)`,
    ),
  ],
)

export const wechatIdentities = mysqlTable(
  'wechat_identities',
  {
    id: char('id', { length: 36 }).primaryKey(),
    memberId: char('member_id', { length: 36 })
      .notNull()
      .references(() => members.id, {
        onDelete: 'cascade',
        onUpdate: 'restrict',
      }),
    appId: identityVarchar('app_id', { length: 64 }).notNull(),
    openId: identityVarchar('open_id', { length: 128 }).notNull(),
    unionId: identityVarchar('union_id', { length: 128 }),
    createdAt: datetime('created_at', { mode: 'date', fsp: 3 })
      .notNull()
      .default(sql`CURRENT_TIMESTAMP(3)`),
  },
  (table) => [
    uniqueIndex('wechat_identities_member_id_uq').on(table.memberId),
    uniqueIndex('wechat_identities_app_id_open_id_uq').on(
      table.appId,
      table.openId,
    ),
    index('wechat_identities_union_id_idx').on(table.unionId),
  ],
)

export const memberVisibilities = mysqlTable('member_visibilities', {
  memberId: char('member_id', { length: 36 })
    .primaryKey()
    .references(() => members.id, {
      onDelete: 'cascade',
      onUpdate: 'restrict',
    }),
  showRealName: boolean('show_real_name').notNull().default(false),
  showEmail: boolean('show_email').notNull().default(false),
  showBoundPhone: boolean('show_bound_phone').notNull().default(false),
  showHometown: boolean('show_hometown').notNull().default(false),
  showResources: boolean('show_resources').notNull().default(false),
  showNeeds: boolean('show_needs').notNull().default(false),
  showBio: boolean('show_bio').notNull().default(false),
  updatedAt: timestamp('updated_at', { mode: 'date', fsp: 3 })
    .notNull()
    .default(sql`CURRENT_TIMESTAMP(3)`)
    .$onUpdate(() => new Date()),
})

export const memberSessions = mysqlTable(
  'member_sessions',
  {
    id: char('id', { length: 36 }).primaryKey(),
    memberId: char('member_id', { length: 36 })
      .notNull()
      .references(() => members.id, {
        onDelete: 'cascade',
        onUpdate: 'restrict',
      }),
    tokenHash: char('token_hash', { length: 64 }).notNull(),
    expiresAt: datetime('expires_at', { mode: 'date', fsp: 3 }).notNull(),
    revokedAt: datetime('revoked_at', { mode: 'date', fsp: 3 }),
    createdAt: datetime('created_at', { mode: 'date', fsp: 3 })
      .notNull()
      .default(sql`CURRENT_TIMESTAMP(3)`),
  },
  (table) => [
    uniqueIndex('member_sessions_token_hash_uq').on(table.tokenHash),
    index('member_sessions_member_id_expires_at_idx').on(
      table.memberId,
      table.expiresAt,
    ),
  ],
)

export const adminAccounts = mysqlTable('admin_accounts', {
  id: char('id', { length: 36 }).primaryKey(),
  displayName: varchar('display_name', { length: 100 }).notNull(),
  status: mysqlEnum('status', ['active', 'disabled'])
    .notNull()
    .default('active'),
  createdAt: datetime('created_at', { mode: 'date', fsp: 3 })
    .notNull()
    .default(sql`CURRENT_TIMESTAMP(3)`),
  updatedAt: timestamp('updated_at', { mode: 'date', fsp: 3 })
    .notNull()
    .default(sql`CURRENT_TIMESTAMP(3)`)
    .$onUpdate(() => new Date()),
})

export const adminSessions = mysqlTable(
  'admin_sessions',
  {
    id: char('id', { length: 36 }).primaryKey(),
    adminAccountId: char('admin_account_id', { length: 36 })
      .notNull()
      .references(() => adminAccounts.id, {
        onDelete: 'cascade',
        onUpdate: 'restrict',
      }),
    tokenHash: char('token_hash', { length: 64 }).notNull(),
    expiresAt: datetime('expires_at', { mode: 'date', fsp: 3 }).notNull(),
    revokedAt: datetime('revoked_at', { mode: 'date', fsp: 3 }),
    createdAt: datetime('created_at', { mode: 'date', fsp: 3 })
      .notNull()
      .default(sql`CURRENT_TIMESTAMP(3)`),
  },
  (table) => [
    uniqueIndex('admin_sessions_token_hash_uq').on(table.tokenHash),
    index('admin_sessions_account_id_expires_at_idx').on(
      table.adminAccountId,
      table.expiresAt,
    ),
  ],
)
