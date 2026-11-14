import { Injectable } from '@nestjs/common'
import { and, count, desc, eq, or, sql } from 'drizzle-orm'
import { members } from '../database/schema/members.js'
import { fail } from '../flow/common.js'
import { complete, type Member } from '../flow/identity.js'
import { AdminMemberDetailDto, AdminMemberListDto, AdminMemberQuery, AdminMemberSummaryDto } from './member-dto.js'
import type { AdminTransaction } from './service.js'

function summary(member: Member): AdminMemberSummaryDto {
  return { id: member.id, memberNumber: member.memberNumber, displayName: member.displayName,
    realName: member.realName, boundPhone: member.boundPhone, profileComplete: complete(member), createdAt: member.createdAt.toISOString() }
}

@Injectable()
export class AdminMemberService {
  async list(tx: AdminTransaction, query: AdminMemberQuery): Promise<AdminMemberListDto> {
    const conditions = [eq(members.kind, 'member')]
    if (query.inviterId) conditions.push(eq(members.inviterMemberId, query.inviterId))
    if (query.q) conditions.push(or(...[members.memberNumber, members.displayName, members.realName, members.boundPhone]
      .map(field => sql`locate(${query.q}, ${field}) > 0`))!)
    if (query.profile !== 'all') {
      const isComplete = sql`coalesce(${members.boundPhone}, '') <> '' and coalesce(${members.avatarUrl}, '') <> '' and coalesce(${members.displayName}, '') regexp '[^[:space:]]' and ${members.avatarSetByUser} = true and ${members.nameSetByUser} = true`
      conditions.push(query.profile === 'complete' ? sql`(${isComplete})` : sql`not (${isComplete})`)
    }
    const where = and(...conditions)
    const [total] = await tx.select({ value: count() }).from(members).where(where)
    const rows = await tx.select().from(members).where(where).orderBy(desc(members.createdAt), desc(members.id)).limit(40).offset(query.offset)
    return { items: rows.map(summary), total: Number(total!.value), hasMore: query.offset + rows.length < Number(total!.value) }
  }

  async detail(tx: AdminTransaction, id: string): Promise<AdminMemberDetailDto> {
    const [member] = await tx.select().from(members).where(and(eq(members.id, id), eq(members.kind, 'member')))
    if (!member || member.kind !== 'member') fail('MEMBER_NOT_FOUND', '会员不存在', 404)
    const [inviter] = member.inviterMemberId ? await tx.select({ id: members.id, memberNumber: members.memberNumber, displayName: members.displayName, kind: members.kind }).from(members).where(eq(members.id, member.inviterMemberId)) : []
    const [invitees] = await tx.select({ value: count() }).from(members).where(and(eq(members.inviterMemberId, id), eq(members.kind, 'member')))
    return { ...summary(member), avatarUrl: member.avatarUrl, email: member.email, hometown: member.hometown,
      resources: member.resources, needs: member.needs, bio: member.bio, inviteCode: member.inviteCode,
      inviter: inviter ? { id: inviter.id, memberNumber: inviter.memberNumber, displayName: inviter.displayName, kind: inviter.kind } : null,
      inviteeCount: Number(invitees!.value) }
  }
}
