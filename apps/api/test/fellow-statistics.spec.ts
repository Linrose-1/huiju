import { DatabaseSync } from 'node:sqlite'
import { drizzle } from 'drizzle-orm/mysql-proxy'
import { expect, it } from 'vitest'
import { FellowsService } from '../src/flow/fellows.js'
import type { FlowDatabase } from '../src/flow/common.js'
import type { IdentityService } from '../src/flow/identity.js'

it('scopes matches and counts to the authenticated inviter and counts each actual event only once', async () => {
  const sqlite = new DatabaseSync(':memory:')
  try {
    sqlite.exec(`
      create table members(id text, kind text, inviter_member_id text, display_name text, avatar_url text, bound_phone text,
        avatar_set_by_user int, name_set_by_user int, industry text, schools text, hometown_city_code text, created_at text);
      create table registrations(activity_id text, member_id text, status text, attended int);
      create table activities(id text, organizer_member_id text, lifecycle text);
      insert into members values ('root','platform_root',null,'root','a','1',1,1,null,null,null,'1'),
        ('friend','member','me','青禾','a','2',1,1,'园区运营',null,'440100','2'),
        ('other','member','friend','其他','a','3',1,1,'园区运营',null,'440100','3');
      insert into activities values ('p','friend','published'),('d','friend','draft'),('c','friend','cancelled'),('p2','other','published');
      insert into registrations values ('p2','friend','active',1),('p','friend','active',0),('c','friend','active',1),('p','other','active',1);
    `)
    const db = drizzle(async (sql, params) => ({
      rows: sqlite.prepare(sql).all(...params.map(p => typeof p === 'boolean' ? Number(p) : p)).map(Object.values),
    }))
    const caller = { id: 'me', inviterMemberId: 'root', displayName: '我', avatarUrl: 'me', boundPhone: '1', avatarSetByUser: true, nameSetByUser: true,
      industry: '园区运营', schools: [], hometownCityCode: '440100' }
    const service = new FellowsService({ db } as unknown as FlowDatabase, { require: async () => caller } as unknown as IdentityService)
    const result = await service.list({ limit: 20, offset: 0 })
    expect(result.items).toEqual([{ memberId: 'friend', displayName: '青禾', avatarUrl: 'a', canOpenCard: true,
      tags: ['同行', '同乡'], attendanceCount: 1, organizedCount: 1 }])
    expect(result.total).toBe(1)
  } finally { sqlite.close() }
})
