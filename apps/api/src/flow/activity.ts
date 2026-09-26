import { Injectable } from '@nestjs/common'
import {
  and,
  asc,
  desc,
  eq,
  sql
} from 'drizzle-orm'
import { randomUUID } from 'node:crypto'
import { activities, registrationQuestions } from '../database/schema/activities.js'
import { members } from '../database/schema/members.js'
import { registrations, registrationAnswers, registrationOperations } from '../database/schema/registrations.js'
import { fail, FlowDatabase } from './common.js'
import { complete, IdentityService } from './identity.js'
import { ActivityDto, AnswerInput, RegistrationDto, RegistrationInput } from './dto.js'
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
    private readonly identity: IdentityService
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
        avatarUrl: members.avatarUrl,
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
      coverUrl: state === 'removed' ? null : activity.coverUrl,
      location: state === 'removed' ? '' : activity.location,
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

  async list() {
    const rows = await this.database.db
      .select()
      .from(activities)
      .where(and(eq(activities.lifecycle, 'published'), eq(activities.moderation, 'normal')))
      .orderBy(desc(activities.publishedAt), desc(activities.createdAt))
      .limit(100)
    return { items: await Promise.all(rows.map(row => this.present(row))) }
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

  async roster(id: string) {
    await this.detail(id)
    const [activity] = await this.database.db
      .select()
      .from(activities)
      .where(eq(activities.id, id))
      .limit(1)
    if (activity.moderation === 'removed') {
      return { items: [] }
    }
    const rows = await this.database.db
      .select({
        avatarUrl: members.avatarUrl,
        displayName: members.displayName
      })
      .from(registrations)
      .innerJoin(members, eq(members.id, registrations.memberId))
      .where(and(eq(registrations.activityId, id), eq(registrations.status, 'active')))
      .limit(200)
    return { items: rows }
  }

  private async registrationDto(row: typeof registrations.$inferSelect): Promise<RegistrationDto> {
    const answers = await this.database.db
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

  async allMine(header?: string) {
    const member = (await this.identity.require(header))!
    const rows = await this.database.db
      .select({
        registration: registrations,
        activity: activities
      })
      .from(registrations)
      .innerJoin(activities, eq(activities.id, registrations.activityId))
      .where(eq(registrations.memberId, member.id))
      .orderBy(desc(registrations.currentRegisteredAt))
      .limit(100)
    return {
      items: await Promise.all(rows.map(async (row) => ({
        ...await this.registrationDto(row.registration),
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
        const contactPhone = (input as RegistrationInput).contactPhone
        if (existing) {
          await tx
            .update(registrations)
            .set({
              status: 'active',
              contactPhone,
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
        await tx
          .insert(registrationOperations)
          .values({
            id: randomUUID(),
            registrationId,
            actorMemberId: member.id,
            action: existing ? 'reregistered' : 'registered'
          })
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
