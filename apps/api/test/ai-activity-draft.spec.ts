import 'reflect-metadata'
import type { AddressInfo } from 'node:net'
import type { INestApplication } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { AppModule } from '../src/app.module.js'
import { beijingDayBounds, ActivityDraftService } from '../src/ai/service.js'
import { parseActivityDraft } from '../src/ai/parse.js'
import { AgentIsHereDraftProvider } from '../src/ai/provider.js'
import { FlowDatabase } from '../src/flow/common.js'
import { IdentityService } from '../src/flow/identity.js'

const idea = '2026年10月12日在北京举办读书会，限20人，免费，下午2点开始，4点结束。'

describe('AI activity draft validation', () => {
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

  it('uses Beijing calendar day across UTC midnight', () => {
    expect(beijingDayBounds(new Date('2026-09-29T15:59:59Z')).map(v => v.toISOString()))
      .toEqual(['2026-09-28T16:00:00.000Z', '2026-09-29T16:00:00.000Z'])
    expect(beijingDayBounds(new Date('2026-09-29T16:00:00Z'))[0].toISOString()).toBe('2026-09-29T16:00:00.000Z')
  })
})

describe('AI draft service boundary with repository and provider substitutes', () => {
  const member = { id: 'member', kind: 'member', boundPhone: '13800000000', displayName: '甲', avatarUrl: '/avatar', avatarSetByUser: true, nameSetByUser: true }
  function setup() {
    let total = 0
    let writes = 0
    let selectCalls = 0
    const tx = {
      select: () => ({ from: () => ({ where: () => (++selectCalls % 2)
        ? { for: async () => [member] } : Promise.resolve([{ total }]) }) }),
      insert: () => ({ values: async () => { writes++; total++ } }),
    }
    const database = { db: { transaction: async (work: (tx: unknown) => Promise<unknown>) => work(tx) } } as unknown as FlowDatabase
    const identity = { require: vi.fn().mockResolvedValue(member) } as unknown as IdentityService
    const provider = { generate: vi.fn().mockResolvedValue({ title: '读书会', description: '一起读书' }) } as unknown as AgentIsHereDraftProvider
    return { service: new ActivityDraftService(database, identity, provider), provider, identity, get writes() { return writes } }
  }

  it('counts only valid responses and blocks the sixth success', async () => {
    const setupResult = setup()
    const { service, provider } = setupResult
    const results = []
    for (let n = 0; n < 5; n++) results.push(await service.create(idea, 'Bearer token'))
    expect(results.map(v => v.remainingToday)).toEqual([4, 3, 2, 1, 0])
    await expect(service.create(idea, 'Bearer token')).rejects.toThrow('5 次')
    expect(provider.generate).toHaveBeenCalledTimes(5)
    expect(setupResult.writes).toBe(5)
  })

  it('does not count provider errors or invalid output', async () => {
    const setupResult = setup()
    setupResult.provider.generate = vi.fn().mockRejectedValueOnce(new Error('upstream')).mockResolvedValueOnce({})
      .mockResolvedValue({ title: '读书会' })
    await expect(setupResult.service.create(idea, 'Bearer token')).rejects.toThrow('upstream')
    await expect(setupResult.service.create(idea, 'Bearer token')).rejects.toThrow('有效草稿')
    expect(setupResult.writes).toBe(0)
    expect((await setupResult.service.create(idea, 'Bearer token')).remainingToday).toBe(4)
  })

  it('rejects incomplete profile before provider or quota access', async () => {
    const setupResult = setup()
    ;(setupResult.identity.require as ReturnType<typeof vi.fn>).mockResolvedValue({ ...member, avatarSetByUser: false })
    await expect(setupResult.service.create(idea, 'Bearer token')).rejects.toThrow('请先绑定手机号')
    expect(setupResult.provider.generate).not.toHaveBeenCalled()
  })
})

describe('AI draft HTTP validation', () => {
  let app: INestApplication
  let endpoint: string
  const create = vi.fn().mockResolvedValue({ draft: { title: '测试' }, missingFields: [], remainingToday: 4 })
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
    for (const input of [{}, { idea: 10 }, { idea: ' ' }, { idea: 'a'.repeat(5001) }, { idea: '读书会', extra: true }]) {
      const response = await fetch(endpoint, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(input) })
      expect(response.status).toBe(400)
    }
    expect(create).not.toHaveBeenCalled()
    const response = await fetch(endpoint, { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer fake' }, body: JSON.stringify({ idea }) })
    expect(response.status).toBe(200)
    expect(create).toHaveBeenCalledWith(idea, 'Bearer fake')
  })
})
