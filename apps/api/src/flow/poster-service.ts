import { Injectable } from '@nestjs/common'
import { and, count, eq, gte, lt } from 'drizzle-orm'
import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { activities } from '../database/schema/activities.js'
import { members } from '../database/schema/members.js'
import { activityPosterCopies, activityPosterShares, aiPosterReservations, aiPosterUsages } from '../database/schema/poster.js'
import { PosterCopyProvider, parsePosterCopy } from '../ai/poster-provider.js'
import { beijingDayBounds } from '../ai/service.js'
import { fail, FlowDatabase } from './common.js'
import { complete, IdentityService } from './identity.js'
import { memberInviteCode } from './member-number.js'
import { requireOrganizer } from './organizer.js'
import { WechatAdapter } from './wechat.js'
import type { ActivityPosterDto, PosterCopyInput } from './poster-dto.js'

type Activity = typeof activities.$inferSelect
type Tx = Parameters<Parameters<FlowDatabase['db']['transaction']>[0]>[0]
type Reader = Tx | FlowDatabase['db']
type CodeImage = { base64: string; mimeType: 'image/png' | 'image/jpeg' }
export function requirePosterActivity(activity?: Activity): asserts activity is Activity {
  if (!activity || activity.lifecycle === 'draft') fail('NOT_FOUND', '活动不存在或未发布', 404)
  if (activity.lifecycle !== 'published' || activity.moderation !== 'normal') fail('ACTIVITY_UNAVAILABLE', '活动已取消或下架，暂不能分享', 409)
}
export function posterSourceHash(activity: Activity) {
  return createHash('sha256').update(JSON.stringify([activity.title, activity.description, activity.coverUrl,
    activity.startsAt.toISOString(), activity.endsAt.toISOString(), activity.location, activity.feeType, activity.feeAmountCents])).digest('hex')
}
export function checkedPosterCopy(input: { subtitle: string; highlights: string[] }) {
  const subtitle = input.subtitle.trim(), highlights = input.highlights.map(line => line.trim())
  const hasControl = (value: string) => [...value].some(char => char.charCodeAt(0) < 32)
  if ([...subtitle].length > 40 || highlights.length > 2 || highlights.some(line => !line || [...line].length > 24)
    || hasControl(subtitle) || highlights.some(hasControl)) {
    fail('INVALID_POSTER_COPY', '海报简介最多40字，看点最多2条、每条24字')
  }
  return { subtitle, highlights }
}

@Injectable()
export class ActivityPosterService {
  private activeGenerations = 0
  private activeCodes = new Set<string>()
  private codeCache = new Map<string, { image: CodeImage; until: number }>()
  private codeLimits = new Map<string, { count: number; until: number }>()
  constructor(private readonly database: FlowDatabase, private readonly identity: IdentityService,
    private readonly provider: PosterCopyProvider, private readonly wechat: WechatAdapter) {}

  private async activity(id: string, db: Reader = this.database.db, lock = false) {
    const query = db.select().from(activities).where(eq(activities.id, id))
    const [activity] = await (lock ? query.for('update') : query)
    requirePosterActivity(activity)
    return activity
  }
  private async lockMember(tx: Tx, id: string, requireComplete = true) {
    const [member] = await tx.select().from(members).where(eq(members.id, id)).for('update')
    if (!member) fail('UNAUTHORIZED', '请重新登录', 401)
    if (requireComplete && !complete(member)) fail('PROFILE_INCOMPLETE', '请先绑定手机号并设置头像、名称', 403)
    return member
  }
  private async present(activity: Activity, memberId: string, db: Reader): Promise<ActivityPosterDto> {
    const [copy] = await db.select().from(activityPosterCopies).where(eq(activityPosterCopies.activityId, activity.id))
    const sourceHash = posterSourceHash(activity), valid = copy?.sourceHash === sourceHash
    return { activityId: activity.id, title: activity.title, coverUrl: activity.coverUrl,
      startsAt: activity.startsAt.toISOString(), endsAt: activity.endsAt.toISOString(), location: activity.location,
      feeType: activity.feeType, feeAmount: activity.feeAmountCents, sourceHash, version: copy?.version ?? 0,
      subtitle: valid ? copy.subtitle : '', highlights: valid ? copy.highlights : [],
      copyStatus: copy ? valid ? 'confirmed' : 'stale' : 'none', canEdit: activity.organizerMemberId === memberId }
  }
  async read(id: string, header?: string) {
    const member = (await this.identity.require(header))!
    return this.present(await this.activity(id), member.id, this.database.db)
  }
  async save(id: string, input: PosterCopyInput, header?: string) {
    const member = (await this.identity.require(header))!, copy = checkedPosterCopy(input)
    return this.database.db.transaction(async tx => {
      await this.lockMember(tx, member.id)
      const activity = await this.activity(id, tx, true)
      requireOrganizer(activity, member.id)
      if (posterSourceHash(activity) !== input.sourceHash) fail('POSTER_SOURCE_CHANGED', '活动内容已更新，请重新读取后确认海报', 409)
      const [old] = await tx.select().from(activityPosterCopies).where(eq(activityPosterCopies.activityId, id))
      if ((old?.version ?? 0) !== input.version) fail('POSTER_VERSION_CONFLICT', '海报文案已更新，请重新读取后再保存', 409)
      const values = { ...copy, sourceHash: input.sourceHash, version: input.version + 1, confirmedBy: member.id, confirmedAt: new Date() }
      await tx.insert(activityPosterCopies).values({ activityId: id, ...values }).onDuplicateKeyUpdate({ set: values })
      return this.present(activity, member.id, tx)
    })
  }
  private async usageToday(tx: Tx, memberId: string, now: Date) {
    const [start, end] = beijingDayBounds(now)
    const [usage] = await tx.select({ total: count() }).from(aiPosterUsages)
      .where(and(eq(aiPosterUsages.memberId, memberId), gte(aiPosterUsages.createdAt, start), lt(aiPosterUsages.createdAt, end)))
    const total = Number(usage?.total ?? 0)
    if (total >= 5) fail('AI_POSTER_DAILY_LIMIT', '今天的5次海报文案机会已用完，请明天再试', 429)
    return total
  }
  async draft(id: string, header?: string) {
    const member = (await this.identity.require(header))!
    if (!complete(member)) fail('PROFILE_INCOMPLETE', '请先绑定手机号并设置头像、名称', 403)
    if (this.activeGenerations >= 4) fail('AI_BUSY', '生成请求较多，请稍后手动重试', 429)
    this.activeGenerations++
    const reservationId = randomUUID()
    let reserved = false
    try {
      const activity = await this.database.db.transaction(async tx => {
        await this.lockMember(tx, member.id)
        const activity = await this.activity(id, tx, true)
        requireOrganizer(activity, member.id)
        const now = new Date()
        const [current] = await tx.select().from(aiPosterReservations).where(eq(aiPosterReservations.memberId, member.id)).for('update')
        if (current && current.expiresAt > now) fail('AI_GENERATION_IN_PROGRESS', '正在生成海报文案，请等待本次完成', 409)
        await this.usageToday(tx, member.id, now)
        const values = { reservationId, createdAt: now, expiresAt: new Date(now.getTime() + 120000) }
        await tx.insert(aiPosterReservations).values({ memberId: member.id, ...values }).onDuplicateKeyUpdate({ set: values })
        return activity
      })
      reserved = true
      const sourceHash = posterSourceHash(activity)
      const copy = checkedPosterCopy(parsePosterCopy(await this.provider.generate({ title: activity.title, description: activity.description })))
      // Recheck the session after an external wait, before charging a successful result.
      await this.identity.require(header)
      const remainingToday = await this.database.db.transaction(async tx => {
        await this.lockMember(tx, member.id)
        const latest = await this.activity(id, tx, true)
        requireOrganizer(latest, member.id)
        if (posterSourceHash(latest) !== sourceHash) fail('POSTER_SOURCE_CHANGED', '活动内容已更新，请重新生成海报文案', 409)
        const now = new Date()
        const [current] = await tx.select().from(aiPosterReservations).where(eq(aiPosterReservations.memberId, member.id)).for('update')
        if (!current || current.reservationId !== reservationId || current.expiresAt <= now) fail('AI_GENERATION_EXPIRED', '本次生成已超时，请手动重试', 409)
        const total = await this.usageToday(tx, member.id, now)
        await tx.insert(aiPosterUsages).values({ id: randomUUID(), memberId: member.id, createdAt: now })
        await tx.delete(aiPosterReservations).where(and(eq(aiPosterReservations.memberId, member.id), eq(aiPosterReservations.reservationId, reservationId)))
        return 4 - total
      })
      return { ...copy, sourceHash, remainingToday }
    } catch (error) {
      if (reserved) {
        try { await this.database.db.delete(aiPosterReservations).where(and(eq(aiPosterReservations.memberId, member.id), eq(aiPosterReservations.reservationId, reservationId))) }
        catch { /* A failed cleanup remains bounded by the expiring reservation. */ }
      }
      throw error
    } finally { this.activeGenerations-- }
  }
  private limitCode(memberId: string) {
    const now = Date.now()
    for (const [key, entry] of this.codeLimits) if (entry.until <= now) this.codeLimits.delete(key)
    const entry = this.codeLimits.get(memberId)
    if (entry && entry.count >= 30) fail('POSTER_CODE_LIMITED', '海报生成较频繁，请稍后再试', 429)
    if (!entry && this.codeLimits.size >= 5000) fail('POSTER_CODE_BUSY', '海报生成繁忙，请稍后重试', 429)
    this.codeLimits.set(memberId, { count: (entry?.count ?? 0) + 1, until: entry?.until ?? now + 15 * 60000 })
  }
  async code(id: string, header?: string) {
    const member = (await this.identity.require(header))!
    if (this.activeCodes.has(member.id) || this.activeCodes.size >= 4) fail('POSTER_CODE_BUSY', '海报码正在生成，请稍后重试', 429)
    this.limitCode(member.id)
    this.activeCodes.add(member.id)
    try {
      const share = await this.database.db.transaction(async tx => {
        const currentMember = await this.lockMember(tx, member.id, false)
        await this.activity(id, tx, true)
        const filter = and(eq(activityPosterShares.activityId, id), eq(activityPosterShares.memberId, member.id))
        const [old] = await tx.select().from(activityPosterShares).where(filter)
        if (old) return old
        const value = { scene: 'p' + randomBytes(12).toString('hex'), activityId: id, memberId: member.id,
          inviteCode: memberInviteCode(currentMember.memberNumber, currentMember.inviteCode), createdAt: new Date() }
        await tx.insert(activityPosterShares).values(value)
        return value
      })
      const key = `${process.env.WECHAT_CODE_ENV_VERSION || 'release'}:${share.scene}`, cached = this.codeCache.get(key)
      const image = cached && cached.until > Date.now() ? cached.image : await this.wechat.activityCode(share.scene)
      if (!cached || cached.until <= Date.now()) {
        for (const [key, entry] of this.codeCache) if (entry.until <= Date.now()) this.codeCache.delete(key)
        if (this.codeCache.size >= 100) this.codeCache.delete(this.codeCache.keys().next().value!)
        this.codeCache.set(key, { image, until: Date.now() + 3600000 })
      }
      await this.identity.require(header)
      await this.activity(id)
      return { scene: share.scene, ...image }
    } finally { this.activeCodes.delete(member.id) }
  }
  async resolve(scene: string) {
    if (!/^p[a-f0-9]{24}$/.test(scene)) fail('INVALID_POSTER_SCENE', '活动海报码无效，请重新打开分享', 400)
    const [share] = await this.database.db.select().from(activityPosterShares).where(eq(activityPosterShares.scene, scene))
    if (!share) fail('NOT_FOUND', '活动海报码不存在', 404)
    await this.activity(share.activityId)
    return { activityId: share.activityId, inviteCode: share.inviteCode }
  }
}
