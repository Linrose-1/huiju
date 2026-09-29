import { Injectable } from '@nestjs/common'
import { and, avg, count, desc, eq, isNotNull, isNull } from 'drizzle-orm'
import { randomUUID } from 'node:crypto'
import { activities } from '../database/schema/activities.js'
import { activityComments, activityReviews } from '../database/schema/feedback.js'
import { feedbackModerationLogs } from '../database/schema/feedback-moderation.js'
import { members } from '../database/schema/members.js'
import { registrations } from '../database/schema/registrations.js'
import { fail, FlowDatabase } from './common.js'
import { complete, IdentityService, type Member } from './identity.js'
import { readerDto } from './reading.js'
import type { CommentDto, CommentInput, FeedbackContextDto, ReviewDto, ReviewInput, ReviewStatsDto } from './feedback-dto.js'
import type { ModerationListDto, ModerationQuery } from './moderation-dto.js'

type Activity = typeof activities.$inferSelect
type Registration = typeof registrations.$inferSelect
type Comment = typeof activityComments.$inferSelect
type Review = typeof activityReviews.$inferSelect
type Tx = Parameters<Parameters<FlowDatabase['db']['transaction']>[0]>[0]
type Kind = 'comment' | 'review'

export function feedbackReason(activity: Activity, member: Member | null | undefined, registration?: Registration, review = false, now = new Date()): string | null {
  if (!member) return '请先登录'
  if (!complete(member)) return '请先完善手机号、头像和用户名称'
  if (activity.lifecycle !== 'published' || activity.moderation === 'removed') return '活动已取消或下架，不能新增评论或点评'
  if (review && now < activity.endsAt) return '活动结束后才可点评'
  if (review && (!registration || registration.status !== 'active' || !registration.attended)) return '仅已报名并被发起人标记到场的参加者可点评'
  return null
}

export function feedbackDto(row: Review, member: Member): ReviewDto
export function feedbackDto(row: Comment, member: Member): CommentDto
export function feedbackDto(row: Comment | Review, member: Member): CommentDto | ReviewDto {
  const base = { id: row.id, activityId: row.activityId, member: readerDto(member), content: row.content,
    createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString(), hidden: Boolean(row.hiddenAt) }
  return 'score' in row ? { ...base, score: row.score } : base
}

function validateContent(input: CommentInput) {
  if (typeof input.content !== 'string' || !input.content.trim() || input.content.trim().length > 2000) fail('INVALID_INPUT', '请填写 1–2000 字的内容')
  return input.content.trim()
}

function validateScore(input: ReviewInput) {
  if (!Number.isInteger(input.score) || input.score < 1 || input.score > 5) fail('INVALID_INPUT', '评分须为 1–5 分整数')
  return input.score
}

@Injectable()
export class FeedbackService {
  constructor(private readonly database: FlowDatabase, private readonly identity: IdentityService) {}

  // Called only inside the admin service's authenticated transaction.
  async listForModeration(tx: Tx, query: ModerationQuery): Promise<ModerationListDto> {
    const table = query.kind === 'comment' ? activityComments : activityReviews
    const where = and(isNull(table.deletedAt), query.status === 'visible' ? isNull(table.hiddenAt)
      : query.status === 'hidden' ? isNotNull(table.hiddenAt) : undefined)
    const [{ total }] = await tx.select({ total: count() }).from(table).where(where)
    const rows = await tx.select({ row: table, title: activities.title, name: members.displayName,
      audit: feedbackModerationLogs }).from(table)
      .innerJoin(activities, eq(table.activityId, activities.id))
      .innerJoin(members, eq(table.memberId, members.id))
      .leftJoin(feedbackModerationLogs, and(eq(feedbackModerationLogs.targetId, table.id), eq(feedbackModerationLogs.kind, query.kind)))
      .where(where).orderBy(desc(table.createdAt), desc(table.id)).limit(40).offset(query.offset)
    return { total, hasMore: query.offset + rows.length < total, items: rows.map(({ row, title, name, audit }) => ({
      id: row.id, kind: query.kind, activityId: row.activityId, activityTitle: title, memberName: name ?? '未设置名称',
      content: row.content, score: 'score' in row ? Number(row.score) : null,
      createdAt: row.createdAt.toISOString(), hiddenAt: row.hiddenAt?.toISOString() ?? null,
      hiddenReason: audit?.reason ?? null, hiddenBy: audit?.adminName ?? null,
    })) }
  }

  async hideForModeration(tx: Tx, kind: Kind, id: string, reason: string, admin: { id: string; displayName: string }) {
    if (typeof reason !== 'string' || !reason.trim() || reason.trim().length > 500) fail('INVALID_INPUT', '请填写 1–500 字的隐藏原因')
    const table = kind === 'comment' ? activityComments : activityReviews
    const [target] = await tx.select().from(table).where(eq(table.id, id)).limit(1)
    if (!target) fail('NOT_FOUND', '内容不存在', 404)
    // Match member edits' activity -> feedback locking order.
    await this.activity(tx, target.activityId, true)
    const [row] = await tx.select().from(table).where(eq(table.id, id)).for('update')
    if (!row || row.deletedAt) fail('NOT_FOUND', '内容已删除或不存在', 404)
    if (row.hiddenAt) return { ok: true }
    const now = new Date()
    await tx.update(table).set({ hiddenAt: now, updatedAt: now }).where(eq(table.id, id))
    await tx.insert(feedbackModerationLogs).values({ id: randomUUID(), kind, targetId: id,
      adminId: admin.id, adminName: admin.displayName, reason: reason.trim(), contentSnapshot: row.content, createdAt: now })
    return { ok: true }
  }

  private async activity(tx: Tx, id: string, lock = false) {
    const query = tx.select().from(activities).where(eq(activities.id, id))
    const [activity] = lock ? await query.for('update') : await query.limit(1)
    if (!activity || activity.lifecycle === 'draft') fail('NOT_FOUND', '活动不存在', 404)
    return activity
  }

  private async currentMember(tx: Tx, id: string) {
    const [member] = await tx.select().from(members).where(eq(members.id, id)).for('update')
    if (!member || member.kind !== 'member') fail('SESSION_REQUIRED', '请重新登录', 401)
    if (!complete(member)) fail('PROFILE_INCOMPLETE', '请先完善手机号、头像和用户名称', 403)
    return member
  }

  private requireNew(activity: Activity, member: Member, registration?: Registration, review = false) {
    const reason = feedbackReason(activity, member, registration, review)
    if (reason) fail(review ? 'REVIEW_NOT_ALLOWED' : 'COMMENT_NOT_ALLOWED', reason, 409)
  }

  async comments(id: string, offset = 0, header?: string, mine = false) {
    const member = mine ? (await this.identity.require(header))! : null
    return this.database.db.transaction(async tx => {
      const activity = await this.activity(tx, id)
      if (!mine && activity.moderation === 'removed') return { items: [], total: 0, hasMore: false }
      const where = and(eq(activityComments.activityId, id), isNull(activityComments.deletedAt),
        mine ? eq(activityComments.memberId, member!.id) : isNull(activityComments.hiddenAt))
      const [{ total }] = await tx.select({ total: count() }).from(activityComments).where(where)
      const rows = await tx.select({ row: activityComments, member: members }).from(activityComments)
        .innerJoin(members, eq(members.id, activityComments.memberId)).where(where)
        .orderBy(desc(activityComments.createdAt), desc(activityComments.id)).limit(40).offset(offset)
      return { items: rows.map(item => feedbackDto(item.row, item.member)), total, hasMore: offset + rows.length < total }
    })
  }

  async reviews(id: string, offset = 0) {
    return this.database.db.transaction(async tx => {
      const activity = await this.activity(tx, id)
      if (activity.moderation === 'removed') return { items: [], total: 0, hasMore: false }
      const where = and(eq(activityReviews.activityId, id), isNull(activityReviews.deletedAt), isNull(activityReviews.hiddenAt))
      const [{ total }] = await tx.select({ total: count() }).from(activityReviews).where(where)
      const rows = await tx.select({ row: activityReviews, member: members }).from(activityReviews)
        .innerJoin(members, eq(members.id, activityReviews.memberId)).where(where)
        .orderBy(desc(activityReviews.createdAt), desc(activityReviews.id)).limit(40).offset(offset)
      return { items: rows.map(item => ({ ...feedbackDto(item.row, item.member), score: item.row.score })), total, hasMore: offset + rows.length < total }
    })
  }

  async context(id: string, header?: string): Promise<FeedbackContextDto> {
    const member = await this.identity.require(header, true)
    return this.database.db.transaction(async tx => {
      const activity = await this.activity(tx, id)
      const registration = member ? (await tx.select().from(registrations).where(and(eq(registrations.activityId, id), eq(registrations.memberId, member.id))).limit(1))[0] : undefined
      const review = member ? (await tx.select().from(activityReviews).where(and(eq(activityReviews.activityId, id), eq(activityReviews.memberId, member.id), isNull(activityReviews.deletedAt))).limit(1))[0] : undefined
      const commentReason = feedbackReason(activity, member)
      const reviewReason = review ? '你已提交点评，可修改已有点评' : feedbackReason(activity, member, registration, true)
      return { canComment: !commentReason, commentReason, canReview: !reviewReason, reviewReason,
        myReview: review && member ? { ...feedbackDto(review, member), score: review.score } : null,
        isOrganizer: member?.id === activity.organizerMemberId }
    })
  }

  async createComment(id: string, input: CommentInput, header?: string) {
    const member = (await this.identity.require(header))!
    const content = validateContent(input)
    await this.database.db.transaction(async tx => {
      const activity = await this.activity(tx, id, true)
      const freshMember = await this.currentMember(tx, member.id)
      this.requireNew(activity, freshMember)
      await tx.insert(activityComments).values({ id: randomUUID(), activityId: id, memberId: member.id, content })
    })
    return { ok: true }
  }

  async createReview(id: string, input: ReviewInput, header?: string) {
    const member = (await this.identity.require(header))!
    const content = validateContent(input), score = validateScore(input)
    await this.database.db.transaction(async tx => {
      const activity = await this.activity(tx, id, true)
      const freshMember = await this.currentMember(tx, member.id)
      const [registration] = await tx.select().from(registrations).where(and(eq(registrations.activityId, id), eq(registrations.memberId, member.id))).for('update')
      this.requireNew(activity, freshMember, registration, true)
      const [existing] = await tx.select().from(activityReviews).where(and(eq(activityReviews.activityId, id), eq(activityReviews.memberId, member.id))).for('update')
      if (existing && !existing.deletedAt) fail('REVIEW_EXISTS', '你已提交点评，请修改已有点评', 409)
      if (existing) {
        // A deleted review reuses its unique row; moderation survives resubmission.
        await tx.update(activityReviews).set({ content, score, deletedAt: null, createdAt: new Date(), updatedAt: new Date() }).where(eq(activityReviews.id, existing.id))
      } else await tx.insert(activityReviews).values({ id: randomUUID(), activityId: id, memberId: member.id, content, score })
    })
    return { ok: true }
  }

  async change(kind: Kind, id: string, input: CommentInput | ReviewInput | null, header?: string) {
    const member = (await this.identity.require(header))!
    const table = kind === 'comment' ? activityComments : activityReviews
    const [target] = await this.database.db.select().from(table).where(eq(table.id, id)).limit(1)
    if (!target) fail('NOT_FOUND', '内容不存在', 404)
    if (target.memberId !== member.id) fail('FORBIDDEN', '仅能修改或删除本人内容', 403)
    const content = input ? validateContent(input) : null
    const score = input && kind === 'review' ? validateScore(input as ReviewInput) : undefined
    await this.database.db.transaction(async tx => {
      await this.activity(tx, target.activityId, true)
      // Editing retains ownership rights even after cancellation/removal. It cannot unhide content.
      const [row] = await tx.select().from(table).where(eq(table.id, id)).for('update')
      if (!row || row.memberId !== member.id) fail('FORBIDDEN', '仅能修改或删除本人内容', 403)
      if (!input) {
        if (!row.deletedAt) await tx.update(table).set({ deletedAt: new Date(), updatedAt: new Date() }).where(eq(table.id, id))
        return
      }
      if (row.deletedAt) fail('NOT_FOUND', '内容已删除', 404)
      if (kind === 'review') await tx.update(activityReviews).set({ content: content!, score, updatedAt: new Date() }).where(eq(activityReviews.id, id))
      else await tx.update(activityComments).set({ content: content!, updatedAt: new Date() }).where(eq(activityComments.id, id))
    })
    return { ok: true }
  }

  async stats(id: string, header?: string): Promise<ReviewStatsDto> {
    const member = (await this.identity.require(header))!
    return this.database.db.transaction(async tx => {
      const activity = await this.activity(tx, id)
      if (activity.organizerMemberId !== member.id) fail('FORBIDDEN', '仅活动发起人可查看评分汇总', 403)
      const [result] = await tx.select({ count: count(), averageScore: avg(activityReviews.score) }).from(activityReviews)
        .where(and(eq(activityReviews.activityId, id), isNull(activityReviews.deletedAt), isNull(activityReviews.hiddenAt)))
      return { count: result.count, averageScore: result.averageScore === null ? null : Math.round(Number(result.averageScore) * 100) / 100 }
    })
  }
}
