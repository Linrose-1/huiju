import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import { expect, it } from 'vitest'

const migration = readFileSync(new URL('../drizzle/0022_member_short_invite_codes.sql', import.meta.url), 'utf8')
const statements = migration.split('--> statement-breakpoint').map(sql => sql.replace(/^--.*$/gm, ''))

// Exercise the actual mapping, gates and join keys without access to a business DB.
// Only temporary table DDL and UPDATE JOIN syntax differ in this SQLite fixture.
function sqliteStatement(sql: string) {
  return sql.replace('ENGINE=InnoDB', '')
    .replace(/UPDATE (`\w+`) AS (\w+) JOIN (`\w+`) AS c ON ([^\n]+)\s+SET ([^;]+);/,
      (_, table: string, alias: string, mapping: string, join: string, fields: string) =>
        `UPDATE ${table} AS ${alias} SET ${fields.replace(/\b\w+\.(?=`\w+` =)/g, '')} FROM ${mapping} AS c WHERE ${join};`)
    .replace(/DROP TEMPORARY TABLE (`\w+`), (`\w+`);/, 'DROP TABLE temp.$1; DROP TABLE temp.$2;')
}

function fixture() {
  const db = new DatabaseSync(':memory:')
  db.function('regexp', (pattern, text) => Number(new RegExp(String(pattern)).test(String(text))))
  db.function('sha2', (text, bits) => createHash('sha' + bits).update(String(text)).digest('hex'))
  db.function('lpad', (text, length, padding) => String(text).padStart(Number(length), String(padding)))
  db.function('mod', (n, divisor) => Number(n) % Number(divisor))
  db.exec(`
    create table members(id text primary key, kind text, invite_code text unique, inviter_member_id text, updated_at text);
    create table activity_poster_shares(scene text primary key, member_id text, invite_code text);
    insert into members values ('root', 'platform_root', 'PLATFORM', null, 'old'),
      ('a', 'member', 'OLD_A', 'root', 'old'), ('b', 'member', 'OLD_B', 'a', 'old');
    insert into activity_poster_shares values ('scene_a','a','OLD_A'), ('scene_b','b','OLD_B');
  `)
  return db
}

function run(db: DatabaseSync) {
  db.exec('BEGIN')
  try {
    for (const sql of statements) db.exec(sqliteStatement(sql))
    db.exec('COMMIT')
  } catch (error) { db.exec('ROLLBACK'); throw error }
}

it('replaces member codes and existing poster snapshots together, preserving roots, invitation edges and timestamps', () => {
  const db = fixture()
  try {
    run(db)
    const rows = db.prepare('select * from members order by id').all()
    expect(rows[2]).toMatchObject({ id: 'root', invite_code: 'PLATFORM', inviter_member_id: null })
    expect(rows[0]).toMatchObject({ id: 'a', inviter_member_id: 'root', updated_at: 'old' })
    expect(rows[1]).toMatchObject({ id: 'b', inviter_member_id: 'a', updated_at: 'old' })
    expect(new Set(rows.slice(0, 2).map(r => r.invite_code))).toEqual(new Set(['048357', '056276']))
    expect(db.prepare('select scene, invite_code from activity_poster_shares order by scene').all()).toEqual([
      { scene: 'scene_a', invite_code: rows[0].invite_code }, { scene: 'scene_b', invite_code: rows[1].invite_code },
    ])
  } finally { db.close() }
})

it.each(['members', 'activity_poster_shares'])('aborts before overwriting a six-digit code in %s', table => {
  const db = fixture()
  try {
    db.exec(`update ${table} set invite_code='000123' where invite_code='OLD_A'`)
    expect(() => run(db)).toThrow(/unique/i)
    expect(db.prepare("select count(*) as total from members where invite_code='OLD_B'").get()).toEqual({ total: 1 })
    expect(db.prepare("select count(*) as total from activity_poster_shares where invite_code='OLD_B'").get()).toEqual({ total: 1 })
  } finally { db.close() }
})
