import 'reflect-metadata'
import type { AddressInfo } from 'node:net'
import type { INestApplication } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { AppModule } from '../src/app.module.js'
import { FlowDatabase } from '../src/database/service.js'
import { ActivitySearchService } from '../src/recommendations/service.js'

describe('recommendation HTTP contract through application assembly without database or model calls', () => {
  let app: INestApplication, base: string
  const searchId = randomUUID(), activityId = randomUUID()
  const result = { status: 'results', searchId, conditions: ['免费'], question: null, items: [], cursor: null, hasMore: false, remainingToday: 9, expiresAt: '2026-10-02T12:30:00.000Z' }
  const service = { create: vi.fn(async () => result), page: vi.fn(async () => result), impressions: vi.fn(async () => ({ ok: true })), view: vi.fn(async () => ({ sourceToken: null })) }
  const accessed = vi.fn(() => { throw new Error('Contract tests must not access a database') })
  beforeAll(async () => {
    const module = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(FlowDatabase).useValue({ get db() { return accessed() } })
      .overrideProvider(ActivitySearchService).useValue(service).compile()
    app = module.createNestApplication(); app.setGlobalPrefix('api/v1')
    await app.listen(0, '127.0.0.1')
    base = `http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}/api/v1/ai/activity-searches`
  })
  beforeEach(() => { vi.clearAllMocks() })
  afterAll(async () => { await app?.close() })
  const post = (suffix: string, body: unknown) => fetch(base + suffix, { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer member-session' }, body: JSON.stringify(body) })

  it('forwards only validated conversation and the caller authorization to the service', async () => {
    const input = { requestId: randomUUID(), messages: ['找个免费活动', '周末在杭州'] }
    const response = await post('', input)
    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(await response.json()).toEqual(result)
    expect(service.create).toHaveBeenCalledExactlyOnceWith(input, 'Bearer member-session')
    expect(accessed).not.toHaveBeenCalled()
  })
  it.each([
    { requestId: 'invalid', messages: ['活动'] },
    { requestId: randomUUID(), messages: [] },
    { requestId: randomUUID(), messages: ['   '] },
    { requestId: randomUUID(), messages: [123] },
    { requestId: randomUUID(), messages: ['x'.repeat(2001)] },
    { requestId: randomUUID(), messages: Array(13).fill('活动') },
    { requestId: randomUUID(), messages: ['活动'], profile: { phone: 'private' } },
    { requestId: randomUUID(), messages: ['活动'], remainingToday: 10 },
  ])('rejects malformed or client-supplied private/quota data before model orchestration: %j', async input => {
    expect((await post('', input)).status).toBe(400)
    expect(service.create).not.toHaveBeenCalled()
    expect(accessed).not.toHaveBeenCalled()
  })
  it('passes a cursor and authorization without creating a fresh search', async () => {
    const response = await fetch(base + `/${searchId}?cursor=opaque-page-token`, { headers: { authorization: 'Bearer member-session' } })
    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(service.page).toHaveBeenCalledExactlyOnceWith(searchId, 'opaque-page-token', 'Bearer member-session')
    expect(service.create).not.toHaveBeenCalled()
    expect((await fetch(base + `/${searchId}?cursor=${'x'.repeat(257)}`)).status).toBe(400)
    expect((await fetch(base + `/${searchId}?activityIds=${activityId}`)).status).toBe(400)
  })
  it('validates exposure batches and direct-view identity fields', async () => {
    expect((await post(`/${searchId}/impressions`, { activityIds: [activityId] })).status).toBe(200)
    expect(service.impressions).toHaveBeenCalledExactlyOnceWith(searchId, [activityId], 'Bearer member-session')
    for (const activityIds of [[], [activityId, activityId], Array.from({ length: 4 }, () => randomUUID()), ['invalid']]) {
      expect((await post(`/${searchId}/impressions`, { activityIds })).status).toBe(400)
    }
    expect(service.impressions).toHaveBeenCalledTimes(1)
    const response = await post(`/${searchId}/views`, { activityId })
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ sourceToken: null })
    expect(service.view).toHaveBeenCalledExactlyOnceWith(searchId, activityId, 'Bearer member-session')
    expect((await post(`/${searchId}/views`, { activityId, memberId: randomUUID() })).status).toBe(400)
    expect(service.view).toHaveBeenCalledTimes(1)
    expect(accessed).not.toHaveBeenCalled()
  })
})
