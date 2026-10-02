import 'reflect-metadata'
import type { AddressInfo } from 'node:net'
import { ValidationPipe, type INestApplication } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import { beforeAll, afterAll, describe, expect, it, vi } from 'vitest'
import { randomUUID } from 'node:crypto'
import { CircleController } from '../src/circle/controller.js'
import { AdminCircleController } from '../src/admin/circle-controller.js'
import { CircleService } from '../src/circle/service.js'
import { AdminService } from '../src/admin/service.js'
import { FlowDatabase, SafeExceptionFilter } from '../src/flow/common.js'
describe('circle HTTP DTOs and administrator authorization without a database', () => {
  let app: INestApplication, base: string
  const circle = { list: vi.fn(async () => ({ items: [], hasMore: false })), save: vi.fn(async () => ({ id: randomUUID() })), intent: vi.fn(async () => ({ ok: true })) }
  const accessed = vi.fn(() => { throw new Error('Database access forbidden in this test') })
  beforeAll(async () => {
    const module = await Test.createTestingModule({ controllers: [CircleController, AdminCircleController], providers: [AdminService,
      { provide: CircleService, useValue: circle }, { provide: FlowDatabase, useValue: { get db() { return accessed() } } }] }).compile()
    app = module.createNestApplication(); app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true })); app.useGlobalFilters(new SafeExceptionFilter())
    await app.listen(0, '127.0.0.1'); base = `http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}`
  })
  afterAll(async () => { await app.close() })
  it('allows anonymous public browsing and transforms pagination', async () => {
    const response = await fetch(base + '/circle/posts?offset=20&limit=5&category=store')
    expect(response.status).toBe(200); expect(await response.json()).toEqual({ items: [], hasMore: false })
    expect(circle.list).toHaveBeenLastCalledWith(expect.objectContaining({ offset: 20, limit: 5, category: 'store' }))
    expect(response.headers.get('cache-control')).toBe('no-store')
  })
  it.each(['/circle/posts?limit=101', '/circle/posts?offset=-1', '/circle/posts?category=unknown'])('rejects invalid query %s', async path => {
    expect((await fetch(base + path)).status).toBe(400)
  })
  it('rejects external URLs, seven images and unexpected fields before service calls', async () => {
    const body = { requestId: randomUUID(), category: 'service', title: '服务', body: '内容', imageIds: [] }
    for (const fields of [{ imageIds: ['https://external/image.png'] }, { imageIds: Array.from({ length: 7 }, () => randomUUID()) }, { officialStore: true }]) {
      const response = await fetch(base + '/circle/posts', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...body, ...fields }) })
      expect(response.status).toBe(400)
    }
    expect(circle.save).not.toHaveBeenCalled()
  })
  it('requires explicit phone and request identifier for intent submission', async () => {
    const response = await fetch(base + '/circle/posts/' + randomUUID() + '/intents', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })
    expect(response.status).toBe(400); expect(circle.intent).not.toHaveBeenCalled()
  })
  it('rejects anonymous and member-token admin reads/writes without database access', async () => {
    for (const authorization of ['', 'Bearer member-token']) for (const method of ['GET', 'POST']) {
      const path = '/admin/circle/posts' + (method === 'POST' ? '/' + randomUUID() + '/remove' : '')
      const response = await fetch(base + path, { method, headers: { authorization, 'content-type': 'application/json' }, ...(method === 'POST' ? { body: JSON.stringify({ reason: '原因' }) } : {}) })
      expect(response.status).toBe(401)
    }
    expect(accessed).not.toHaveBeenCalled()
  })
})
