import { Injectable } from '@nestjs/common'
import { and, count, eq, gte, lt } from 'drizzle-orm'
import { randomUUID } from 'node:crypto'
import { aiActivityDraftReservations, aiActivityDraftUsages } from '../database/schema/ai.js'
import { members } from '../database/schema/members.js'
import { fail, FlowDatabase } from '../flow/common.js'
import { complete, IdentityService } from '../flow/identity.js'
import { missingFields, parseActivityDraft } from './parse.js'
import { AgentIsHereDraftProvider, AI_DRAFT_TIMEOUT_MS } from './provider.js'

type Tx = Parameters<Parameters<FlowDatabase['db']['transaction']>[0]>[0]
const reservationTtl = AI_DRAFT_TIMEOUT_MS + 30000
const maximumConcurrentGenerations = 4

export function beijingDayBounds(now: Date): [Date, Date] {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now)
  const get = (type: string) => Number(parts.find(part => part.type === type)?.value)
  const start = new Date(Date.UTC(get('year'), get('month') - 1, get('day')) - 8 * 60 * 60 * 1000)
  return [start, new Date(start.getTime() + 86400000)]
}

@Injectable()
export class ActivityDraftService {
  private activeGenerations = 0

  constructor(
    private readonly database: FlowDatabase,
    private readonly identity: IdentityService,
    private readonly provider: AgentIsHereDraftProvider,
  ) {}

  private async lockMember(tx: Tx, memberId: string) {
    const [member] = await tx.select().from(members).where(eq(members.id, memberId)).for('update')
    if (!member || !complete(member)) fail('PROFILE_INCOMPLETE', '请先绑定手机号并设置头像、名称', 403)
  }

  private async usageToday(tx: Tx, memberId: string, now: Date) {
    const [start, end] = beijingDayBounds(now)
    const [usage] = await tx.select({ total: count() }).from(aiActivityDraftUsages)
      .where(and(eq(aiActivityDraftUsages.memberId, memberId), gte(aiActivityDraftUsages.createdAt, start), lt(aiActivityDraftUsages.createdAt, end)))
    const total = Number(usage?.total ?? 0)
    if (total >= 5) fail('AI_DAILY_LIMIT', '今天的 5 次草拟机会已用完，请明天再试', 429)
    return total
  }

  private async reserve(memberId: string, reservationId: string) {
    await this.database.db.transaction(async tx => {
      await this.lockMember(tx, memberId)
      const now = new Date()
      const [current] = await tx.select().from(aiActivityDraftReservations)
        .where(eq(aiActivityDraftReservations.memberId, memberId)).for('update')
      if (current && current.expiresAt > now) fail('AI_GENERATION_IN_PROGRESS', '正在生成草稿，请等待本次生成完成', 409)
      await this.usageToday(tx, memberId, now)
      const values = { reservationId, createdAt: now, expiresAt: new Date(now.getTime() + reservationTtl) }
      await tx.insert(aiActivityDraftReservations).values({ memberId, ...values }).onDuplicateKeyUpdate({ set: values })
    })
  }

  private async finish(memberId: string, reservationId: string) {
    return this.database.db.transaction(async tx => {
      await this.lockMember(tx, memberId)
      const now = new Date()
      const [current] = await tx.select().from(aiActivityDraftReservations)
        .where(eq(aiActivityDraftReservations.memberId, memberId)).for('update')
      if (!current || current.reservationId !== reservationId || current.expiresAt <= now) {
        fail('AI_GENERATION_EXPIRED', '本次生成已超时，请手动重试', 409)
      }
      // Count success on the completion day, rechecking its quota after a midnight crossing.
      const total = await this.usageToday(tx, memberId, now)
      await tx.insert(aiActivityDraftUsages).values({ id: randomUUID(), memberId, createdAt: now })
      await tx.delete(aiActivityDraftReservations).where(and(eq(aiActivityDraftReservations.memberId, memberId), eq(aiActivityDraftReservations.reservationId, reservationId)))
      return 4 - total
    })
  }

  async create(idea: string, header?: string) {
    const member = (await this.identity.require(header))!
    if (!complete(member)) fail('PROFILE_INCOMPLETE', '请先绑定手机号并设置头像、名称', 403)
    if (this.activeGenerations >= maximumConcurrentGenerations) fail('AI_BUSY', '生成请求较多，请稍后手动重试', 429)
    this.activeGenerations++
    const reservationId = randomUUID()
    let reserved = false
    try {
      await this.reserve(member.id, reservationId)
      reserved = true
      // No transaction or member lock is held while waiting for the external model.
      const raw = await this.provider.generate(idea)
      const draft = parseActivityDraft(raw, idea)
      if (!draft.title && !draft.description && !draft.location && draft.questions.length === 0) {
        fail('AI_GENERATION_FAILED', '未能生成有效草稿，请补充活动信息后重试', 502)
      }
      const remainingToday = await this.finish(member.id, reservationId)
      return { draft, missingFields: missingFields(draft), remainingToday }
    } catch (error) {
      if (reserved) {
        // A failed cleanup leaves an expiring reservation; never delete a replacement's token.
        try {
          await this.database.db.delete(aiActivityDraftReservations)
            .where(and(eq(aiActivityDraftReservations.memberId, member.id), eq(aiActivityDraftReservations.reservationId, reservationId)))
        } catch { /* Preserve the original error; the reservation can expire and be replaced. */ }
      }
      throw error
    } finally {
      this.activeGenerations--
    }
  }
}
