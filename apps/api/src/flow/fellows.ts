import { Injectable } from '@nestjs/common'
import { and, asc, count, eq, sql } from 'drizzle-orm'
import { activities } from '../database/schema/activities.js'
import { registrations } from '../database/schema/registrations.js'
import { members } from '../database/schema/members.js'
import { fail, FlowDatabase } from './common.js'
import { complete, IdentityService, type Member } from './identity.js'
import { ConnectionPathDto, ConnectionQuery, FellowListDto, FellowSummaryDto } from './fellows-dto.js'
import { PageQuery } from './pagination.js'
import { attendedForCount, publishedForCount } from './leaderboard.js'
import { fellowTags } from './fellow-profile.js'

const relationFields = {
  id: members.id, kind: members.kind, inviterMemberId: members.inviterMemberId,
  displayName: members.displayName, avatarUrl: members.avatarUrl, boundPhone: members.boundPhone,
  avatarSetByUser: members.avatarSetByUser, nameSetByUser: members.nameSetByUser,
}
export type RelationMember = Pick<Member, keyof typeof relationFields>

export function fellowSummary(member: RelationMember): FellowSummaryDto {
  const visible = complete(member)
  return { memberId: visible ? member.id : null, displayName: visible ? member.displayName! : '待完善资料的学友', avatarUrl: visible ? member.avatarUrl : null, canOpenCard: visible }
}

function incomplete(): never { fail('RELATIONSHIP_INCOMPLETE', '学友关系数据异常，暂时无法完整展示', 409) }

// Only walk the two ancestor chains. Validate each to the platform boundary so
// a common node inside a corrupt cycle cannot masquerade as a complete path.
export async function connectionMembers(source: RelationMember, target: RelationMember, load: (id: string) => Promise<RelationMember | undefined>): Promise<RelationMember[]> {
  const cache = new Map<string, RelationMember>([[source.id, source], [target.id, target]])
  const ancestors = async (start: RelationMember) => {
    const chain: RelationMember[] = []
    const visited = new Set<string>()
    let current = start
    while (current.kind !== 'platform_root') {
      if (visited.has(current.id)) incomplete()
      visited.add(current.id)
      chain.push(current)
      if (!current.inviterMemberId) incomplete()
      const parent = cache.get(current.inviterMemberId) ?? await load(current.inviterMemberId)
      if (!parent) incomplete()
      cache.set(parent.id, parent)
      current = parent
    }
    if (current.inviterMemberId !== null) incomplete()
    return chain
  }
  const left = await ancestors(source)
  const right = await ancestors(target)
  const leftPositions = new Map(left.map((node, index) => [node.id, index]))
  const common = right.findIndex(node => leftPositions.has(node.id))
  if (common < 0) return []
  return [...left.slice(0, leftPositions.get(right[common].id)! + 1), ...right.slice(0, common).reverse()]
}

export function connectionPage(source: RelationMember, target: RelationMember, path: RelationMember[], query: ConnectionQuery): ConnectionPathDto {
  const end = Math.min(path.length, query.cursor + query.limit)
  const nodes = path.slice(query.cursor, end).map((member, offset) => ({ index: query.cursor + offset, member: fellowSummary(member) }))
  const edges = nodes.filter(node => node.index > 0).map(({ index }) => {
    const forward = path[index].inviterMemberId === path[index - 1].id
    return { fromIndex: forward ? index - 1 : index, toIndex: forward ? index : index - 1 }
  })
  return { source: fellowSummary(source), target: fellowSummary(target), connected: path.length > 0, totalNodes: path.length, nodes, edges, nextCursor: end < path.length ? end : null }
}

@Injectable()
export class FellowsService {
  constructor(private readonly database: FlowDatabase, private readonly identity: IdentityService) {}

  private async caller(header?: string) {
    const member = (await this.identity.require(header))!
    if (!complete(member)) fail('PROFILE_INCOMPLETE', '请先完善手机号、头像和用户名称', 403)
    return member
  }

  private async find(id: string) {
    return (await this.database.db.select(relationFields).from(members).where(eq(members.id, id)).limit(1))[0]
  }

  async list(query: PageQuery, header?: string): Promise<FellowListDto> {
    const caller = await this.caller(header)
    if (!caller.inviterMemberId) incomplete()
    const inviter = await this.find(caller.inviterMemberId)
    if (!inviter || inviter.id === caller.id) incomplete()
    const condition = and(eq(members.inviterMemberId, caller.id), eq(members.kind, 'member'))
    const [totals] = await this.database.db.select({ total: count() }).from(members).where(condition)
    // The two indexed, correlated counts do not multiply rows or alter pagination.
    const rows = await this.database.db.select({
      ...relationFields, industry: members.industry, schools: members.schools, hometownCityCode: members.hometownCityCode,
      attendanceCount: sql<number>`(select count(*) from ${registrations} join ${activities} on ${eq(registrations.activityId, activities.id)}
        where ${and(eq(registrations.memberId, members.id), attendedForCount)})`.mapWith(Number),
      organizedCount: sql<number>`(select count(*) from ${activities}
        where ${and(eq(activities.organizerMemberId, members.id), publishedForCount)})`.mapWith(Number),
    }).from(members).where(condition)
      .orderBy(asc(members.createdAt), asc(members.id)).limit(query.limit + 1).offset(query.offset)
    const items = rows.slice(0, query.limit).map(row => {
      const summary = fellowSummary(row)
      return { ...summary, tags: summary.canOpenCard ? fellowTags(caller, row) : [],
        attendanceCount: summary.canOpenCard ? row.attendanceCount : 0,
        organizedCount: summary.canOpenCard ? row.organizedCount : 0 }
    })
    return { inviter: inviter.kind === 'platform_root' ? null : fellowSummary(inviter), items, total: Number(totals.total), hasMore: rows.length > query.limit }
  }

  async path(id: string, query: ConnectionQuery, header?: string): Promise<ConnectionPathDto> {
    const caller = await this.caller(header)
    const target = await this.find(id)
    if (!target || target.kind !== 'member') fail('NOT_FOUND', '学友不存在', 404)
    const path = await connectionMembers(caller, target, memberId => this.find(memberId))
    return connectionPage(caller, target, path, query)
  }
}
