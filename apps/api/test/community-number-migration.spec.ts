import { readFileSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import { expect, it } from 'vitest'

const migration = readFileSync(new URL('../drizzle/0023_community_user_numbers.sql', import.meta.url), 'utf8')
const population = migration.split('--> statement-breakpoint').map(sql => sql.replace(/^--.*$/gm, '').trim())
  .filter(sql => /^INSERT INTO `(?:communities|community_members)`/.test(sql))

it('numbers only ordinary users in registration order across Shanghai year/month boundaries and timestamp ties', () => {
  const db = new DatabaseSync(':memory:')
  try {
    // Run the migration's two actual inserts against a SQL fixture; translate MySQL date syntax.
    db.function('year', value => Number(String(value).slice(0, 4)))
    db.function('month', value => Number(String(value).slice(5, 7)))
    db.function('lpad', (value, length, fill) => String(value).padStart(Number(length), String(fill)))
    db.exec(`
      create table members(id text, kind text, created_at text);
      create table communities(id text, name text, number_prefix text, last_sequence integer);
      create table community_members(community_id text, member_id text, sequence_no integer, user_number text, joined_at text);
      insert into members values
        ('root','platform_root','2018-01-01 00:00:00.000'),
        ('c','member','2025-12-31 16:00:00.000'),
        ('b','member','2025-12-31 16:00:00.000'),
        ('a','member','2020-12-31 15:59:59.999'),
        ('d','member','2026-01-31 16:00:00.000');
    `)
    for (const sql of population) db.exec(sql.replace('DATE_ADD(created_at, INTERVAL 8 HOUR)', "datetime(created_at, '+8 hours')"))
    expect(db.prepare('select last_sequence from communities').get()?.last_sequence).toBe(4)
    expect(db.prepare('select member_id, user_number from community_members order by sequence_no').all()).toEqual([
      { member_id: 'a', user_number: 'XJBJL000001' },
      { member_id: 'b', user_number: 'XJBFA000002' },
      { member_id: 'c', user_number: 'XJBFA000003' },
      { member_id: 'd', user_number: 'XJBFB000004' },
    ])
    expect(db.prepare('select joined_at from community_members where member_id = ?').get('a')?.joined_at)
      .toBe('2020-12-31 15:59:59.999')
  } finally { db.close() }
})
