import { Injectable } from '@nestjs/common'
import { and, count, desc, eq, gt, isNull, sql } from 'drizzle-orm'
import { randomUUID } from 'node:crypto'
import { activities } from '../database/schema/activities.js'
import { activityInviteCodes, registrationOperations } from '../database/schema/registrations.js'
import { complete, IdentityService } from './identity.js'
import { fail, FlowDatabase } from './common.js'
import { createInviteCode, inviteHash, openInvite, sealInvite } from './special-invite-crypto.js'
import { type InviteStatus, SpecialInviteCodeDto, SpecialInviteQuery, SpecialInviteVerifiedDto } from './special-invite-dto.js'

type Activity = typeof activities.$inferSelect
type Invite = typeof activityInviteCodes.$inferSelect
type Tx = Parameters<Parameters<FlowDatabase['db']['transaction']>[0]>[0]
export function inviteExpiresAt(activity: Activity) {
  return new Date(Math.min((activity.registrationDeadline ?? activity.startsAt).getTime(), activity.startsAt.getTime(), activity.endsAt.getTime()))
}
export function specialInviteStatus(activity: Activity, usedAt: Date | null, now = new Date(), expiresAt = inviteExpiresAt(activity)): InviteStatus {
  if (usedAt) return 'used'
  if (activity.lifecycle === 'cancelled' || now >= inviteExpiresAt(activity) || now >= expiresAt) return 'expired'
  if (activity.moderation === 'removed' || activity.lifecycle !== 'published' || activity.feeType !== 'paid') return 'paused'
  return 'unused'
}
export function requireInviteAvailable(activity: Activity, now = new Date()) {
  const status = specialInviteStatus(activity, null, now)
  if (status === 'expired') fail('SPECIAL_INVITE_EXPIRED', '活动已取消或报名已截止，特邀码已失效', 409)
  if (status === 'paused') fail('SPECIAL_INVITE_PAUSED', '当前活动暂不能使用或发放特邀码', 409)
  if (activity.capacity !== null && activity.activeRegistrationCount >= activity.capacity) fail('CAPACITY_FULL', '活动名额已满', 409)
}
const maskedPhone = (phone: string) => `${phone.slice(0, 3)} **** ${phone.slice(-4)}`

@Injectable()
export class SpecialInviteService {
  constructor(private readonly database: FlowDatabase, private readonly identity: IdentityService) {}

  private present(row: Invite, activity: Activity, registrationId: string | null = null): SpecialInviteCodeDto {
    const payload = openInvite(row)
    return { id: row.id, code: payload.code, maskedPhone: maskedPhone(payload.phone), status: specialInviteStatus(activity, row.usedAt, new Date(), row.expiresAt), createdAt: row.createdAt.toISOString(), expiresAt: new Date(Math.min(row.expiresAt.getTime(), inviteExpiresAt(activity).getTime())).toISOString(), usedAt: row.usedAt?.toISOString() ?? null, registrationId }
  }
  private owner(activity: Activity | undefined, memberId: string): asserts activity is Activity {
    if (!activity) fail('NOT_FOUND', '活动不存在', 404)
    if (activity.organizerMemberId !== memberId) fail('FORBIDDEN', '仅活动发起人可以管理特邀码', 403)
  }

  async create(activityId: string, phone: string, header?: string): Promise<SpecialInviteCodeDto> {
    const member = (await this.identity.require(header))!
    if (!complete(member)) fail('PROFILE_INCOMPLETE', '请先绑定手机号并设置头像、名称', 403)
    if (!/^1\d{10}$/.test(phone)) fail('SPECIAL_INVITE_INVALID_PHONE', '请填写有效的受邀人手机号')
    return this.database.db.transaction(async tx => {
      const [activity] = await tx.select().from(activities).where(eq(activities.id, activityId)).for('update')
      this.owner(activity, member.id)
      requireInviteAvailable(activity)
      const phoneHash = inviteHash('phone', phone)
      const [existing] = await tx.select().from(activityInviteCodes).where(and(eq(activityInviteCodes.activityId, activityId), eq(activityInviteCodes.phoneHash, phoneHash), isNull(activityInviteCodes.usedAt), gt(activityInviteCodes.expiresAt, new Date()))).limit(1)
      if (existing) return this.present(existing, activity)
      const id = randomUUID(), code = createInviteCode()
      const row: Invite = { id, activityId, issuerMemberId: member.id, phoneHash, codeHash: inviteHash('code', code), encryptedPayload: sealInvite(id, activityId, { code, phone }), expiresAt: inviteExpiresAt(activity), createdAt: new Date(), usedAt: null, usedByMemberId: null, operationId: null }
      await tx.insert(activityInviteCodes).values(row)
      return this.present(row, activity)
    })
  }

  async list(activityId: string, query: SpecialInviteQuery, header?: string) {
    const member = (await this.identity.require(header))!
    const db = this.database.db
    const [activity] = await db.select().from(activities).where(eq(activities.id, activityId))
    this.owner(activity, member.id)
    const unusedStatus = specialInviteStatus(activity, null)
    const status = sql<string>`case when ${activityInviteCodes.usedAt} is not null then 'used' when ${activityInviteCodes.expiresAt} <= ${new Date()} then 'expired' else ${unusedStatus} end`
    const where = and(eq(activityInviteCodes.activityId, activityId), query.status === 'all' ? undefined : eq(status, query.status))
    const [total] = await db.select({ value: count() }).from(activityInviteCodes).where(where)
    const rows = await db.select({ invite: activityInviteCodes, registrationId: registrationOperations.registrationId }).from(activityInviteCodes)
      .leftJoin(registrationOperations, eq(activityInviteCodes.operationId, registrationOperations.id)).where(where)
      .orderBy(desc(activityInviteCodes.createdAt), desc(activityInviteCodes.id)).limit(query.limit + 1).offset(query.offset)
    return { total: Number(total!.value), hasMore: rows.length > query.limit, items: rows.slice(0, query.limit).map(row => this.present(row.invite, activity, row.registrationId)) }
  }

  async verify(activityId: string, code: string, header?: string): Promise<SpecialInviteVerifiedDto> {
    const member = (await this.identity.require(header))!
    if (!complete(member)) fail('PROFILE_INCOMPLETE', '请先绑定手机号并设置头像、名称', 403)
    const db = this.database.db
    const [activity] = await db.select().from(activities).where(eq(activities.id, activityId))
    if (!activity || activity.lifecycle === 'draft') fail('NOT_FOUND', '活动不存在', 404)
    const row = await this.lookup(db, activityId, code, member.boundPhone!, false)
    this.usable(row, activity)
    return { valid: true, maskedPhone: maskedPhone(member.boundPhone!), expiresAt: new Date(Math.min(row.expiresAt.getTime(), inviteExpiresAt(activity).getTime())).toISOString() }
  }

  private async lookup(db: Tx | FlowDatabase['db'], activityId: string, code: string, phone: string, lock: boolean) {
    const normalized = code.trim().toUpperCase()
    if (!/^[A-HJ-NP-Z2-9]{12}$/.test(normalized)) fail('SPECIAL_INVITE_INVALID', '特邀码无效或与当前账号绑定手机号不匹配')
    const query = db.select().from(activityInviteCodes).where(and(eq(activityInviteCodes.activityId, activityId), eq(activityInviteCodes.codeHash, inviteHash('code', normalized)), eq(activityInviteCodes.phoneHash, inviteHash('phone', phone))))
    const [row] = lock ? await query.for('update') : await query.limit(1)
    if (!row) fail('SPECIAL_INVITE_INVALID', '特邀码无效或与当前账号绑定手机号不匹配')
    return row
  }
  private usable(row: Invite, activity: Activity) {
    if (row.usedAt) fail('SPECIAL_INVITE_USED', '特邀码已使用，取消报名后也不会恢复', 409)
    if (new Date() >= row.expiresAt) fail('SPECIAL_INVITE_EXPIRED', '特邀码已超过有效期', 409)
    requireInviteAvailable(activity)
  }
  // Caller must hold the activity lock before acquiring this code lock.
  async prepare(tx: Tx, activity: Activity, code: string, phone: string) {
    const row = await this.lookup(tx, activity.id, code, phone, true)
    this.usable(row, activity)
    return row.id
  }
  async consume(tx: Tx, id: string, memberId: string, operationId: string, usedAt: Date) {
    await tx.update(activityInviteCodes).set({ usedAt, usedByMemberId: memberId, operationId }).where(and(eq(activityInviteCodes.id, id), isNull(activityInviteCodes.usedAt)))
  }
}
