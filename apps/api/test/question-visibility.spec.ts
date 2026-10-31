import 'reflect-metadata'
import { describe, expect, it, vi } from 'vitest'
import { Test } from '@nestjs/testing'
import type { AddressInfo } from 'node:net'
import { ValidationPipe } from '@nestjs/common'
import { FlowController } from '../src/flow/controller.js'
import { plainToInstance } from 'class-transformer'
import { validate } from 'class-validator'
import { MySqlDialect } from 'drizzle-orm/mysql-core'
import { ActivityService } from '../src/flow/activity.js'
import { activityValues, validateActivityEdit } from '../src/flow/organizer.js'
import { ActivityWriteInput } from '../src/flow/organizer-dto.js'
import type { activities, registrationQuestions } from '../src/database/schema/activities.js'
import type { FlowDatabase } from '../src/flow/common.js'
import type { IdentityService } from '../src/flow/identity.js'

const input: ActivityWriteInput = {
  title: '交流活动', description: '行业交流', location: '会议室', consultationContact: '联系发起人',
  startsAt: '2030-01-02T08:00:00.000Z', endsAt: '2030-01-02T10:00:00.000Z', feeType: 'free', questions: []
}
const now = new Date('2030-01-01T00:00:00Z')
const activity = { ...activityValues(input), organizerMemberId: 'owner', lifecycle: 'published', moderation: 'normal', hasRegistrationEver: true, activeRegistrationCount: 0 } as typeof activities.$inferSelect
const question = { id: 'q', prompt: '公司', type: 'short_text', required: false, options: null, publicToParticipants: true } as typeof registrationQuestions.$inferSelect
const member = { id: 'reader', boundPhone: '13800000000', displayName: '会员', avatarUrl: '/avatar', avatarSetByUser: true, nameSetByUser: true }
function fixture(caller: unknown = member, registered = true, extra: unknown[] = [], overrides = {}) {
  const results: unknown[][] = [[{ ...activity, ...overrides }], [{ memberId: 'visible', avatarUrl: null, displayName: '甲' }, { memberId: 'next-page', displayName: '乙' }], [{ value: 2 }], registered ? [{ id: 'r' }] : [], extra]
  const conditions: unknown[] = []
  const query: Record<string, unknown> = { then: (resolve: (v: unknown) => unknown) => Promise.resolve(results.shift()).then(resolve) }
  for (const method of ['from', 'innerJoin', 'orderBy', 'limit', 'offset']) query[method] = () => query
  query.where = (condition: unknown) => { conditions.push(condition); return query }
  const select = vi.fn(() => query), identity = { require: vi.fn(async () => caller) }
  const service = new ActivityService({ db: { select } } as unknown as FlowDatabase, identity as unknown as IdentityService)
  vi.spyOn(service, 'detail').mockResolvedValue({} as never)
  return { service, select, conditions, identity }
}

describe('registration answer visibility', () => {
  it('rejects contact labels and malformed boolean inputs', async () => {
    for (const prompt of ['手机号', '联系地址', '微信号', '二维码', '电子邮箱', 'Mobile', 'E-mail', 'QQ']) {
      expect(() => activityValues({ ...input, questions: [{ ...question, id: undefined, prompt }] })).toThrow('联系方式')
    }
    expect(() => activityValues({ ...input, questions: [{ ...question, id: undefined }] })).not.toThrow()
    expect((await validate(plainToInstance(ActivityWriteInput, { ...input, questions: [{ ...question, id: undefined, publicToParticipants: null }] }))).length).toBeGreaterThan(0)
  })

  it('allows tightening after any registration, including all cancelled and after start; never broadens', () => {
    const body = { ...input, questions: [{ ...question, publicToParticipants: false }] }
    expect(() => validateActivityEdit(activity, [question], body, now)).not.toThrow()
    expect(() => validateActivityEdit(activity, [question], body, new Date('2030-01-02T09:00:00Z'))).not.toThrow()
    expect(() => validateActivityEdit(activity, [{ ...question, publicToParticipants: false }], { ...input, questions: [question] }, now)).toThrow('不能将私密')
    expect(() => validateActivityEdit(activity, [question], { ...body, questions: [{ ...body.questions[0], prompt: '职位' }] }, now)).toThrow('已有报名记录')
  })

  it('preserves omitted visibility and rejects contact renaming with an inherited public flag', () => {
    const oldClientQuestion = { ...question, publicToParticipants: undefined }
    expect(() => validateActivityEdit(activity, [question], { ...input, questions: [oldClientQuestion] }, now)).not.toThrow()
    expect(() => validateActivityEdit({ ...activity, hasRegistrationEver: false }, [question], { ...input, questions: [{ ...oldClientQuestion, prompt: '微信号' }] }, now)).toThrow('联系方式')
  })

  it('never queries answers for anonymous, incomplete, unregistered or cancelled viewers', async () => {
    for (const [caller, registered, header, expected] of [[null, false, undefined, 3], [{ ...member, boundPhone: null }, true, 'token', 3], [member, false, 'token', 4]] as const) {
      const f = fixture(caller, registered)
      expect((await f.service.roster('activity', { offset: 0, limit: 1 }, header)).items[0].publicAnswers).toEqual([])
      expect(f.select).toHaveBeenCalledTimes(expected)
    }
  })

  it('returns only nonempty eligible answers and constrains the query to this activity and current active page', async () => {
    const f = fixture(member, true, [
      { memberId: 'visible', questionId: 'q', prompt: '公司', value: '某公司' },
      { memberId: 'visible', questionId: 'q2', prompt: '兴趣', value: ['读书', '运动'] },
      { memberId: 'visible', questionId: 'q3', prompt: '微信号', value: 'private' },
      { memberId: 'visible', questionId: 'q4', prompt: '职位', value: '  ' },
      { memberId: 'visible', questionId: 'q5', prompt: '行业', value: [] },
      { memberId: 'visible', questionId: 'q6', prompt: '技能', value: ['  '] },
    ])
    const result = await f.service.roster('activity', { offset: 20, limit: 1 }, 'token')
    expect(result.items[0].publicAnswers).toEqual([{ questionId: 'q', prompt: '公司', value: '某公司' }, { questionId: 'q2', prompt: '兴趣', value: ['读书', '运动'] }])
    expect(result.hasMore).toBe(true)
    const dialect = new MySqlDialect()
    const compiled = dialect.sqlToQuery(f.conditions.at(-1) as Parameters<MySqlDialect['sqlToQuery']>[0])
    expect(compiled.params).toEqual(['activity', 'active', 'activity', true, 'visible'])
    expect(compiled.sql).toContain('public_to_participants')
  })

  it('does not reveal answers for cancelled activities or an unregistered organizer', async () => {
    const cancelled = fixture(member, true, [], { lifecycle: 'cancelled' })
    expect((await cancelled.service.roster('activity', { offset: 0, limit: 1 }, 'token')).items[0].publicAnswers).toEqual([])
    expect(cancelled.select).toHaveBeenCalledTimes(3)
    const owner = fixture({ ...member, id: 'owner' }, false)
    expect((await owner.service.roster('activity', { offset: 0, limit: 1 }, 'token')).items[0].publicAnswers).toEqual([])
  })

  it('marks both anonymous and authenticated HTTP roster responses private and forwards optional identity', async () => {
    const roster = vi.fn(async () => ({ items: [], total: 0, hasMore: false }))
    const module = await Test.createTestingModule({ controllers: [FlowController], providers: [{ provide: ActivityService, useValue: { roster } }] }).compile()
    const app = module.createNestApplication({ logger: false })
    app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }))
    try {
      await app.listen(0, '127.0.0.1')
      const id = '00000000-0000-4000-8000-000000000001'
      const url = `http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}/activities/${id}/registrations`
      for (const header of [undefined, 'Bearer participant']) {
        const response = await fetch(url, header ? { headers: { authorization: header } } : {})
        expect(response.status).toBe(200)
        expect(response.headers.get('cache-control')).toBe('private, no-store')
        expect(roster).toHaveBeenLastCalledWith(id, expect.objectContaining({ offset: 0, limit: 20 }), header)
      }
    } finally { await app.close() }
  })
})
