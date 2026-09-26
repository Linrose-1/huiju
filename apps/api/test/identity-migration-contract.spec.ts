import { readFile } from 'node:fs/promises'
import { expect, it } from 'vitest'
import { wechatIdentities } from '../src/database/schema/members.js'

it('keeps opaque WeChat identifiers case-sensitive in schema and migration', async () => {
  const migration = await readFile(
    new URL('../drizzle/0002_wechat_identity_case_sensitive.sql', import.meta.url),
    'utf8',
  )
  const statements = migration
    .split('--> statement-breakpoint')
    .map((statement) => statement.trim())
  const columns = [
    { column: wechatIdentities.appId, length: 64, required: true },
    { column: wechatIdentities.openId, length: 128, required: true },
    { column: wechatIdentities.unionId, length: 128, required: false },
  ]

  expect(statements).toHaveLength(columns.length)
  for (const { column, length, required } of columns) {
    expect(column.getSQLType()).toBe(
      `varchar(${length}) character set utf8mb4 collate utf8mb4_0900_bin`,
    )
    expect(statements).toContain(
      `ALTER TABLE \`wechat_identities\` MODIFY COLUMN \`${column.name}\` ${column.getSQLType()}${required ? ' NOT NULL' : ''};`,
    )
    for (const value of ['AbC', 'abc']) {
      expect(column.mapToDriverValue(value)).toBe(value)
      expect(column.mapFromDriverValue(value)).toBe(value)
    }
  }
})
