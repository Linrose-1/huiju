import 'reflect-metadata'
import { ValidationPipe } from '@nestjs/common'
import { describe, expect, it, vi } from 'vitest'
import { activities } from '../src/database/schema/activities.js'
import { activityComments, activityReviews } from '../src/database/schema/feedback.js'
import { registrations } from '../src/database/schema/registrations.js'
import type { FlowDatabase } from '../src/flow/common.js'
import { CommentInput, ReviewInput } from '../src/flow/feedback-dto.js'
import { feedbackDto, feedbackReason, FeedbackService } from '../src/flow/feedback.js'
import type { IdentityService, Member } from '../src/flow/identity.js'

const member = { id: 'member', kind: 'member', memberNumber: '1001', avatarUrl: '/current.png', displayName: '当前名称', avatarSetByUser: true, nameSetByUser: true, boundPhone: '19900000001' } as Member
const activity = { id: 'activity', organizerMemberId: member.id, lifecycle: 'published', moderation: 'normal', endsAt: new Date(0) } as typeof activities.$inferSelect
const registration = { id: 'registration', activityId: activity.id, memberId: member.id, status: 'active', attended: true } as typeof registrations.$inferSelect
const comment = { id: 'comment', activityId: activity.id, memberId: member.id, content: '正文', hiddenAt: null, deletedAt: null, createdAt: new Date(0), updatedAt: new Date(0) } as typeof activityComments.$inferSelect
const review = { ...comment, id: 'review', score: 4 } as typeof activityReviews.$inferSelect
const pipe = new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true })

function fixture(results: unknown[][] = [], caller: Member | undefined = member) {
  const writes: { kind: string; values: Record<string, unknown> }[] = []
  const query: Record<string, unknown> = {}
  for (const name of ['from', 'where', 'limit', 'offset', 'orderBy', 'innerJoin', 'for']) query[name] = vi.fn(() => query)
  query.then = (resolve: (value: unknown) => unknown) => Promise.resolve(results.shift() ?? []).then(resolve)
  const db = {
    select: vi.fn(() => query),
    insert: vi.fn(() => ({ values: async (values: Record<string, unknown>) => { writes.push({ kind: 'insert', values }) } })),
    update: vi.fn(() => ({ set: (values: Record<string, unknown>) => ({ where: async () => { writes.push({ kind: 'update', values }) } }) })),
    transaction: async (run: (tx: unknown) => unknown) => run(db),
  }
  const requireIdentity = vi.fn().mockResolvedValue(caller)
  return { service: new FeedbackService({ db } as unknown as FlowDatabase, { require: requireIdentity } as unknown as IdentityService), db, query, writes, requireIdentity }
}

describe('feedback input and eligibility', () => {
  it('trims text and rejects blank, oversized, invalid scores and unauthorized fields', async () => {
    const validate = (value: unknown, metatype = CommentInput) => pipe.transform(value, { type: 'body', metatype })
    expect(await validate({ content: ' 内容 ' })).toEqual({ content: '内容' })
    for (const content of ['', '  ', null, 23, '字'.repeat(2001)]) await expect(validate({ content })).rejects.toThrow()
    for (const score of [0, 6, 1.5, '5', null]) await expect(validate({ content: '点评', score }, ReviewInput)).rejects.toThrow()
    await expect(validate({ content: '点评', score: 5 }, ReviewInput)).resolves.toEqual({ content: '点评', score: 5 })
    for (const field of ['memberId', 'hiddenAt', 'activityId', 'replyToId']) await expect(validate({ content: '正文', [field]: 'other' })).rejects.toThrow()
  })

  it('requires identity and complete profile, but comments do not require registration', () => {
    expect(feedbackReason(activity, null)).toBe('请先登录')
    expect(feedbackReason(activity, { ...member, avatarSetByUser: false })).toContain('完善')
    expect(feedbackReason(activity, member)).toBeNull()
    for (const state of [{ lifecycle: 'cancelled' }, { moderation: 'removed' }]) expect(feedbackReason({ ...activity, ...state } as typeof activity, member)).toContain('不能新增')
  })

  it('checks review end time, active registration and attended separately', () => {
    expect(feedbackReason({ ...activity, endsAt: new Date(1000) }, member, registration, true, new Date(999))).toContain('结束后')
    expect(feedbackReason({ ...activity, endsAt: new Date(1000) }, member, registration, true, new Date(1000))).toBeNull()
    for (const row of [undefined, { ...registration, status: 'cancelled' as const }, { ...registration, attended: false }]) expect(feedbackReason(activity, member, row, true)).toContain('标记到场')
  })

  it('maps only public author fields and current identity data', () => {
    const result = feedbackDto(review, member)
    expect(result.score).toBe(4)
    expect(result.member).toEqual({ memberId: member.id, avatarUrl: '/current.png', displayName: '当前名称' })
    expect(feedbackDto(comment, { ...member, boundPhone: null }).member).toEqual({ memberId: member.id, avatarUrl: null, displayName: '会员1001' })
    expect(Object.keys(result).sort()).toEqual(['id', 'activityId', 'member', 'content', 'score', 'createdAt', 'updatedAt', 'hidden'].sort())
  })
})

describe('feedback service writes', () => {
  it('requires identity before accessing data and rechecks fresh profile before inserts', async () => {
    const f = fixture(); f.requireIdentity.mockRejectedValue(new Error('SESSION_REQUIRED'))
    for (const run of [() => f.service.createComment(activity.id, { content: '正文' }), () => f.service.createReview(activity.id, { content: '点评', score: 5 }), () => f.service.change('comment', comment.id, null)]) await expect(run()).rejects.toThrow('SESSION_REQUIRED')
    expect(f.db.select).not.toHaveBeenCalled()
    const fresh = fixture([[activity], [{ ...member, nameSetByUser: false }]])
    await expect(fresh.service.createComment(activity.id, { content: '正文' })).rejects.toMatchObject({ response: { code: 'PROFILE_INCOMPLETE' } })
    expect(fresh.writes).toEqual([])
  })

  it('inserts a trimmed comment with server assigned ownership and no client moderation', async () => {
    const f = fixture([[activity], [member]])
    await f.service.createComment(activity.id, { content: ' 正文 ' })
    expect(f.writes).toEqual([{ kind: 'insert', values: { id: expect.any(String), activityId: activity.id, memberId: member.id, content: '正文' } }])
    expect(f.query.for).toHaveBeenCalledWith('update')
  })

  it('rejects unavailable activities and ineligible reviews without writes', async () => {
    for (const change of [{ lifecycle: 'cancelled' }, { moderation: 'removed' }]) {
      const f = fixture([[{ ...activity, ...change }], [member]])
      await expect(f.service.createComment(activity.id, { content: '正文' })).rejects.toMatchObject({ response: { code: 'COMMENT_NOT_ALLOWED' } })
      expect(f.writes).toEqual([])
    }
    for (const row of [[], [{ ...registration, attended: false }], [{ ...registration, status: 'cancelled' }]]) {
      const f = fixture([[activity], [member], row])
      await expect(f.service.createReview(activity.id, { content: '点评', score: 5 })).rejects.toMatchObject({ response: { code: 'REVIEW_NOT_ALLOWED' } })
      expect(f.writes).toEqual([])
    }
  })

  it('rejects a second active review and reuses a deleted review without clearing hiddenAt', async () => {
    const duplicate = fixture([[activity], [member], [registration], [review]])
    await expect(duplicate.service.createReview(activity.id, { content: '第二条', score: 1 })).rejects.toMatchObject({ response: { code: 'REVIEW_EXISTS' } })
    expect(duplicate.writes).toEqual([])
    const reuse = fixture([[activity], [member], [registration], [{ ...review, deletedAt: new Date(), hiddenAt: new Date() }]])
    await reuse.service.createReview(activity.id, { content: '重新提交', score: 5 })
    expect(reuse.writes).toEqual([{ kind: 'update', values: { content: '重新提交', score: 5, deletedAt: null, createdAt: expect.any(Date), updatedAt: expect.any(Date) } }])
  })

  it('denies modification of others and refuses editing deleted content', async () => {
    const other = fixture([[{ ...comment, memberId: 'other' }]])
    await expect(other.service.change('comment', comment.id, { content: '改写' })).rejects.toMatchObject({ response: { code: 'FORBIDDEN' } })
    expect(other.writes).toEqual([])
    const deleted = fixture([[comment], [activity], [{ ...comment, deletedAt: new Date() }]])
    await expect(deleted.service.change('comment', comment.id, { content: '改写' })).rejects.toMatchObject({ response: { code: 'NOT_FOUND' } })
    expect(deleted.writes).toEqual([])
  })

  it('allows own historical editing after cancellation or removal without unhide or new eligibility', async () => {
    for (const change of [{ lifecycle: 'cancelled' }, { moderation: 'removed' }]) {
      for (const kind of ['comment', 'review'] as const) {
        const row = kind === 'comment' ? comment : review
        const f = fixture([[row], [{ ...activity, ...change }], [{ ...row, hiddenAt: new Date() }]], { ...member, boundPhone: null })
        await f.service.change(kind, row.id, kind === 'review' ? { content: '修订', score: 3 } : { content: '修订' })
        expect(f.writes[0].values).toEqual({ content: '修订', ...(kind === 'review' ? { score: 3 } : {}), updatedAt: expect.any(Date) })
      }
    }
  })

  it('allows own deletion on removed/cancelled records and repeated deletion is idempotent', async () => {
    const f = fixture([[review], [{ ...activity, moderation: 'removed' }], [review]])
    await f.service.change('review', review.id, null)
    expect(f.writes[0].values).toEqual({ deletedAt: expect.any(Date), updatedAt: expect.any(Date) })
    const retry = fixture([[review], [{ ...activity, lifecycle: 'cancelled' }], [{ ...review, deletedAt: new Date() }]])
    await retry.service.change('review', review.id, null)
    expect(retry.writes).toEqual([])
  })
})

describe('feedback reads and privacy', () => {
  it('hides removed public lists but keeps own hidden comment history', async () => {
    const removed = { ...activity, moderation: 'removed' }
    expect(await fixture([[removed]]).service.comments(activity.id)).toEqual({ items: [], total: 0, hasMore: false })
    expect(await fixture([[removed]]).service.reviews(activity.id)).toEqual({ items: [], total: 0, hasMore: false })
    const f = fixture([[removed], [{ total: 1 }], [{ row: { ...comment, hiddenAt: new Date() }, member }]])
    const result = await f.service.comments(activity.id, 0, 'session', true)
    expect(result.items[0].hidden).toBe(true)
    expect(f.requireIdentity).toHaveBeenCalledWith('session')
    expect(f.query.limit).toHaveBeenCalledWith(40)
  })

  it('returns anon eligibility without private data and only own hidden review for authenticated context', async () => {
    const anonymous = fixture([[activity]]); anonymous.requireIdentity.mockResolvedValue(undefined)
    expect(await anonymous.service.context(activity.id)).toEqual({ canComment: false, commentReason: '请先登录', canReview: false, reviewReason: '请先登录', myReview: null, isOrganizer: false })
    const own = fixture([[activity], [registration], [{ ...review, hiddenAt: new Date() }]])
    const result = await own.service.context(activity.id, 'session')
    expect(result.canReview).toBe(false)
    expect(result.myReview?.hidden).toBe(true)
    expect(result.myReview?.member.memberId).toBe(member.id)
  })

  it('restricts score aggregates to activity owner and keeps absence distinct from zero', async () => {
    const denied = fixture([[activity]], { ...member, id: 'other' })
    await expect(denied.service.stats(activity.id)).rejects.toMatchObject({ response: { code: 'FORBIDDEN' } })
    expect(denied.db.select).toHaveBeenCalledTimes(1)
    expect(await fixture([[activity], [{ count: 0, averageScore: null }]]).service.stats(activity.id)).toEqual({ count: 0, averageScore: null })
    expect(await fixture([[activity], [{ count: 3, averageScore: '4.3333' }]]).service.stats(activity.id)).toEqual({ count: 3, averageScore: 4.33 })
  })
})
