import 'reflect-metadata'
import type { AddressInfo } from 'node:net'
import type { INestApplication } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { AppModule } from '../src/app.module.js'
import { beijingDayBounds, ActivityDraftService } from '../src/ai/service.js'
import { normalizeDraftDates, withoutContactDetails } from '../src/ai/idea.js'
import { missingFields, parseActivityDraft } from '../src/ai/parse.js'

const idea = '2026年10月12日在北京举办读书会，限20人，免费，下午2点开始，4点结束。'

describe('AI activity draft validation', () => {
  const proposed = { title: '行业交流', startsAt: '2026-10-20T14:00:00+08:00', endsAt: '2026-10-20T16:00:00+08:00', registrationDeadline: '2026-10-19T18:00:00+08:00', capacity: 50, feeType: 'paid', feeAmountCents: 10000 }

  it('keeps explicitly undecided facts empty despite a well-formed model proposal', () => {
    for (const input of ['2026年举办行业交流，具体日期、人数和费用都尚未确定', '2026年10月20日举办行业交流，时间待定，人数待确认，费用未定']) {
      const draft = parseActivityDraft(proposed, input)
      expect(draft).toMatchObject({ startsAt: null, endsAt: null, registrationDeadline: null, capacity: null, feeType: null, feeAmountCents: null })
      expect(missingFields(draft)).toEqual(expect.arrayContaining(['startsAt', 'endsAt', 'registrationDeadline', 'capacity', 'feeType']))
    }
    expect(parseActivityDraft({ ...proposed, feeType: 'free' }, '2026年举办行业交流，具体日期、人数和费用都尚未确定'))
      .toMatchObject({ capacity: null, feeType: null, feeAmountCents: null })
  })

  it.each(['2026年举办行业交流', '2026年10月举办行业交流'])('does not turn a partial date into complete timestamps: %s', input => {
    expect(parseActivityDraft(proposed, input)).toMatchObject({ startsAt: null, endsAt: null, registrationDeadline: null })
  })

  it('keeps independently confirmed facts when only deadline and price are undecided', () => {
    const draft = parseActivityDraft(proposed, '2026年10月20日下午2点开始，下午4点结束，限50人，确定收费，金额待定，报名截止时间待确认。')
    expect(draft).toMatchObject({ startsAt: '2026-10-20T06:00:00.000Z', endsAt: '2026-10-20T08:00:00.000Z', registrationDeadline: null, capacity: 50, feeType: 'paid', feeAmountCents: null })
    expect(missingFields(draft)).toContain('feeAmountCents')
    expect(parseActivityDraft(proposed, '2026年10月20日下午2点开始，结束时间待定，免费还是收费尚未确定。'))
      .toMatchObject({ startsAt: '2026-10-20T06:00:00.000Z', endsAt: null, feeType: null, feeAmountCents: null })
    expect(parseActivityDraft(proposed, '2026年10月20日下午2点开始，活动收费，费用待定。'))
      .toMatchObject({ feeType: 'paid', feeAmountCents: null })
    expect(parseActivityDraft(proposed, '2026年10月20日下午2点开始，费用未定，尚未确定收费。'))
      .toMatchObject({ feeType: null, feeAmountCents: null })
    for (const input of ['确定收费，但免费还是收费尚未确定。', '不需要收费，费用待定。', '还未确定收费还是免费。']) {
      expect(parseActivityDraft(proposed, input)).toMatchObject({ feeType: null, feeAmountCents: null })
    }
    expect(parseActivityDraft(proposed, '活动时间待定，报名截止2026年10月19日18点。'))
      .toMatchObject({ startsAt: null, endsAt: null, registrationDeadline: '2026-10-19T10:00:00.000Z' })
  })

  it('does not let deterministic date fallback override an explicit pending field', () => {
    expect(parseActivityDraft({ ...proposed, startsAt: null, endsAt: null, registrationDeadline: null }, '2026年10月20日下午2点至下午4点是预备方案，时间待定。报名截止时间待确认。'))
      .toMatchObject({ startsAt: null, endsAt: null, registrationDeadline: null })
  })

  it.each(['2026年10月20日', '2026-10-20', '2026/10/20', '2026.10.20'])('preserves explicit date, capacity and fee proposals for %s', day => {
    expect(parseActivityDraft({ ...proposed, registrationDeadline: null }, `${day}下午2点开始，下午4点结束，限50人，每人收费100元。`))
      .toMatchObject({ startsAt: '2026-10-20T06:00:00.000Z', endsAt: '2026-10-20T08:00:00.000Z', registrationDeadline: null, capacity: 50, feeType: 'paid', feeAmountCents: 10000 })
  })

  it('keeps unknown, malformed and relative dates empty and never defaults fees', () => {
    const draft = parseActivityDraft({ title: '读书会', startsAt: '2026-10-12T14:00:00+08:00', endsAt: '2026-10-12T13:00:00+08:00', feeType: 'unknown', feeAmountCents: 100, capacity: -2, questions: [{ prompt: '职业?', type: 'invalid', required: 'yes', options: ['甲'] }] }, idea)
    expect(draft.startsAt).toBe('2026-10-12T06:00:00.000Z')
    expect(draft.endsAt).toBeNull()
    expect(draft.feeType).toBeNull()
    expect(draft.feeAmountCents).toBeNull()
    expect(draft.capacity).toBeNull()
    expect(draft.questions).toEqual([{ prompt: '职业?', type: null, required: null, options: null }])
    expect(parseActivityDraft({ startsAt: '2026-10-12T14:00:00+08:00' }, '明天下午活动').startsAt).toBeNull()
    expect(() => parseActivityDraft([], idea)).toThrow()
  })

  it('fills only explicit Chinese dates and unambiguous times when the model omits them', () => {
    const input = '【测试】2026年10月18日上午9点集合，中午12点结束。报名截止2026年10月17日18点。'
    const draft = parseActivityDraft({ title: '摄影交流', startsAt: null, endsAt: null, registrationDeadline: null }, input)
    expect(draft.startsAt).toBe('2026-10-18T01:00:00.000Z')
    expect(draft.endsAt).toBe('2026-10-18T04:00:00.000Z')
    expect(draft.registrationDeadline).toBe('2026-10-17T10:00:00.000Z')
    expect(parseActivityDraft({ startsAt: null }, '2026年10月18日9点集合').startsAt).toBeNull()
    expect(parseActivityDraft({ startsAt: null }, '2026年10月18日12点集合').startsAt).toBeNull()
    expect(parseActivityDraft({ startsAt: null }, '2026年2月30日上午9点集合').startsAt).toBeNull()
  })

  it('resolves next week across a Beijing month boundary and only assigns stated clock times', () => {
    const now = new Date('2026-10-31T18:00:00Z')
    const input = normalizeDraftDates('下周一下午两点见，免费', now)
    expect(input).toBe('2026年11月02日下午两点见，免费')
    const hours = { startsAt: '2026-11-02T14:00:00+08:00', endsAt: '2026-11-02T16:00:00+08:00' }
    expect(parseActivityDraft(hours, input)).toMatchObject({ startsAt: '2026-11-02T06:00:00.000Z', endsAt: null })
    expect(parseActivityDraft(hours, normalizeDraftDates('下周一下午见', now))).toMatchObject({ startsAt: null, endsAt: null })
    expect(parseActivityDraft(hours, normalizeDraftDates('明天下午两点见', new Date('2026-11-08T00:00:00Z'))).startsAt).toBeNull()
    expect(normalizeDraftDates('限20人', now, { field: 'capacity', date: '2026-11-02' })).toBe('限20人')
  })

  it('accepts several evidenced reply fields and leaves the existing title and other unrelated fields alone', () => {
    const answer = '地点在创客厅，限20人，免费'
    const raw = { title: '创客厅聚会', description: '聚会说明', location: '创客厅', capacity: 20, feeType: 'free', questions: [{prompt: '凭空添加'}],
      evidence: { title: '创客厅', description: '创客厅', location: '创客厅', capacity: '限20人', feeType: '免费', questions: '其他内容' } }
    expect(parseActivityDraft(raw, answer, { field: 'location' })).toMatchObject({
      title: null, description: null, location: '创客厅', capacity: 20, feeType: 'free', questions: [],
    })
  })

  it('removes explicit private contact values while preserving event topics', () => {
    const input = '微信小程序分享，手机摄影，微信号:demo_test，电话：13800000000，demo@example.com'
    const safe = withoutContactDetails(input)
    expect(safe).toContain('微信小程序分享，手机摄影')
    expect(safe).not.toMatch(/demo|13800000000/)
  })

  it('uses Beijing calendar day across UTC midnight', () => {
    expect(beijingDayBounds(new Date('2026-09-29T15:59:59Z')).map(v => v.toISOString()))
      .toEqual(['2026-09-28T16:00:00.000Z', '2026-09-29T16:00:00.000Z'])
    expect(beijingDayBounds(new Date('2026-09-29T16:00:00Z'))[0].toISOString()).toBe('2026-09-29T16:00:00.000Z')
  })
})

describe('AI draft HTTP validation', () => {
  let app: INestApplication
  let endpoint: string
  const create = vi.fn().mockResolvedValue({ draft: { title: '测试' }, missingFields: [], nextQuestion: null })
  beforeAll(async () => {
    const module = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(ActivityDraftService).useValue({ create })
      .compile()
    app = module.createNestApplication({ logger: false })
    app.setGlobalPrefix('api/v1')
    await app.listen(0, '127.0.0.1')
    endpoint = `http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}/api/v1/ai/activity-drafts`
  })
  afterAll(async () => { await app?.close() })

  it('accepts only a nonblank bounded idea and passes the bearer header to the service', async () => {
    for (const input of [{}, { idea: 10 }, { idea: ' ' }, { idea: 'a'.repeat(5001) }, { idea: '读书会', extra: true }, { idea, reply: { field: 'contact' } }, { idea, reply: { field: 'time', date: '2026-02-31' } }]) {
      const response = await fetch(endpoint, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(input) })
      expect(response.status).toBe(400)
    }
    expect(create).not.toHaveBeenCalled()
    const response = await fetch(endpoint, { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer fake' }, body: JSON.stringify({ idea }) })
    expect(response.status).toBe(200)
    expect(create).toHaveBeenCalledWith(idea, 'Bearer fake', undefined, undefined)
    const context = { known: [{ field: 'title', value: '读书会' }], recent: [], pending: ['date', 'location'] }
    for (const [conversation, status] of [
      [context, 200], [{ ...context, pending: ['telephone'] }, 400], [{ ...context, known: [null] }, 400],
      [{ ...context, recent: Array(7).fill({ field: 'title', prompt: '主题？', answer: '读书会' }) }, 400],
    ] as const) {
      const result = await fetch(endpoint, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ idea, conversation }) })
      expect(result.status).toBe(status)
    }
  })
})
