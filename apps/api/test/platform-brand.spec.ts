import 'reflect-metadata'
import type { AddressInfo } from 'node:net'
import { ValidationPipe, type INestApplication } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { AdminService } from '../src/admin/service.js'
import { csrfFor } from '../src/admin/security.js'
import { adminAccounts, adminSessions } from '../src/database/schema/members.js'
import { platformBrand, platformBrandAudit, type BrandSnapshot } from '../src/database/schema/platform-brand.js'
import { FlowDatabase, SafeExceptionFilter } from '../src/flow/common.js'
import { AdminBrandController, PublicBrandController } from '../src/platform/brand-controller.js'
import { BrandService } from '../src/platform/brand-service.js'

const token = 'a'.repeat(64), origin = 'https://admin.example.test', actorId = 'brand-test-admin'
const auth = { Cookie: `huiju_admin_session=${token}`, Origin: origin, 'X-CSRF-Token': csrfFor(token) }
type BrandRow = BrandSnapshot & { id: string }
type Audit = { actorId: string; before: BrandSnapshot; after: BrandSnapshot }

// A transaction-aware storage substitute: exercises the real services/controllers,
// but deliberately does not claim MySQL locking or database constraint coverage.
function storage() {
  const state = { brand: null as BrandRow | null, audits: [] as Audit[], role: 'super_admin', failAudit: false, locks: [] as unknown[] }
  const rows = (table: unknown) => {
    if (table === platformBrand) return state.brand ? [{ ...state.brand }] : []
    if (table === adminSessions) return [{ id: 'session', adminAccountId: actorId }]
    if (table === adminAccounts) return [{ account: { id: actorId, displayName: '测试超管', status: 'active', createdAt: new Date(0) }, credential: { username: 'brand-admin', role: state.role } }]
    throw new Error('Unexpected test table')
  }
  const tx = {
    select: () => {
      let table: unknown
      const query = {
        from: (value: unknown) => { table = value; return query },
        innerJoin: () => query, where: () => query,
        limit: async () => rows(table),
        for: async (lock: string) => { state.locks.push([table, lock]); return rows(table) },
        then: (resolve: (value: unknown) => unknown) => Promise.resolve(rows(table)).then(resolve),
      }
      return query
    },
    insert: (table: unknown) => ({ values: (value: BrandRow | Audit) => {
      if (table === platformBrand) return { onDuplicateKeyUpdate: async () => { state.brand ??= { ...value as BrandRow } } }
      if (table !== platformBrandAudit) throw new Error('Unexpected test insert')
      if (state.failAudit) throw new Error('simulated audit storage failure')
      state.audits.push(structuredClone(value as Audit))
      return Promise.resolve()
    } }),
    update: (table: unknown) => ({ set: (value: BrandSnapshot) => ({ where: async () => {
      if (table !== platformBrand || !state.brand) throw new Error('Unexpected test update')
      Object.assign(state.brand, value)
    } }) }),
  }
  const db = { ...tx, transaction: async (callback: (value: typeof tx) => Promise<unknown>) => {
    const previous = structuredClone({ brand: state.brand, audits: state.audits })
    try { return await callback(tx) }
    catch (error) { state.brand = previous.brand; state.audits = previous.audits; throw error }
  } }
  return { state, database: { db } as unknown as FlowDatabase }
}

describe('platform brand HTTP and service boundaries (storage substitute, no database)', () => {
  let app: INestApplication, base: string
  const store = storage()
  beforeAll(async () => {
    vi.stubEnv('ADMIN_ORIGIN', origin)
    const module = await Test.createTestingModule({ controllers: [PublicBrandController, AdminBrandController], providers: [BrandService, AdminService,
      { provide: FlowDatabase, useValue: store.database },
    ] }).compile()
    app = module.createNestApplication()
    app.setGlobalPrefix('api/v1')
    app.useGlobalFilters(new SafeExceptionFilter())
    app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }))
    await app.listen(0, '127.0.0.1')
    base = `http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}/api/v1`
  })
  beforeEach(() => {
    store.state.brand = null; store.state.audits = []; store.state.role = 'super_admin'; store.state.failAudit = false; store.state.locks = []
  })
  afterAll(async () => { await app?.close(); vi.unstubAllEnvs() })
  const put = (body: unknown, headers: Record<string, string> = auth) => fetch(`${base}/admin/platform/brand`, {
    method: 'PUT', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body),
  })

  it('serves the public default without creating a singleton, exposes version only to the super admin', async () => {
    const response = await fetch(`${base}/platform/brand`)
    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(await response.json()).toEqual({ displayName: '有聚点', visible: true })
    const admin = await fetch(`${base}/admin/platform/brand`, { headers: auth })
    expect(await admin.json()).toEqual({ displayName: '有聚点', visible: true, version: 0 })
    expect(store.state.brand).toBeNull()
    expect(store.state.audits).toEqual([])
  })

  it('rejects anonymous and member bearer management access and ordinary operators for reads and writes', async () => {
    for (const headers of [{}, { Authorization: 'Bearer member-token' }] as Record<string, string>[]) {
      expect((await fetch(`${base}/admin/platform/brand`, { headers })).status).toBe(401)
      expect((await put({ displayName: '测试', visible: true, version: 0 }, headers)).status).toBe(401)
    }
    store.state.role = 'operator'
    expect((await fetch(`${base}/admin/platform/brand`, { headers: auth })).status).toBe(403)
    const response = await put({ displayName: '测试', visible: true, version: 0 })
    expect(response.status).toBe(403)
    expect(await response.json()).toMatchObject({ code: 'ADMIN_FORBIDDEN' })
    expect(store.state.brand).toBeNull()
    expect(store.state.audits).toEqual([])
  })

  it('requires both trusted Origin and matching CSRF for every write', async () => {
    for (const headers of [{ ...auth, Origin: 'https://foreign.example.test' }, { Cookie: auth.Cookie, Origin: origin }, { ...auth, 'X-CSRF-Token': 'wrong' }]) {
      expect((await put({ displayName: '测试', visible: true, version: 0 }, headers)).status).toBe(403)
    }
    expect(store.state.brand).toBeNull()
    expect(store.state.audits).toEqual([])
  })

  it.each([
    { displayName: '' }, { displayName: ' \n\t ' }, { displayName: '名'.repeat(31) }, { displayName: 123 },
    { visible: 'false' }, { visible: null }, { version: -1 }, { version: 0.5 }, { version: '0' }, { unknown: 'field' },
  ])('rejects invalid input through Nest validation: %j', async change => {
    const response = await put({ displayName: '测试', visible: true, version: 0, ...change })
    expect(response.status).toBe(400)
    expect(await response.json()).toMatchObject({ code: 'INVALID_INPUT' })
    expect(store.state.brand).toBeNull()
  })

  it('trims names, locks the singleton, increments version and records before/after with the actor', async () => {
    const response = await put({ displayName: '  学加  ', visible: false, version: 0 })
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ displayName: '学加', visible: false, version: 1 })
    expect(store.state.locks).toContainEqual([platformBrand, 'update'])
    expect(store.state.audits).toHaveLength(1)
    expect(store.state.audits[0]).toMatchObject({ actorId, before: { displayName: '有聚点', visible: true, version: 0 }, after: { displayName: '学加', visible: false, version: 1 } })
    const publicResponse = await fetch(`${base}/platform/brand`)
    expect(await publicResponse.json()).toEqual({ displayName: '学加', visible: false })
    const next = await put({ displayName: '有聚点', visible: true, version: 1 })
    expect(await next.json()).toEqual({ displayName: '有聚点', visible: true, version: 2 })
    expect(store.state.audits[1]?.before.version).toBe(1)
  })

  it('returns a conflict without overwriting newer data or appending an audit', async () => {
    await put({ displayName: '已保存', visible: true, version: 0 })
    const response = await put({ displayName: '旧页面', visible: false, version: 0 })
    expect(response.status).toBe(409)
    expect(await response.json()).toMatchObject({ code: 'BRAND_VERSION_CONFLICT' })
    expect(store.state.brand).toMatchObject({ displayName: '已保存', visible: true, version: 1 })
    expect(store.state.audits).toHaveLength(1)
  })

  it('rolls back first-row initialization on a version conflict and rolls back an update if audit insertion fails', async () => {
    expect((await put({ displayName: '过期配置', visible: true, version: 1 })).status).toBe(409)
    expect(store.state.brand).toBeNull()
    await put({ displayName: '原名称', visible: true, version: 0 })
    store.state.failAudit = true
    const response = await put({ displayName: '不能保存', visible: false, version: 1 })
    expect(response.status).toBe(500)
    expect(await response.json()).toMatchObject({ code: 'SERVICE_UNAVAILABLE' })
    expect(store.state.brand).toMatchObject({ displayName: '原名称', visible: true, version: 1 })
    expect(store.state.audits).toHaveLength(1)
  })
})
