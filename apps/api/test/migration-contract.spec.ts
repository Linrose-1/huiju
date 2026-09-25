import { readFile } from 'node:fs/promises'
import { expect, it } from 'vitest'

const migrationUrl = new URL(
  '../drizzle/0000_first_business_flow.sql',
  import.meta.url,
)

it('keeps the first migration aligned with the reviewed MySQL constraints', async () => {
  const sql = await readFile(migrationUrl, 'utf8')
  const timestampLines = sql
    .split('\n')
    .filter((line) => line.includes('timestamp(3)'))

  expect(timestampLines.length).toBeGreaterThan(0)
  expect(
    timestampLines.every((line) =>
      line.includes('DEFAULT CURRENT_TIMESTAMP(3)'),
    ),
  ).toBe(true)
  expect(sql).not.toContain('ON UPDATE CURRENT_TIMESTAMP')
  expect(sql).toContain(
    "`activities`.`fee_type` = 'paid' and `activities`.`fee_amount_cents` is not null and `activities`.`fee_amount_cents` > 0",
  )
  expect(sql).toContain('`cancellation_registration_count` int unsigned')
  expect(sql).toContain(
    '`activities`.`cancellation_registration_count` is not null',
  )
})
