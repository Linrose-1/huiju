import 'reflect-metadata'
import type { AddressInfo } from 'node:net'
import { ValidationPipe, type INestApplication } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import { MySqlDialect } from 'drizzle-orm/mysql-core'
import type { SQL } from 'drizzle-orm'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { AdminService } from '../src/admin/service.js'
import { csrfFor } from '../src/admin/security.js'
import { adminAccounts, adminSessions } from '../src/database/schema/members.js'
import { platformMcpAudit, platformMcpPartners, type McpPartnerSnapshot } from '../src/database/schema/platform-mcp.js'
import { FlowDatabase, SafeExceptionFilter } from '../src/flow/common.js'
import { AdminMcpController } from '../src/platform/mcp-controller.js'
import { McpSettingsService } from '../src/platform/mcp-service.js'

const token = 'a'.repeat(64), origin = 'https://admin.example.test', actorId = 'mcp-test-admin'
const auth = { Cookie: `huiju_admin_session=${token}`, Origin: origin, 'X-CSRF-Token': csrfFor(token) }
const emptyPermission = { enabled: false, fields: [] }
type AuditRow = typeof platformMcpAudit.$inferSelect

function storage() {
  const state = { partners: [] as McpPartnerSnapshot[], audits: [] as AuditRow[], role: 'super_admin', failAudit: false }
  const dialect = new MySqlDialect()
  const tx = {
    select: (projection?: object) => {
      let table: unknown, key: unknown, limit = Number.POSITIVE_INFINITY, offset = 0
      const rows = () => {
        if (table === adminSessions) return [{ id: 'session', adminAccountId: actorId }]
        if (table === adminAccounts) return [{ account: { id: actorId, displayName: '测试超管', status: 'active', createdAt: new Date(0) }, credential: { username: 'mcp-admin', role: state.role } }]
        const source = table === platformMcpPartners ? state.partners : state.audits
        if (projection) return [{ value: source.length }]
        return (key ? source.filter(item => item.id === key) : [...source].reverse()).slice(offset, offset + limit)
      }
      const query = {
        from: (value: unknown) => { table = value; return query },
        innerJoin: () => query,
        where: (predicate: SQL) => { key = dialect.sqlToQuery(predicate).params[0]; return query },
        orderBy: () => query,
        limit: (value: number) => { limit = value; return query },
        offset: (value: number) => { offset = value; return query },
        for: async () => rows(),
        then: (resolve: (value: unknown) => unknown) => Promise.resolve(rows()).then(resolve),
      }
      return query
    },
    insert: (table: unknown) => ({ values: async (input: McpPartnerSnapshot | AuditRow) => {
      if (table === platformMcpPartners) state.partners.push(structuredClone(input as McpPartnerSnapshot))
      else if (table === platformMcpAudit) {
        if (state.failAudit) throw new Error('audit failure')
        state.audits.push({ ...structuredClone(input as AuditRow), createdAt: new Date(0) })
      } else throw new Error('unexpected table')
    } }),
    update: (table: unknown) => ({ set: (input: Partial<McpPartnerSnapshot>) => ({ where: async (predicate: SQL) => {
      const id = dialect.sqlToQuery(predicate).params[0]
      const row = state.partners.find(partner => partner.id === id)
      if (table !== platformMcpPartners || !row) throw new Error('unexpected update')
      Object.assign(row, structuredClone(input))
    } }) }),
  }
  const db = { transaction: async (callback: (value: typeof tx) => Promise<unknown>) => {
    const prior = structuredClone({ partners: state.partners, audits: state.audits })
    try { return await callback(tx) } catch (error) { Object.assign(state, prior); throw error }
  } }
  return { state, database: { db } as unknown as FlowDatabase }
}

describe('MCP management HTTP and transactions (storage substitute)', () => {
  const store = storage()
  let app: INestApplication, base: string
  beforeAll(async () => {
    vi.stubEnv('ADMIN_ORIGIN', origin)
    const module = await Test.createTestingModule({ controllers: [AdminMcpController], providers: [AdminService, McpSettingsService,
      { provide: FlowDatabase, useValue: store.database },
    ] }).compile()
    app = module.createNestApplication()
    app.setGlobalPrefix('api/v1')
    app.useGlobalFilters(new SafeExceptionFilter())
    app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }))
    await app.listen(0, '127.0.0.1')
    base = `http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}/api/v1`
  })
  beforeEach(() => Object.assign(store.state, { partners: [], audits: [], role: 'super_admin', failAudit: false }))
  afterAll(async () => { await app?.close(); vi.unstubAllEnvs() })
  const path = '/admin/platform/mcp'
  const call = (suffix: string, method = 'GET', input?: unknown, headers: Record<string, string> = auth) =>
    fetch(base + path + suffix, { method, headers: { 'Content-Type': 'application/json', ...headers }, body: input === undefined ? undefined : JSON.stringify(input) })
  const create = async (name: string) => {
    const response = await call('/partners', 'POST', { name, remark: '' })
    expect(response.status).toBe(201)
    return await response.json() as McpPartnerSnapshot
  }
  const body = ({ name, remark, enabled, search, detail, version }: McpPartnerSnapshot) =>
    ({ name, remark, enabled, search, detail, version })

  it('keeps the feature closed and unseeded and provides no enable or public MCP route', async () => {
    expect(await (await call('')).json()).toEqual({ enabled: false, ready: false })
    expect(await (await call('/partners')).json()).toEqual({ items: [], hasMore: false, total: 0 })
    expect(await (await call('/audit')).json()).toEqual({ items: [], hasMore: false, total: 0 })
    expect((await call('', 'PUT', { enabled: true })).status).toBe(404)
    expect((await fetch(base + '/mcp', { method: 'POST' })).status).toBe(404)
  })
  it('requires a super admin before reading or writing and enforces CSRF on writes', async () => {
    expect((await call('', 'GET', undefined, {})).status).toBe(401)
    store.state.role = 'operator'
    expect((await call('/partners')).status).toBe(403)
    expect((await call('/audit')).status).toBe(403)
    expect((await call('/partners', 'POST', { name: '对接方', remark: '' })).status).toBe(403)
    store.state.role = 'super_admin'
    expect((await call('/partners', 'POST', { name: '对接方', remark: '' }, { ...auth, 'X-CSRF-Token': 'invalid' })).status).toBe(403)
    expect(store.state.partners).toEqual([])
  })
  it('saves search and detail separately, normalizes disabled fields, and audits only changes', async () => {
    const partner = await create('  测试对接方  ')
    expect(partner).toMatchObject({ name: '测试对接方', enabled: false, search: emptyPermission, detail: emptyPermission, version: 1 })
    const changes = { ...body(partner), enabled: true, search: { enabled: true, fields: ['location'] }, detail: { enabled: false, fields: ['fee'] } }
    const response = await call('/partners/' + partner.id, 'PUT', changes)
    expect(response.status).toBe(200)
    const updated = await response.json() as McpPartnerSnapshot
    expect(updated).toMatchObject({ enabled: true, search: { enabled: true, fields: ['location'] }, detail: emptyPermission, version: 2 })
    expect((await call('/partners/' + partner.id, 'PUT', changes)).status).toBe(409)
    expect((await call('/partners/' + partner.id, 'PUT', body(updated))).status).toBe(200)
    const audit = await (await call('/audit?limit=1')).json()
    expect(audit).toMatchObject({ hasMore: true, total: 2, items: [{ actorName: '测试超管', before: partner, after: updated }] })
    expect(await (await call('/audit?limit=1&offset=1')).json()).toMatchObject({ hasMore: false, total: 2, items: [{ before: null, after: partner }] })
    expect(await (await call('')).json()).toEqual({ enabled: false, ready: false })
  })
  it('rejects unknown fields, duplicates, and attempted global switches in partner input', async () => {
    const partner = await create('测试对接方')
    for (const fields of [['contact'], ['fee', 'fee'], ['title']]) {
      expect((await call('/partners/' + partner.id, 'PUT', { ...body(partner), search: { enabled: true, fields } })).status).toBe(400)
    }
    expect((await call('/partners/' + partner.id, 'PUT', { ...body(partner), globalEnabled: true })).status).toBe(400)
    expect(store.state.partners).toEqual([partner])
    expect(store.state.audits).toHaveLength(1)
  })
  it('rolls back permission changes when recording the audit fails', async () => {
    const partner = await create('测试对接方')
    store.state.failAudit = true
    expect((await call('/partners/' + partner.id, 'PUT', { ...body(partner), enabled: true })).status).toBe(500)
    expect(store.state.partners).toEqual([partner])
    expect(store.state.audits).toHaveLength(1)
  })
})
