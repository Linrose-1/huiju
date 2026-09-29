import 'reflect-metadata'
import { ValidationPipe } from '@nestjs/common'
import { describe, expect, it, vi } from 'vitest'
import type { FlowDatabase } from '../src/flow/common.js'
import { FeedbackService } from '../src/flow/feedback.js'
import type { IdentityService } from '../src/flow/identity.js'
import { HideFeedbackInput, ModerationQuery } from '../src/flow/moderation-dto.js'

const target = { id: 'content', activityId: 'activity', content: '审核前正文', hiddenAt: null, deletedAt: null,
  createdAt: new Date(0), updatedAt: new Date(0) }
const activity = { id: 'activity', lifecycle: 'published' }
const admin = { id: 'operator', displayName: '运营甲' }

function fixture(results: unknown[][]) {
  const writes: { type: string; value: unknown }[] = []
  const query: Record<string, unknown> = {}
  for (const name of ['from', 'where', 'limit', 'for', 'innerJoin', 'leftJoin', 'orderBy', 'offset']) query[name] = vi.fn(() => query)
  query.then = (resolve: (rows: unknown[]) => unknown) => Promise.resolve(results.shift() ?? []).then(resolve)
  const tx = {
    select: vi.fn(() => query),
    update: vi.fn(() => ({ set: (value: unknown) => ({ where: async () => { writes.push({ type: 'update', value }) } }) })),
    insert: vi.fn(() => ({ values: async (value: unknown) => { writes.push({ type: 'insert', value }) } })),
  }
  const service = new FeedbackService({} as FlowDatabase, {} as IdentityService)
  return { service, tx: tx as unknown as Parameters<FeedbackService['hideForModeration']>[0], query, writes }
}

describe('feedback moderation domain', () => {
  it('requires a nonempty reason and rejects client supplied actor/state', async () => {
    const pipe = new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true })
    const validate = (value: unknown) => pipe.transform(value, { type: 'body', metatype: HideFeedbackInput })
    for (const reason of ['', '   ', '字'.repeat(501), null]) await expect(validate({ reason })).rejects.toThrow()
    await expect(validate({ reason: '违规', adminId: 'forged' })).rejects.toThrow()
    await expect(validate({ reason: ' 广告 ' })).resolves.toEqual({ reason: '广告' })
    await expect(pipe.transform({ kind: 'anything' }, { type: 'query', metatype: ModerationQuery })).rejects.toThrow()
    await expect(pipe.transform({ offset: '-1' }, { type: 'query', metatype: ModerationQuery })).rejects.toThrow()
  })

  it.each(['comment', 'review'] as const)('hides %s and records actor/reason/snapshot through the same transaction', async kind => {
    const f = fixture([[target], [activity], [target]])
    await expect(f.service.hideForModeration(f.tx, kind, target.id, ' 违规广告 ', admin)).resolves.toEqual({ ok: true })
    expect(f.writes).toEqual([
      { type: 'update', value: { hiddenAt: expect.any(Date), updatedAt: expect.any(Date) } },
      { type: 'insert', value: { id: expect.any(String), kind, targetId: target.id, adminId: admin.id,
        adminName: admin.displayName, reason: '违规广告', contentSnapshot: target.content, createdAt: expect.any(Date) } },
    ])
    expect(f.query.for).toHaveBeenCalledTimes(2)
  })

  it('does not overwrite the original moderation evidence on retry', async () => {
    const f = fixture([[target], [activity], [{ ...target, hiddenAt: new Date() }]])
    await f.service.hideForModeration(f.tx, 'comment', target.id, '重试理由', admin)
    expect(f.writes).toEqual([])
  })

  it('rejects concurrently deleted content and missing targets without writing', async () => {
    for (const results of [[[]], [[target], [activity], [{ ...target, deletedAt: new Date() }]]]) {
      const f = fixture(results)
      await expect(f.service.hideForModeration(f.tx, 'comment', target.id, '广告', admin)).rejects.toMatchObject({ response: { code: 'NOT_FOUND' } })
      expect(f.writes).toEqual([])
    }
  })

  it('maps audit fields without leaking account credentials or member private fields', async () => {
    const f = fixture([[{ total: 1 }], [{ row: { ...target, score: 3, hiddenAt: new Date(0) }, title: '活动', name: '会员', audit: { reason: '广告', adminName: '运营甲', adminId: 'private-id', contentSnapshot: '原文' } }]])
    const result = await f.service.listForModeration(f.tx, { kind: 'review', status: 'hidden', offset: 0 })
    expect(result).toEqual({ total: 1, hasMore: false, items: [{ id: target.id, kind: 'review', activityId: 'activity', activityTitle: '活动', memberName: '会员', content: target.content, score: 3, createdAt: new Date(0).toISOString(), hiddenAt: new Date(0).toISOString(), hiddenReason: '广告', hiddenBy: '运营甲' }] })
  })
})
