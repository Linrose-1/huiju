import { Injectable } from '@nestjs/common'
import { sql, type SQL } from 'drizzle-orm'
import type { AdminTransaction } from './service.js'
import type { AnalyticsDashboardDto, AnalyticsMemberDto, AnalyticsMemberQuery, AnalyticsMetricDto } from './analytics-dto.js'
import { fail } from '../flow/common.js'

const DAY = 86400000
export function analyticsPeriod(days: number, now = new Date()) {
  const end = new Date(Math.floor((now.getTime() + 8 * 3600000) / DAY) * DAY - 8 * 3600000)
  return { start: new Date(end.getTime() - days * DAY), end, previous: new Date(end.getTime() - days * 2 * DAY) }
}
const dateLabel = (date: Date) => new Date(date.getTime() + 8 * 3600000).toISOString().slice(0, 10)
const dbDate = (date: Date) => date.toISOString().slice(0, 23).replace('T', ' ')
export function comparison(key: string, current: number, previous: number): AnalyticsMetricDto {
  return { key, current, previous, delta: current - previous, changePercent: previous ? Math.round((current - previous) / previous * 10000) / 100 : null }
}
// These are persisted successful actions, not the mutable current registration count.
export const analyticsEvents = sql`select v.member_id memberId, e.activity_id activityId, e.recorded_at eventTime, 'browse' behavior from reading_events e join reading_visitors v on v.visitor_hash=e.visitor_hash
union all select r.member_id, r.activity_id, o.created_at, 'register' from registration_operations o join registrations r on r.id=o.registration_id where o.action in ('registered','reregistered')
union all select r.member_id, r.activity_id, r.first_registered_at, 'register' from registrations r where not exists (select 1 from registration_operations o where o.registration_id=r.id and o.action in ('registered','reregistered'))
union all select r.member_id, r.activity_id, r.attended_at, 'attend' from registrations r join activities a on a.id=r.activity_id where r.attended=true and r.attended_at is not null and a.lifecycle<>'cancelled'
union all select organizer_member_id, id, published_at, 'publish' from activities where published_at is not null
union all select member_id, activity_id, created_at, 'comment' from activity_comments
union all select member_id, activity_id, created_at, 'review' from activity_reviews`

export async function analyticsRows<T>(tx: AdminTransaction, query: SQL): Promise<T[]> {
  const result = await tx.execute(query)
  return result[0] as unknown as T[]
}

@Injectable()
export class AnalyticsService {
  async events(tx: AdminTransaction, id: string, query: AnalyticsMemberQuery, now = new Date()) {
    const [member] = await analyticsRows<{ id: string }>(tx,sql`select id from members where id=${id} and kind='member' limit 1`)
    if (!member) fail('MEMBER_NOT_FOUND','会员不存在',404)
    const { start,end } = analyticsPeriod(query.days,now)
    const rows = await analyticsRows<{ behavior: string; activityId: string; activityTitle: string; occurredAt: string }>(tx,
      sql`with events as (${analyticsEvents}) select e.behavior,e.activityId,a.title activityTitle,date_format(e.eventTime,'%Y-%m-%dT%H:%i:%s.000Z') occurredAt
      from events e join activities a on a.id=e.activityId where e.memberId=${id} and e.eventTime>=${dbDate(start)} and e.eventTime<${dbDate(end)}
      order by e.eventTime desc,e.activityId desc,e.behavior desc limit 41 offset ${query.offset}`)
    return { items:rows.slice(0,40),hasMore:rows.length>40 }
  }
  private async totals(tx: AdminTransaction, start: Date, end: Date): Promise<Record<string, number>> {
    const [row] = await analyticsRows<Record<string, number>>(tx, sql`with events as (${analyticsEvents}), period as
      (select * from events where eventTime>=${dbDate(start)} and eventTime<${dbDate(end)}), recent as
      (select * from events where eventTime>=${dbDate(new Date(end.getTime()-30*DAY))} and eventTime<${dbDate(end)})
      select
      (select count(*) from members where kind='member' and created_at>=${dbDate(start)} and created_at<${dbDate(end)}) newMembers,
      count(distinct case when behavior='browse' then memberId end) browsingMembers,
      count(distinct case when behavior<>'browse' then memberId end) participatingMembers,
      count(distinct case when behavior='register' then memberId end) registeredMembers,
      count(distinct case when behavior='attend' then memberId end) attendedMembers,
      sum(behavior='publish') publishedActivities,
      count(case when behavior='browse' and memberId is null then 1 end) anonymousViews,
      (select count(distinct e.visitor_hash) from reading_events e join reading_visitors v on v.visitor_hash=e.visitor_hash
        where v.member_id is null and e.recorded_at>=${dbDate(start)} and e.recorded_at<${dbDate(end)}) anonymousVisitors,
      (select count(*) from members m where m.kind='member' and m.created_at<=${dbDate(new Date(end.getTime()-30*DAY))}
        and not exists(select 1 from recent e where e.memberId=m.id and e.behavior<>'browse')) inactiveMembers,
      (select count(*) from members m where m.kind='member' and m.created_at<=${dbDate(new Date(end.getTime()-30*DAY))}
        and not exists(select 1 from recent e where e.memberId=m.id)) silentMembers,
      (select count(distinct r.memberId) from period r where r.behavior='register' and exists
        (select 1 from period v where v.behavior='browse' and v.memberId=r.memberId and v.activityId=r.activityId and v.eventTime<r.eventTime)) convertedMembers
      from period`)
    const values = Object.fromEntries(Object.entries(row!).map(([key, value]) => [key, Number(value ?? 0)]))
    return { ...values, browseRegistrationRate: values.browsingMembers ? Math.round(values.convertedMembers! / values.browsingMembers * 10000)/100 : 0 }
  }

  async dashboard(tx: AdminTransaction, days: number, now = new Date()): Promise<AnalyticsDashboardDto> {
    const { start, end, previous } = analyticsPeriod(days, now)
    const current = await this.totals(tx, start, end)
    const prior = await this.totals(tx, previous, start)
    const trendRows = await analyticsRows<{ date: string; browsingMembers: number; participatingMembers: number }>(tx,
      sql`with events as (${analyticsEvents}) select date_format(date_add(eventTime, interval 8 hour),'%Y-%m-%d') \`date\`,
      count(distinct case when behavior='browse' then memberId end) browsingMembers,
      count(distinct case when behavior<>'browse' then memberId end) participatingMembers
      from events where eventTime>=${dbDate(start)} and eventTime<${dbDate(end)} group by \`date\``)
    const newRows = await analyticsRows<{ date: string; total: number }>(tx, sql`select date_format(date_add(created_at, interval 8 hour),'%Y-%m-%d') \`date\`, count(*) total
      from members where kind='member' and created_at>=${dbDate(start)} and created_at<${dbDate(end)} group by \`date\``)
    const behaviors = await analyticsRows<{ behavior: string; members: number; count: number }>(tx,
      sql`with events as (${analyticsEvents}) select behavior, count(distinct memberId) members, count(*) \`count\`
      from events where eventTime>=${dbDate(start)} and eventTime<${dbDate(end)} and behavior<>'browse' group by behavior`)
    return { days, startDate: dateLabel(start), endDate: dateLabel(new Date(end.getTime()-DAY)),
      metrics: Object.entries(current).map(([key, value]) => comparison(key, value, prior[key] ?? 0)),
      trend: Array.from({ length: days }, (_, index) => {
        const date = dateLabel(new Date(start.getTime()+index*DAY)), row = trendRows.find(item => item.date===date)
        return { date, newMembers: Number(newRows.find(item=>item.date===date)?.total ?? 0), browsingMembers: Number(row?.browsingMembers ?? 0), participatingMembers: Number(row?.participatingMembers ?? 0) }
      }), behaviors: ['register','attend','publish','comment','review'].map(behavior => {
        const row = behaviors.find(item=>item.behavior===behavior)
        return { behavior, members: Number(row?.members ?? 0), count: Number(row?.count ?? 0) }
      }), coverageNotes: ['阅读按当前访问者关联会员归属，匿名历史在登录关联后可能归入会员。', '报名使用成功操作历史；缺少历史的旧报名只按首次成功时间统计，无法还原未保存的重复报名。', '到场按当前保留的标记时间统计；评论和点评按首次创建时间统计，包含后续隐藏或删除的行为。', '浏览后报名要求本周期先浏览、后报名同一活动；浏览人数为零时请显示暂无浏览。'] }
  }

  async memberList(tx: AdminTransaction, query: AnalyticsMemberQuery, now = new Date()) {
    const { start, end } = analyticsPeriod(query.days, now)
    const complete = sql`coalesce(m.bound_phone,'')<>'' and coalesce(m.avatar_url,'')<>'' and trim(coalesce(m.display_name,''))<>'' and m.avatar_set_by_user=true and m.name_set_by_user=true`
    const conditions = [sql`m.kind='member' and m.created_at<${dbDate(end)}`]
    if (query.inviterId) conditions.push(sql`m.inviter_member_id=${query.inviterId}`)
    if (query.profile!=='all') conditions.push(query.profile==='complete' ? complete : sql`not (${complete})`)
    if (query.behavior==='new') conditions.push(sql`m.created_at>=${dbDate(start)}`)
    else if (query.behavior==='converted') conditions.push(sql`exists(select 1 from events r where r.memberId=m.id and r.behavior='register'
      and r.eventTime>=${dbDate(start)} and r.eventTime<${dbDate(end)} and exists(select 1 from events v where v.memberId=r.memberId
      and v.activityId=r.activityId and v.behavior='browse' and v.eventTime>=${dbDate(start)} and v.eventTime<r.eventTime))`)
    else if (query.behavior==='participate') conditions.push(sql`coalesce(a.participate,0)>0`)
    else if (query.behavior==='inactive' || query.behavior==='silent') conditions.push(sql`m.created_at<=${dbDate(new Date(end.getTime()-30*DAY))} and not exists
      (select 1 from events e where e.memberId=m.id and e.eventTime>=${dbDate(new Date(end.getTime()-30*DAY))} and e.eventTime<${dbDate(end)} ${query.behavior==='inactive' ? sql`and e.behavior<>'browse'` : sql``})`)
    else if (query.behavior!=='all') conditions.push(sql`exists(select 1 from events e where e.memberId=m.id and e.eventTime>=${dbDate(start)} and e.eventTime<${dbDate(end)} and e.behavior=${query.behavior})`)
    const cte = sql`with events as (${analyticsEvents}), aggregated as (select memberId,
      sum(behavior='browse') browse, sum(behavior='register') registerCount, sum(behavior='attend') attend,
      sum(behavior='publish') publishCount, sum(behavior='comment') commentCount, sum(behavior='review') reviewCount, sum(behavior<>'browse') participate
      from events where eventTime>=${dbDate(start)} and eventTime<${dbDate(end)} group by memberId), latest as
      (select memberId,max(eventTime) lastActiveAt from events where eventTime<${dbDate(end)} group by memberId)`
    const where = sql.join(conditions, sql` and `)
    const [totalRow] = await analyticsRows<{ total: number }>(tx, sql`${cte} select count(*) total from members m left join aggregated a on a.memberId=m.id where ${where}`)
    const rows = await analyticsRows<AnalyticsMemberDto>(tx, sql`${cte} select m.id, m.member_number memberNumber, m.display_name displayName,
      (${complete}) profileComplete, coalesce(a.browse,0) browse, coalesce(a.registerCount,0) \`register\`, coalesce(a.attend,0) attend,
      coalesce(a.publishCount,0) \`publish\`, coalesce(a.commentCount,0) \`comment\`, coalesce(a.reviewCount,0) \`review\`,
      date_format(l.lastActiveAt,'%Y-%m-%dT%H:%i:%s.000Z') lastActiveAt
      from members m left join aggregated a on a.memberId=m.id left join latest l on l.memberId=m.id
      where ${where} order by l.lastActiveAt desc,m.id desc limit 40 offset ${query.offset}`)
    const total = Number(totalRow!.total)
    return { items: rows.map(row => ({ ...row, profileComplete: Boolean(row.profileComplete), ...Object.fromEntries(['browse','register','attend','publish','comment','review'].map(key=>[key,Number(row[key as keyof AnalyticsMemberDto])])) })), total, hasMore: query.offset+rows.length<total }
  }
}
