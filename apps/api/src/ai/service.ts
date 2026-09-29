import { Injectable } from '@nestjs/common'
import { and, count, eq, gte, lt } from 'drizzle-orm'
import { randomUUID } from 'node:crypto'
import { aiActivityDraftUsages } from '../database/schema/ai.js'
import { members } from '../database/schema/members.js'
import { fail, FlowDatabase } from '../flow/common.js'
import { complete, IdentityService } from '../flow/identity.js'
import { missingFields, parseActivityDraft } from './parse.js'
import { AgentIsHereDraftProvider } from './provider.js'

export function beijingDayBounds(now: Date): [Date, Date] {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now)
  const get = (type: string) => Number(parts.find(part => part.type === type)?.value)
  const start = new Date(Date.UTC(get('year'), get('month') - 1, get('day')) - 8 * 60 * 60 * 1000)
  return [start, new Date(start.getTime() + 86400000)]
}

@Injectable()
export class ActivityDraftService {
  constructor(
    private readonly database: FlowDatabase,
    private readonly identity: IdentityService,
    private readonly provider: AgentIsHereDraftProvider,
  ) {}

  async create(idea: string, header?: string) {
    const member = (await this.identity.require(header))!
    if (!complete(member)) fail('PROFILE_INCOMPLETE', '请先绑定手机号并设置头像、名称', 403)
    const createdAt = new Date()
    const [start, end] = beijingDayBounds(createdAt)
    // The member lock serializes concurrent drafts across API processes. Hold it until
    // provider success is validated and the usage row is committed; failures roll back.
    return this.database.db.transaction(async tx => {
      const [lockedMember] = await tx.select().from(members).where(eq(members.id, member.id)).for('update')
      if (!lockedMember || !complete(lockedMember)) fail('PROFILE_INCOMPLETE', '请先绑定手机号并设置头像、名称', 403)
      const [usage] = await tx.select({ total: count() }).from(aiActivityDraftUsages)
        .where(and(eq(aiActivityDraftUsages.memberId, member.id), gte(aiActivityDraftUsages.createdAt, start), lt(aiActivityDraftUsages.createdAt, end)))
      if (Number(usage?.total ?? 0) >= 5) fail('AI_DAILY_LIMIT', '今天的 5 次草拟机会已用完，请明天再试', 429)
      const raw = await this.provider.generate(idea)
      const draft = parseActivityDraft(raw, idea)
      if (!draft.title && !draft.description && !draft.location && draft.questions.length === 0) {
        fail('AI_GENERATION_FAILED', '未能生成有效草稿，请补充活动信息后重试', 502)
      }
      await tx.insert(aiActivityDraftUsages).values({ id: randomUUID(), memberId: member.id, createdAt })
      return { draft, missingFields: missingFields(draft), remainingToday: 4 - Number(usage?.total ?? 0) }
    })
  }
}
