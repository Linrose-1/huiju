import 'reflect-metadata'
import { describe, expect, it, vi } from 'vitest'
import { plainToInstance } from 'class-transformer'
import { validate } from 'class-validator'
import { activityValues, OrganizerService, requireOrganizer, validateActivityEdit } from '../src/flow/organizer.js'
import { ActivityWriteInput } from '../src/flow/organizer-dto.js'
import { FlowDatabase } from '../src/flow/common.js'
import { IdentityService } from '../src/flow/identity.js'
import type { activities, registrationQuestions } from '../src/database/schema/activities.js'

type Activity = typeof activities.$inferSelect
type Question = typeof registrationQuestions.$inferSelect
const input: ActivityWriteInput = {
  title: '测试活动', description: '一起讨论', location: '会议室', consultationContact: '微信号 huiju',
  startsAt: '2030-01-02T08:00:00.000Z', endsAt: '2030-01-02T10:00:00.000Z', feeType: 'free', questions: []
}
const base = { ...activityValues(input), organizerMemberId: 'owner', lifecycle: 'published', moderation: 'normal', hasRegistrationEver: false, activeRegistrationCount: 0 } as Activity
const now = new Date('2030-01-01T00:00:00Z')

describe('organizer write boundaries', () => {
  it('validates time, fees, cover and choices', () => {
    expect(activityValues(input).registrationDeadline).toBeNull()
    const invalid: ActivityWriteInput[] = [
      { ...input, endsAt: input.startsAt }, { ...input, registrationDeadline: input.endsAt },
      { ...input, feeType: 'paid' }, { ...input, feeAmountCents: 100 },
      { ...input, coverUrl: 'javascript:alert(1)' },
      { ...input, questions: [{ type: 'single', prompt: '选一个', required: true, options: [] }] },
      { ...input, questions: [{ type: 'multiple', prompt: '选几个', required: true, options: ['甲', '甲'] }] },
      { ...input, questions: [{ type: 'short_text', prompt: '介绍', required: false, options: ['甲'] }] }
    ]
    for (const value of invalid) expect(() => activityValues(value)).toThrow()
    expect(activityValues({ ...input, feeType: 'paid', feeAmountCents: 100 }).feeAmountCents).toBe(100)
  })

  it('DTO rejects omitted required values, oversized integers and malformed nested questions', async () => {
    expect(await validate(plainToInstance(ActivityWriteInput, input))).toHaveLength(0)
    for (const body of [{ ...input, title: '   ' }, { ...input, capacity: 1.5 }, { ...input, feeAmountCents: 4294967296 }, { ...input, questions: [{}] }, { ...input, startsAt: 'bad' }, { ...input, startsAt: '2030-01-02T08:00:00' }, { ...input, endsAt: '2030-01-02T10:00:00' }, { ...input, registrationDeadline: '2030-01-02' }]) {
      expect((await validate(plainToInstance(ActivityWriteInput, body))).length).toBeGreaterThan(0)
    }
  })

  it('requires owner and never grants another member private management access', () => {
    expect(() => requireOrganizer(base, 'owner')).not.toThrow()
    expect(() => requireOrganizer(base, 'other')).toThrow('仅活动发起人')
    expect(() => requireOrganizer(undefined, 'owner')).toThrow('活动不存在')
  })

  it('permanently locks questions and fees after any registration even when all cancelled', () => {
    const q = { id: 'question', type: 'single', prompt: '选一个', required: true, options: ['甲', '乙'] } as Question
    const locked = { ...base, hasRegistrationEver: true, activeRegistrationCount: 0 }
    const body = { ...input, questions: [{ id: q.id, type: 'single' as const, prompt: q.prompt, required: true, options: q.options }] }
    expect(() => validateActivityEdit(locked, [q], body, now)).not.toThrow()
    for (const change of [{ ...body, questions: [] }, { ...body, questions: [{ ...body.questions[0], options: ['甲'] }] }, { ...body, feeType: 'paid' as const, feeAmountCents: 100 }]) {
      expect(() => validateActivityEdit(locked, [q], change, now)).toThrow('已有报名记录')
    }
  })

  it('rejects foreign question ids, overbooking capacity and past starts', () => {
    expect(() => validateActivityEdit(base, [], { ...input, questions: [{ id: 'foreign', type: 'short_text', required: false, prompt: '题目' }] }, now)).toThrow('不属于')
    expect(() => validateActivityEdit({ ...base, activeRegistrationCount: 2 }, [], { ...input, capacity: 1 }, now)).toThrow('人数上限')
    expect(() => validateActivityEdit(base, [], { ...input, startsAt: now.toISOString() }, now)).toThrow('开始时间')
  })

  it('allows only contact changes after start and rejects edits after end/cancellation/removal', () => {
    const started = new Date('2030-01-02T09:00:00Z')
    expect(() => validateActivityEdit(base, [], { ...input, consultationContact: '新联系方式', registrationDeadline: input.startsAt }, started)).not.toThrow()
    expect(() => validateActivityEdit(base, [], { ...input, title: '改标题' }, started)).toThrow('仅可修改')
    expect(() => validateActivityEdit(base, [], input, base.endsAt)).toThrow('已结束')
    expect(() => validateActivityEdit({ ...base, lifecycle: 'cancelled' }, [], input, now)).toThrow('已取消或下架')
    expect(() => validateActivityEdit({ ...base, moderation: 'removed' }, [], input, now)).toThrow('已取消或下架')
  })

  it('lets an expired draft move to valid future dates without weakening published activity locks', () => {
    const expired = { ...base, startsAt: new Date('2029-01-01'), endsAt: new Date('2029-01-02') }
    expect(() => validateActivityEdit({ ...expired, lifecycle: 'draft' }, [], input, now)).not.toThrow()
    expect(() => validateActivityEdit(expired, [], input, now)).toThrow('已结束')
    expect(() => validateActivityEdit({ ...expired, lifecycle: 'draft' }, [], { ...input, startsAt: '2029-01-01T00:00:00Z' }, now)).toThrow('开始时间须晚于')
  })

  it('all management routes require a valid identity before database access', async () => {
    const requireIdentity = vi.fn().mockRejectedValue(new Error('登录已过期'))
    const database = { get db() { throw new Error('must not touch database') } } as unknown as FlowDatabase
    const service = new OrganizerService(database, { require: requireIdentity } as unknown as IdentityService)
    for (const call of [() => service.create(input), () => service.edit('id', input), () => service.publish('id'), () => service.cancel('id', '原因'), () => service.detail('id'), () => service.list(), () => service.roster('id'), () => service.notifications(), () => service.readNotification('id')]) {
      await expect(call()).rejects.toThrow('登录已过期')
    }
    expect(requireIdentity).toHaveBeenCalledTimes(9)
  })
})
