import { DatabaseSync } from 'node:sqlite'
import { drizzle } from 'drizzle-orm/mysql-proxy'
import { expect, it } from 'vitest'
import { readLeaderboard } from '../src/flow/leaderboard.js'

it('ranks actual attendance and published activities, using separate Beijing-month dates and stable top 20', async () => {
  const sqlite = new DatabaseSync(':memory:')
  try {
    sqlite.exec(`
      create table members(id text, display_name text, avatar_url text, kind text, bound_phone text, name_set_by_user int, avatar_set_by_user int);
      create table activities(id text, organizer_member_id text, starts_at text, published_at text, lifecycle text);
      create table registrations(activity_id text, member_id text, status text, attended int);
    `)
    const member = sqlite.prepare("insert into members values (?, ?, 'avatar', 'member', '123', 1, 1)")
    const activity = sqlite.prepare('insert into activities values (?, ?, ?, ?, ?)')
    const attendance = sqlite.prepare('insert into registrations values (?, ?, ?, ?)')
    const start = '2026-10-31 16:00:00.000'
    const before = '2026-10-31 15:59:59.999'
    for (let i = 0; i < 22; i++) {
      const id = String(i).padStart(2, '0')
      member.run(id, id)
      activity.run(id, id, start, start, 'published')
    }
    activity.run('previous', '21', start, before, 'published')
    activity.run('cancelled', '21', start, start, 'cancelled')
    activity.run('draft', '21', start, null, 'draft')
    activity.run('december', '20', '2026-11-30 16:00:00.000', start, 'published')
    attendance.run('previous', '01', 'active', 1)
    attendance.run('01', '01', 'active', 1)
    attendance.run('02', '02', 'active', 0)
    attendance.run('01', '03', 'cancelled', 1)
    attendance.run('cancelled', '04', 'active', 1)
    attendance.run('december', '05', 'active', 1)
    sqlite.exec("update members set kind = 'platform_root' where id = '00'")
    const db = drizzle(async (sql, params) => ({
      rows: sqlite.prepare(sql).all(...params.map(p => typeof p === 'boolean' ? Number(p) : p)).map(Object.values),
    })) as unknown as Parameters<typeof readLeaderboard>[0]
    const now = new Date('2026-10-31T16:00:01Z')
    const monthly = await readLeaderboard(db, { period: 'month', kind: 'attendance' }, now)
    expect(monthly).toEqual({ month: '2026-11', items: [{ memberId: '01', displayName: '01', avatarUrl: 'avatar', count: 2 }] })
    const all = await readLeaderboard(db, { period: 'all', kind: 'attendance' }, now)
    expect(all.month).toBeNull()
    expect(all.items.map(row => [row.memberId, row.count])).toEqual([['01', 2], ['05', 1]])
    const organized = await readLeaderboard(db, { period: 'month', kind: 'organized' }, now)
    expect(organized.items).toHaveLength(20)
    expect(organized.items[0]).toMatchObject({ memberId: '20', count: 2 })
    expect(organized.items.slice(1).map(row => row.memberId)).toEqual(Array.from({ length: 19 }, (_, i) => String(i + 1).padStart(2, '0')))
    const lifetime = await readLeaderboard(db, { period: 'all', kind: 'organized' }, now)
    expect(lifetime.items.slice(0, 2).map(row => [row.memberId, row.count])).toEqual([['20', 2], ['21', 2]])
  } finally { sqlite.close() }
})
