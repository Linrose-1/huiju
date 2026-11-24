import { Injectable } from '@nestjs/common'
import { and, asc, count, eq } from 'drizzle-orm'
import { communities, communityMembers, rosterPermissionAudit } from '../database/schema/communities.js'
import { randomUUID } from 'node:crypto'
import type { RegistrationScope } from '../database/schema/activities.js'
import { members } from '../database/schema/members.js'
import { fail, FlowDatabase } from './common.js'
import { complete, IdentityService } from './identity.js'
import { DEFAULT_COMMUNITY_ID } from './member-number.js'
import type { CommunityAccessDto, CommunityPermissionListDto, CommunityPermissionsInput, CommunityRosterDto, CommunityRosterMemberDto } from './community-roster-dto.js'
import type { PageQuery } from './pagination.js'

const membership = (id: string, communityId = DEFAULT_COMMUNITY_ID) =>
  and(eq(communityMembers.communityId, communityId), eq(communityMembers.memberId, id))
type Tx = Parameters<Parameters<FlowDatabase['db']['transaction']>[0]>[0]

export async function requireGatheringMembership(tx: Tx, memberId: string, communityId = DEFAULT_COMMUNITY_ID) {
  if (!await isRegisteredInCommunity(tx, communityId, memberId, true)) fail('COMMUNITY_MEMBERSHIP_REQUIRED', '只有本社群在册会员可以发起聚会', 403)
}

async function isRegisteredInCommunity(db: Tx | FlowDatabase['db'], communityId: string, memberId: string, lock: boolean) {
  const query = db.select({ isRegistered: communityMembers.isRegistered })
    .from(communityMembers).where(membership(memberId, communityId))
  const [relation] = lock ? await query.for('share') : await query.limit(1)
  return relation?.isRegistered ?? false
}

type ScopedActivity = { communityId: string; registrationScope: RegistrationScope }
export async function registrationScopeEligible(db: Tx | FlowDatabase['db'], activity: ScopedActivity, memberId: string, lock = false) {
  if (!activity.registrationScope || activity.registrationScope === 'all') return true
  const registered = await isRegisteredInCommunity(db, activity.communityId, memberId, lock)
  return activity.registrationScope === 'registered' ? registered : !registered
}

export async function requireRegistrationScope(db: Tx | FlowDatabase['db'], activity: ScopedActivity, memberId: string, lock = false) {
  if (!await registrationScopeEligible(db, activity, memberId, lock)) {
    fail('REGISTRATION_SCOPE_MISMATCH', activity.registrationScope === 'registered' ? '本活动仅限本社群在册会员报名' : '本活动仅限本社群非在册用户报名', 403)
  }
}

const rowFields = {
  memberId: communityMembers.memberId, userNumber: communityMembers.userNumber,
  displayName: members.displayName, avatarUrl: members.avatarUrl, isRegistered: communityMembers.isRegistered,
}

const grantFields = { isAdmin: communityMembers.isAdmin, canViewRoster: communityMembers.canViewRoster }
const communityFields = { communityId: communities.id, communityName: communities.name }
function permissions(relation?: { isAdmin: boolean; canViewRoster: boolean }) {
  // Existing community admins retain both permissions, including on older app versions.
  return { canViewRoster: Boolean(relation?.isAdmin || relation?.canViewRoster), canRecognizeMembers: Boolean(relation?.isAdmin) }
}

@Injectable()
export class CommunityRosterService {
  constructor(private readonly database: FlowDatabase, private readonly identity: IdentityService) {}

  private async caller(header?: string) {
    const caller = (await this.identity.require(header))!
    if (!complete(caller)) fail('PROFILE_INCOMPLETE', '请先完善手机号、头像和用户名称', 403)
    return caller.id
  }

  async access(header?: string, communityId = DEFAULT_COMMUNITY_ID): Promise<CommunityAccessDto> {
    const callerId = await this.caller(header)
    const [relation] = await this.database.db.select({ ...grantFields, isRegistered: communityMembers.isRegistered })
      .from(communityMembers).where(membership(callerId, communityId)).limit(1)
    return { ...permissions(relation), isAdmin: relation?.isAdmin ?? false, isRegistered: relation?.isRegistered ?? false }
  }

  async list(query: PageQuery, header?: string, communityId = DEFAULT_COMMUNITY_ID): Promise<CommunityRosterDto> {
    const callerId = await this.caller(header)
    return this.database.db.transaction(async tx => {
      const [actor] = await tx.select(grantFields).from(communityMembers).where(membership(callerId, communityId)).for('share')
      const grant = permissions(actor)
      if (!grant.canViewRoster) fail('COMMUNITY_ADMIN_REQUIRED', '尚未获得本社群成员名单查看权限', 403)
      const inCommunity = eq(communityMembers.communityId, communityId)
      const items = await tx.select(rowFields).from(communityMembers).innerJoin(members, eq(members.id, communityMembers.memberId))
        .where(inCommunity).orderBy(asc(communityMembers.sequenceNo)).limit(query.limit).offset(query.offset)
      const [summary] = await tx.select({ total: count() }).from(communityMembers).where(inCommunity)
      return { items, total: summary.total, canRecognizeMembers: grant.canRecognizeMembers }
    })
  }

  async recognize(targetId: string, isRegistered: boolean, header?: string, communityId = DEFAULT_COMMUNITY_ID): Promise<CommunityRosterMemberDto> {
    const callerId = await this.caller(header)
    return this.database.db.transaction(async tx => {
      const [actor] = await tx.select({ isAdmin: communityMembers.isAdmin }).from(communityMembers)
        .where(membership(callerId, communityId)).limit(1).for('update')
      if (!actor?.isAdmin) fail('COMMUNITY_RECOGNITION_REQUIRED', '尚未获得本社群在册身份认定权限', 403)
      const [target] = await tx.select(rowFields).from(communityMembers).innerJoin(members, eq(members.id, communityMembers.memberId))
        .where(membership(targetId, communityId)).limit(1).for('update')
      if (!target) fail('COMMUNITY_MEMBER_NOT_FOUND', '在本社群找不到这位用户', 404)
      if (target.isRegistered !== isRegistered) {
        await tx.update(communityMembers).set({ isRegistered }).where(membership(targetId, communityId))
      }
      return { ...target, isRegistered }
    })
  }

  async memberPermissions(tx: Tx, memberId: string, page: PageQuery): Promise<CommunityPermissionListDto> {
    const where = eq(communityMembers.memberId, memberId)
    const rows = await tx.select({ ...communityFields, ...grantFields }).from(communityMembers)
      .innerJoin(communities, eq(communities.id, communityMembers.communityId)).where(where)
      .orderBy(asc(communities.id)).limit(page.limit + 1).offset(page.offset)
    const [summary] = await tx.select({ total: count() }).from(communityMembers).where(where)
    return { items: rows.slice(0, page.limit).map(row => ({ communityId: row.communityId, communityName: row.communityName, ...permissions(row) })),
      total: summary.total, hasMore: rows.length > page.limit }
  }

  async setMemberPermissions(tx: Tx, memberId: string, communityId: string, input: CommunityPermissionsInput, actorId: string) {
    if (input.canRecognizeMembers && !input.canViewRoster) fail('INVALID_ROSTER_PERMISSIONS', '认定在册身份需要同时授予查看名单权限')
    const where = membership(memberId, communityId)
    const [row] = await tx.select({ ...communityFields, ...grantFields }).from(communityMembers)
      .innerJoin(communities, eq(communities.id, communityMembers.communityId)).where(where).for('update')
    if (!row) fail('COMMUNITY_MEMBER_NOT_FOUND', '在本社群找不到这位用户', 404)
    const before = permissions(row)
    if (before.canViewRoster !== input.canViewRoster || before.canRecognizeMembers !== input.canRecognizeMembers) {
      await tx.update(communityMembers).set({ canViewRoster: input.canViewRoster, isAdmin: input.canRecognizeMembers }).where(where)
      await tx.insert(rosterPermissionAudit).values({ id: randomUUID(), actorId, memberId, communityId, before, after: input })
    }
    return { communityId: row.communityId, communityName: row.communityName, ...input }
  }
}
