import { Injectable } from '@nestjs/common'
import { and, asc, count, eq } from 'drizzle-orm'
import { communityMembers } from '../database/schema/communities.js'
import { members } from '../database/schema/members.js'
import { fail, FlowDatabase } from './common.js'
import { complete, IdentityService } from './identity.js'
import { DEFAULT_COMMUNITY_ID } from './member-number.js'
import type { CommunityAccessDto, CommunityRosterDto, CommunityRosterMemberDto } from './community-roster-dto.js'
import type { PageQuery } from './pagination.js'

const inCommunity = eq(communityMembers.communityId, DEFAULT_COMMUNITY_ID)
const membership = (id: string) => and(inCommunity, eq(communityMembers.memberId, id))
const rowFields = {
  memberId: communityMembers.memberId, userNumber: communityMembers.userNumber,
  displayName: members.displayName, avatarUrl: members.avatarUrl, isRegistered: communityMembers.isRegistered,
}

@Injectable()
export class CommunityRosterService {
  constructor(private readonly database: FlowDatabase, private readonly identity: IdentityService) {}

  private async caller(header?: string) {
    const caller = (await this.identity.require(header))!
    if (!complete(caller)) fail('PROFILE_INCOMPLETE', '请先完善手机号、头像和用户名称', 403)
    return caller.id
  }

  async access(header?: string): Promise<CommunityAccessDto> {
    const callerId = await this.caller(header)
    const [relation] = await this.database.db.select({ isAdmin: communityMembers.isAdmin, isRegistered: communityMembers.isRegistered })
      .from(communityMembers).where(membership(callerId)).limit(1)
    return relation ?? { isAdmin: false, isRegistered: false }
  }

  async list(query: PageQuery, header?: string): Promise<CommunityRosterDto> {
    if (!(await this.access(header)).isAdmin) fail('COMMUNITY_ADMIN_REQUIRED', '仅本社群管理员可管理成员', 403)
    const db = this.database.db
    const [items, [summary]] = await Promise.all([
      db.select(rowFields).from(communityMembers).innerJoin(members, eq(members.id, communityMembers.memberId))
        .where(inCommunity).orderBy(asc(communityMembers.sequenceNo)).limit(query.limit).offset(query.offset),
      db.select({ total: count() }).from(communityMembers).where(inCommunity),
    ])
    return { items, total: summary.total }
  }

  async recognize(targetId: string, isRegistered: boolean, header?: string): Promise<CommunityRosterMemberDto> {
    const callerId = await this.caller(header)
    return this.database.db.transaction(async tx => {
      const [actor] = await tx.select({ isAdmin: communityMembers.isAdmin }).from(communityMembers)
        .where(membership(callerId)).limit(1).for('update')
      if (!actor?.isAdmin) fail('COMMUNITY_ADMIN_REQUIRED', '仅本社群管理员可管理成员', 403)
      const [target] = await tx.select(rowFields).from(communityMembers).innerJoin(members, eq(members.id, communityMembers.memberId))
        .where(membership(targetId)).limit(1).for('update')
      if (!target) fail('COMMUNITY_MEMBER_NOT_FOUND', '在本社群找不到这位用户', 404)
      if (target.isRegistered !== isRegistered) {
        await tx.update(communityMembers).set({ isRegistered }).where(membership(targetId))
      }
      return { ...target, isRegistered }
    })
  }
}
