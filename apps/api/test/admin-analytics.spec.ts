import { describe, expect, it, vi } from 'vitest'
import { MySqlDialect } from 'drizzle-orm/mysql-core'
import { DatabaseSync } from 'node:sqlite'
import { AnalyticsService, analyticsEvents, analyticsPeriod, comparison } from '../src/admin/analytics-service.js'
import { AnalyticsController, csvCell } from '../src/admin/analytics-controller.js'
import { AnalyticsMemberQuery } from '../src/admin/analytics-dto.js'
import type { AdminTransaction, AdminService } from '../src/admin/service.js'

describe('operational analytics rules',()=> {
  it('ends at Beijing midnight and uses two adjacent complete periods',()=> {
    const period = analyticsPeriod(7,new Date('2026-10-04T04:30:00Z'))
    expect(period).toEqual({ start:new Date('2026-09-26T16:00:00Z'),end:new Date('2026-10-03T16:00:00Z'),previous:new Date('2026-09-19T16:00:00Z') })
    expect(analyticsPeriod(7,new Date('2026-10-03T16:00:00Z'))).toEqual(period)
  })
  it('does not divide by zero in period comparisons',()=> {
    expect(comparison('new',3,0)).toMatchObject({ delta:3,changePercent:null })
    expect(comparison('active',4,8)).toMatchObject({ delta:-4,changePercent:-50 })
  })
  it('uses successful operation history without filtering cancelled registrations; fallback only when success history absent',()=> {
    const query = new MySqlDialect().sqlToQuery(analyticsEvents)
    expect(query.sql).toContain("o.action in ('registered','reregistered')")
    expect(query.sql).toContain('not exists')
    expect(query.sql).not.toContain("status='active'")
  })
  it('excludes attendance after activity cancellation while retaining successful registration history',()=> {
    const db = new DatabaseSync(':memory:')
    try {
      db.exec(`
        create table reading_visitors (visitor_hash text, member_id text);
        create table reading_events (visitor_hash text, activity_id text, recorded_at text);
        create table activities (id text, organizer_member_id text, published_at text, lifecycle text);
        create table registrations (id text, member_id text, activity_id text, status text, first_registered_at text, attended integer, attended_at text);
        create table registration_operations (registration_id text, action text, created_at text);
        create table activity_comments (member_id text, activity_id text, created_at text);
        create table activity_reviews (member_id text, activity_id text, created_at text);
        insert into activities values ('cancel-later','organizer',null,'published'),('keep','organizer',null,'published');
        insert into registrations values
          ('r1','member1','cancel-later','cancelled','2026-10-01 01:00:00',1,'2026-10-02 01:00:00'),
          ('r2','member2','keep','active','2026-10-01 01:00:00',1,'2026-10-02 01:00:00');
        insert into registration_operations values
          ('r1','registered','2026-10-01 01:00:00'),
          ('r1','reregistered','2026-10-01 02:00:00'),
          ('r1','cancelled','2026-10-01 03:00:00');
      `)
      const events = new MySqlDialect().sqlToQuery(analyticsEvents).sql
      const attendance = db.prepare(`with events as (${events}) select memberId from events where behavior='attend' order by memberId`)
      expect(attendance.all()).toEqual([{ memberId:'member1' },{ memberId:'member2' }])
      db.exec("update activities set lifecycle='cancelled' where id='cancel-later'")
      expect(attendance.all()).toEqual([{ memberId:'member2' }])
      expect(db.prepare(`with events as (${events}) select memberId,count(*) total from events where behavior='register' group by memberId order by memberId`).all())
        .toEqual([{ memberId:'member1',total:2 },{ memberId:'member2',total:1 }])
    } finally { db.close() }
  })
  it('requires earlier browsing of the same activity and zero-fills daily trend',async()=> {
    const execute = vi.fn().mockResolvedValueOnce([[{ browsingMembers:2,convertedMembers:1 }]])
      .mockResolvedValueOnce([[{ browsingMembers:0,convertedMembers:0 }]])
      .mockResolvedValueOnce([[]]).mockResolvedValueOnce([[]]).mockResolvedValueOnce([[]])
    const result = await new AnalyticsService().dashboard({ execute } as unknown as AdminTransaction,7,new Date('2026-10-04T04:30:00Z'))
    const query = new MySqlDialect().sqlToQuery(execute.mock.calls[0]![0])
    expect(query.sql).toContain('v.activityId=r.activityId and v.eventTime<r.eventTime')
    expect(result.metrics.find(metric=>metric.key==='browseRegistrationRate')).toMatchObject({ current:50,previous:0 })
    expect(result.trend).toHaveLength(7)
    expect(result.trend[0]).toEqual({ date:'2026-09-27',newMembers:0,browsingMembers:0,participatingMembers:0 })
  })
  it('inactive filtering always uses 30 days while behavior counts use selected period; pages exclude private fields',async()=> {
    const execute = vi.fn().mockResolvedValueOnce([[{ total:41 }]]).mockResolvedValueOnce([[{ id:'member',memberNumber:'HJ1',displayName:'name',profileComplete:1,browse:'2',register:'0',attend:'0',publish:'0',comment:'0',review:'0',lastActiveAt:null }]])
    const query = Object.assign(new AnalyticsMemberQuery(),{ days:7,behavior:'inactive',profile:'complete',inviterId:'source',offset:40 })
    const result = await new AnalyticsService().memberList({ execute } as unknown as AdminTransaction,query,new Date('2026-10-04T04:30:00Z'))
    const selection = new MySqlDialect().sqlToQuery(execute.mock.calls[1]![0])
    expect(selection.params).toContain('2026-09-03 16:00:00.000')
    expect(selection.params).toContain('2026-09-26 16:00:00.000')
    expect(selection.sql).toContain('limit 40 offset ?')
    expect(result).toMatchObject({ total:41,hasMore:false,items:[{ profileComplete:true,browse:2 }] })
    expect(result.items[0]).not.toHaveProperty('boundPhone')
  })
  it('exports all matching pages using only permitted fields and escapes formula cells',async()=> {
    const memberList = vi.fn().mockResolvedValueOnce({ items:[{ memberNumber:'HJ1',displayName:'=formula',browse:1,register:0,attend:0,publish:0,comment:0,review:0,lastActiveAt:null,boundPhone:'PRIVATE' }],hasMore:true })
      .mockResolvedValueOnce({ items:[],hasMore:false })
    const admin = { withSession: (_context:unknown,action:(tx:unknown)=>unknown)=>action({}) } as unknown as AdminService
    const result = await new AnalyticsController(admin,{ memberList } as unknown as AnalyticsService).export(new AnalyticsMemberQuery(),{ headers:{ cookie:'session' } })
    expect(result).toContain("'=formula")
    expect(result).not.toContain('PRIVATE')
    expect(memberList.mock.calls[1]![1].offset).toBe(40)
    expect(csvCell('hello,"world"')).toBe('"hello,""world"""')
  })
  it('member behavior detail rejects missing members and truncates the extra pagination row',async()=> {
    await expect(new AnalyticsService().events({ execute:vi.fn().mockResolvedValue([[]]) } as unknown as AdminTransaction,'missing',new AnalyticsMemberQuery())).rejects.toThrow('会员不存在')
    const execute = vi.fn().mockResolvedValueOnce([[{ id:'member' }]]).mockResolvedValueOnce([Array.from({ length:41 },()=>({ behavior:'register',activityId:'a',activityTitle:'title',occurredAt:'2026-10-01T00:00:00Z' }))])
    const result = await new AnalyticsService().events({ execute } as unknown as AdminTransaction,'member',new AnalyticsMemberQuery())
    expect(result.items).toHaveLength(40)
    expect(result.hasMore).toBe(true)
  })
  it.each(['new','converted'])('supports %s dashboard drill-down with period bounds',async behavior=> {
    const execute = vi.fn().mockResolvedValueOnce([[{ total:0 }]]).mockResolvedValueOnce([[]])
    await new AnalyticsService().memberList({ execute } as unknown as AdminTransaction,Object.assign(new AnalyticsMemberQuery(),{ days:7,behavior }),new Date('2026-10-04T04:30:00Z'))
    const query = new MySqlDialect().sqlToQuery(execute.mock.calls[0]![0])
    expect(query.params).toContain('2026-09-26 16:00:00.000')
    expect(query.params).toContain('2026-10-03 16:00:00.000')
    if (behavior==='new') expect(query.sql).toContain('m.created_at>=?')
    else {
      expect(query.sql).toContain('v.activityId=r.activityId')
      expect(query.sql).toContain('v.eventTime<r.eventTime')
      expect(query.sql).toContain("r.behavior='register'")
    }
  })
})
