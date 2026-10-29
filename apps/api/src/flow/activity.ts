import { Injectable } from '@nestjs/common'
import {
  and,
  asc,
  count,
  desc,
  eq,
  gt,
  inArray,
  lte,
  sql
} from 'drizzle-orm'
import { randomUUID } from 'node:crypto'
import { activities, registrationQuestions } from '../database/schema/activities.js'
import { members } from '../database/schema/members.js'
import { registrations, registrationAnswers, registrationOperations } from '../database/schema/registrations.js'
import { fail, FlowDatabase } from './common.js'
import { complete, IdentityService } from './identity.js'
import { ActivityDto, AnswerInput, PublicMemberDto, RegistrationDto, RegistrationInput } from './dto.js'
import { ActivityListQuery } from './activity-list-dto.js'
import { PageQuery, MyRegistrationQuery, activityStatusSql, activityCounts, answersForRegistrations } from './pagination.js'
import { RecommendationRecordsService } from '../recommendations/records.js'
import { activityImages } from './activity-images.js'
import { SpecialInviteService } from './special-invite.js'
type Activity = typeof activities.$inferSelect
type Question = typeof registrationQuestions.$inferSelect

export function registrationState(activity: Activity, now = new Date()) {
  if (activity.moderation === 'removed') {
    return 'removed'
  }
  if (activity.lifecycle === 'cancelled') {
    return 'cancelled'
  }
  if (activity.lifecycle !== 'published'
    || now >= (activity.registrationDeadline ?? activity.startsAt)
    || now >= activity.startsAt) {
    return 'closed'
  }
  if (activity.capacity !== null
    && activity.activeRegistrationCount >= activity.capacity) {
    return 'full'
  }
  return 'open'
}

export function validateAnswers(questions: Question[], answers: AnswerInput[]) {
  const seen = new Set<string>()
  for (const answer of answers) {
    const question = questions.find(q => q.id === answer.questionId)
    if (!question || seen.has(answer.questionId)) {
      fail('INVALID_ANSWERS', '报名问题无效或重复')
    }
    seen.add(answer.questionId)
    const value = answer.value
    if (question.type === 'multiple') {
      if (!Array.isArray(value) || value.length > 100
        || new Set(value).size !== value.length
        || value.some(v => typeof v !== 'string' || !question.options?.includes(v))) {
        fail('INVALID_ANSWERS', '请选择有效的报名选项')
      }
    } else if (typeof value !== 'string'
      || value.length > (question.type === 'long_text' ? 10000 : 1000)
      || (question.type === 'single' && value !== ''
        && !question.options?.includes(value))) {
      fail('INVALID_ANSWERS', '报名答案格式不正确')
    }
    if (question.required
      && (Array.isArray(value) ? value.length === 0 : !value.trim())) {
      fail('REQUIRED_ANSWER', '请回答所有必填问题')
    }
  }
  if (questions.some(q => q.required && !seen.has(q.id))) {
    fail('REQUIRED_ANSWER', '请回答所有必填问题')
  }
}

@Injectable()
export class ActivityService {
  constructor(
    private readonly database: FlowDatabase,
    private readonly identity: IdentityService,
    private readonly recommendations: RecommendationRecordsService = new RecommendationRecordsService(database),
    private readonly specialInvites: SpecialInviteService = new SpecialInviteService(database, identity)
  ) {}

  private async present(activity: Activity, memberId?: string): Promise<ActivityDto> {
    const state = registrationState(activity)
    const historical = memberId ? (await this.database.db
      .select({ id: registrations.id })
      .from(registrations)
      .where(and(eq(registrations.activityId, activity.id), eq(registrations.memberId, memberId)))
      .limit(1))[0] : undefined
    const canContact = memberId === activity.organizerMemberId || Boolean(historical)
    const questions = state === 'removed' ? [] : await this.database.db
      .select({
        id: registrationQuestions.id,
        type: registrationQuestions.type,
        prompt: registrationQuestions.prompt,
        required: registrationQuestions.required,
        options: registrationQuestions.options
      })
      .from(registrationQuestions)
      .where(eq(registrationQuestions.activityId, activity.id))
      .orderBy(asc(registrationQuestions.sortOrder))
    const organizer = state === 'removed' ? null : (await this.database.db
      .select({
        memberId: members.id, avatarUrl: members.avatarUrl,
        displayName: members.displayName
      })
      .from(members)
      .where(eq(members.id, activity.organizerMemberId))
      .limit(1))[0] ?? null
    return {
      organizer,
      id: activity.id,
      title: state === 'removed' ? '活动已下架' : activity.title,
      description: state === 'removed' ? '' : activity.description,
      descriptionDelta: state === 'removed' ? null : activity.descriptionDelta ?? null,
      registrationNotice: state === 'removed' ? null : activity.registrationNotice ?? null,
      coverUrl: state === 'removed' ? null : activity.coverUrl,
      imageUrls: state === 'removed' ? [] : activityImages(activity),
      location: state === 'removed' ? '' : activity.location,
      locationLatitude: state === 'removed' ? null : activity.locationLatitude ?? null,
      locationLongitude: state === 'removed' ? null : activity.locationLongitude ?? null,
      startsAt: activity.startsAt.toISOString(),
      endsAt: activity.endsAt.toISOString(),
      registrationDeadline: (activity.registrationDeadline ?? activity.startsAt).toISOString(),
      capacity: activity.capacity,
      activeRegistrationCount: activity.activeRegistrationCount,
      cancellationRegistrationCount: activity.cancellationRegistrationCount,
      feeType: activity.feeType,
      feeAmountCents: activity.feeAmountCents,
      registrationState: state,
      cancellationReason: state === 'cancelled' ? activity.cancellationReason : null,
      ...(canContact ? { consultationContact: activity.consultationContact } : {}),
      questions
    }
  }

  async list(query: ActivityListQuery = new ActivityListQuery()) {
    const pageSize = 10
    const keyword = query.q?.trim()
    const where = and(
      eq(activities.lifecycle, 'published'),
      eq(activities.moderation, 'normal'),
      query.sort === 'upcoming' ? gt(activities.startsAt, new Date()) : undefined,
      keyword ? sql`(instr(${activities.title}, ${keyword}) > 0 or instr(${activities.description}, ${keyword}) > 0 or instr(${activities.location}, ${keyword}) > 0)` : undefined
    )
    const rows = await this.database.db
      .select()
      .from(activities)
      .where(where)
      .orderBy(...(query.sort === 'upcoming'
        ? [asc(activities.startsAt), asc(activities.id)]
        : [desc(activities.publishedAt), desc(activities.createdAt), desc(activities.id)]))
      .limit(pageSize + 1)
      .offset(query.offset)
    const hasMore = rows.length > pageSize
    rows.length = Math.min(rows.length, pageSize)
    if (!rows.length) return { items: [], hasMore: false }
    const ranked = this.database.db
      .select({
        activityId: registrations.activityId,
        memberId: members.id,
        avatarUrl: members.avatarUrl,
        displayName: members.displayName,
        rank: sql<number>`row_number() over (partition by ${registrations.activityId} order by ${registrations.currentRegisteredAt} desc, ${registrations.id} desc)`.as('rank')
      })
      .from(registrations)
      .innerJoin(members, eq(members.id, registrations.memberId))
      .where(and(inArray(registrations.activityId, rows.map(row => row.id)), eq(registrations.status, 'active')))
      .as('ranked')
    const previews = await this.database.db
      .select({
        activityId: ranked.activityId,
        memberId: ranked.memberId,
        avatarUrl: ranked.avatarUrl,
        displayName: ranked.displayName
      })
      .from(ranked)
      .where(lte(ranked.rank, 4))
      .orderBy(asc(ranked.activityId), asc(ranked.rank))
    const membersByActivity = new Map<string, PublicMemberDto[]>()
    for (const { activityId, ...member } of previews) {
      const list = membersByActivity.get(activityId) ?? []
      list.push(member)
      membersByActivity.set(activityId, list)
    }
    return { hasMore, items: await Promise.all(rows.map(async row => ({
      ...await this.present(row),
      registeredMembers: membersByActivity.get(row.id) ?? []
    }))) }
  }

  async detail(id: string, header?: string) {
    const member = await this.identity.require(header, true)
    const [activity] = await this.database.db
      .select()
      .from(activities)
      .where(eq(activities.id, id))
      .limit(1)
    if (!activity || activity.lifecycle === 'draft') {
      fail('NOT_FOUND', '活动不存在', 404)
    }
    return this.present(activity, member?.id)
  }

  async roster(id: string, query: PageQuery = new PageQuery()) {
    await this.detail(id)
    const [activity] = await this.database.db
      .select()
      .from(activities)
      .where(eq(activities.id, id))
      .limit(1)
    if (activity.moderation === 'removed') {
      return { items: [], total: 0, hasMore: false }
    }
    const rows = await this.database.db
      .select({
        memberId: members.id, avatarUrl: members.avatarUrl,
        displayName: members.displayName
      })
      .from(registrations)
      .innerJoin(members, eq(members.id, registrations.memberId))
      .where(and(eq(registrations.activityId, id), eq(registrations.status, 'active')))
      .orderBy(desc(registrations.currentRegisteredAt), desc(registrations.id))
      .limit(query.limit + 1).offset(query.offset)
    const [total] = await this.database.db.select({ value: count() }).from(registrations)
      .where(and(eq(registrations.activityId, id), eq(registrations.status, 'active')))
    return { items: rows.slice(0, query.limit), total: Number(total!.value), hasMore: rows.length > query.limit }
  }

  private async registrationDto(row: typeof registrations.$inferSelect, knownAnswers?: RegistrationDto['answers']): Promise<RegistrationDto> {
    const answers = knownAnswers ?? await this.database.db
      .select({
        questionId: registrationAnswers.questionId,
        value: registrationAnswers.answer
      })
      .from(registrationAnswers)
      .where(eq(registrationAnswers.registrationId, row.id))
    return {
      id: row.id,
      activityId: row.activityId,
      status: row.status,
      feeQualification: row.feeQualification ?? 'ordinary',
      contactPhone: row.contactPhone,
      answers,
      currentRegisteredAt: row.currentRegisteredAt.toISOString(),
      cancelledAt: row.cancelledAt?.toISOString() ?? null
    }
  }

  async mine(id: string, header?: string) {
    const member = (await this.identity.require(header))!
    const [row] = await this.database.db
      .select()
      .from(registrations)
      .where(and(eq(registrations.activityId, id), eq(registrations.memberId, member.id)))
      .limit(1)
    if (!row) {
      fail('REGISTRATION_NOT_FOUND', '尚未报名此活动', 404)
    }
    return this.registrationDto(row)
  }

  async allMine(header?: string, query: MyRegistrationQuery = new MyRegistrationQuery()) {
    const member = (await this.identity.require(header))!
    const status = activityStatusSql(true)
    const where = eq(registrations.memberId, member.id)
    const totals = await this.database.db.select({ status, value: count() }).from(registrations)
      .innerJoin(activities, eq(activities.id, registrations.activityId)).where(where).groupBy(status)
    const counts = activityCounts(totals)
    const [active] = await this.database.db.select({ value: count() }).from(registrations)
      .where(and(where, eq(registrations.status, 'active')))
    const rows = await this.database.db
      .select({
        registration: registrations,
        activity: activities
      })
      .from(registrations)
      .innerJoin(activities, eq(activities.id, registrations.activityId))
      .where(and(where, query.status !== 'all' ? sql`${status} = ${query.status}` : undefined))
      .orderBy(desc(registrations.currentRegisteredAt), desc(registrations.id))
      .limit(query.limit + 1).offset(query.offset)
    const page = rows.slice(0, query.limit)
    const answers = await answersForRegistrations(this.database.db, page.map(row => row.registration.id))
    return {
      hasMore: rows.length > query.limit, total: counts.all, counts, activeCount: Number(active!.value),
      items: await Promise.all(page.map(async (row) => ({
        ...await this.registrationDto(row.registration, answers.get(row.registration.id) ?? []),
        activity: await this.present(row.activity, member.id)
      })))
    }
  }

  async write(
    id: string,
    header: string | undefined,
    action: 'register' | 'edit' | 'cancel',
    input?: RegistrationInput | {
      answers: AnswerInput[]
    }
  ) {
    const member = (await this.identity.require(header))!
    await this.database.db.transaction(async (tx) => {
      // All seat-changing actions lock the activity before the registration.
      // This serializes the last seat, cancellation and re-registration.
      const [activity] = await tx
        .select()
        .from(activities)
        .where(eq(activities.id, id))
        .for('update')
      if (!activity || activity.lifecycle === 'draft') {
        fail('NOT_FOUND', '活动不存在', 404)
      }
      const [owner] = await tx
        .select()
        .from(members)
        .where(eq(members.id, member.id))
      if (action === 'register' && !complete(owner)) {
        fail('PROFILE_INCOMPLETE', '请先绑定手机号并设置头像、名称', 403)
      }
      const [existing] = await tx
        .select()
        .from(registrations)
        .where(and(eq(registrations.activityId, id), eq(registrations.memberId, member.id)))
        .for('update')
      const now = new Date()
      if (action === 'cancel') {
        if (!existing) {
          fail('REGISTRATION_NOT_FOUND', '尚未报名此活动', 404)
        }
        if (existing.status === 'cancelled') {
          return
        }
        if (now >= activity.startsAt) {
          fail('CANCELLATION_CLOSED', '活动已开始，不能取消报名', 409)
        }
        await tx
          .update(registrations)
          .set({
            status: 'cancelled',
            cancelledAt: now
          })
          .where(eq(registrations.id, existing.id))
        await tx
          .update(activities)
          .set({ activeRegistrationCount: sql`${activities.activeRegistrationCount} - 1` })
          .where(eq(activities.id, id))
        await tx
          .insert(registrationOperations)
          .values({
            id: randomUUID(),
            registrationId: existing.id,
            actorMemberId: member.id,
            action: 'cancelled'
          })
        return
      }
      if (action === 'register' && existing?.status === 'active') {
        // An already accepted request must never occupy another seat.
        return
      }
      const state = registrationState(activity, now)
      if (state === 'removed' || state === 'cancelled') {
        fail('ACTIVITY_UNAVAILABLE', state === 'removed' ? '活动已下架' : '活动已取消', 409)
      }
      if (state === 'closed') {
        fail('REGISTRATION_CLOSED', '报名已截止', 409)
      }
      if (action === 'register' && state === 'full') {
        fail('CAPACITY_FULL', '活动名额已满', 409)
      }
      if (action === 'edit' && existing?.status !== 'active') {
        fail('REGISTRATION_NOT_FOUND', '没有可修改的有效报名', 404)
      }
      const questions = await tx
        .select()
        .from(registrationQuestions)
        .where(eq(registrationQuestions.activityId, id))
      validateAnswers(questions, input!.answers)
      const registrationId = existing?.id ?? randomUUID()
      if (action === 'register') {
        const specialInviteCode = (input as RegistrationInput).specialInviteCode
        const inviteId = specialInviteCode ? await this.specialInvites.prepare(tx, activity, specialInviteCode, owner.boundPhone!) : null
        const feeQualification = inviteId ? 'invited_free' as const : 'ordinary' as const
        const contactPhone = (input as RegistrationInput).contactPhone
        if (existing) {
          await tx
            .update(registrations)
            .set({
              status: 'active',
              contactPhone,
              feeQualification,
              currentRegisteredAt: now,
              cancelledAt: null
            })
            .where(eq(registrations.id, existing.id))
        } else {
          await tx
            .insert(registrations)
            .values({
              id: registrationId,
              activityId: id,
              memberId: member.id,
              contactPhone,
              feeQualification,
              firstRegisteredAt: now,
              currentRegisteredAt: now
            })
        }
        await tx
          .update(activities)
          .set({
            activeRegistrationCount: sql`${activities.activeRegistrationCount} + 1`,
            // Cancellation never unlocks the original questions or fee.
            hasRegistrationEver: true
          })
          .where(eq(activities.id, id))
        const operationId = randomUUID()
        await tx
          .insert(registrationOperations)
          .values({
            id: operationId,
            registrationId,
            actorMemberId: member.id,
            action: existing ? 'reregistered' : 'registered'
          })
        const sourceToken = (input as RegistrationInput).recommendationToken
        if (inviteId) await this.specialInvites.consume(tx, inviteId, member.id, operationId, now)
        if (sourceToken) await this.recommendations.conversion(tx, sourceToken, member.id, activity.id, operationId)
      }
      await tx
        .delete(registrationAnswers)
        .where(eq(registrationAnswers.registrationId, registrationId))
      if (input!.answers.length) {
        await tx
          .insert(registrationAnswers)
          .values(input!.answers.map(answer => ({
            id: randomUUID(),
            registrationId,
            questionId: answer.questionId,
            answer: answer.value
          })))
      }
    })
    return this.mine(id, header)
  }
}
