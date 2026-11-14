import 'reflect-metadata'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { MySqlDialect } from 'drizzle-orm/mysql-core'
import type { SQL } from 'drizzle-orm'
import { activities } from '../src/database/schema/activities.js'
import { members } from '../src/database/schema/members.js'
import { activityPosterCopies, activityPosterShares, aiPosterReservations, aiPosterUsages } from '../src/database/schema/poster.js'
import { ActivityPosterService, checkedPosterCopy, posterSourceHash, requirePosterActivity } from '../src/flow/poster-service.js'
import { parsePosterCopy, PosterCopyProvider } from '../src/ai/poster-provider.js'
import type { FlowDatabase } from '../src/flow/common.js'
import { fail } from '../src/flow/common.js'
import type { IdentityService } from '../src/flow/identity.js'
import type { WechatAdapter } from '../src/flow/wechat.js'
import { Test } from '@nestjs/testing'
import { ValidationPipe } from '@nestjs/common'
import { ActivityPosterController } from '../src/flow/poster-controller.js'
import { SafeExceptionFilter } from '../src/common/errors.js'

type Member = typeof members.$inferSelect
type Activity = typeof activities.$inferSelect
const activityId = 'd0119012-e628-4e8c-81bb-6d12ed1f65c2'
const ownerId = '008aa4bb-2fcc-478d-ac42-823a408e81a2'
const otherId = '88aa14bb-2fcc-478d-ac42-823a408e81a2'
const member = (id: string) => ({ id, kind: 'member', memberNumber: 'HJ20261105000001', inviteCode: id === ownerId ? '010101' : '020202', boundPhone: '13800000000', displayName: '会员', avatarUrl: '/avatar', avatarSetByUser: true, nameSetByUser: true }) as Member
const activity = () => ({ id: activityId, organizerMemberId: ownerId, title: '案例分享', description: '交流实际应用经验', coverUrl: '/cover.jpg',
  startsAt: new Date('2026-12-01T01:00:00Z'), endsAt: new Date('2026-12-01T03:00:00Z'), location: '上海', feeType: 'free', feeAmountCents: null,
  lifecycle: 'published', moderation: 'normal', activeRegistrationCount: 0, consultationContact: 'private-contact' }) as Activity
const candidate = { subtitle: '交流经验，共同成长', highlights: ['真实案例', '现场交流'] }
const dialect = new MySqlDialect()
const date = (value: unknown) => value instanceof Date ? value : new Date(String(value).replace(' ', 'T') + 'Z')

// Serial transactions and SQL predicates are represented here; this is not MySQL locking proof.
function repository() {
  const rows = {
    members: [member(ownerId), member(otherId)], activities: [activity()],
    copies: [] as (typeof activityPosterCopies.$inferSelect)[], shares: [] as (typeof activityPosterShares.$inferSelect)[],
    reservations: [] as (typeof aiPosterReservations.$inferSelect)[], usages: [] as (typeof aiPosterUsages.$inferSelect)[],
  }
  const key = (table: unknown) => table === members ? 'members' : table === activities ? 'activities' : table === activityPosterCopies ? 'copies'
    : table === activityPosterShares ? 'shares' : table === aiPosterReservations ? 'reservations' : table === aiPosterUsages ? 'usages' : fail('TEST_TABLE', 'unexpected')
  let activeTransactions = 0, tail = Promise.resolve()
  const db = {
    select: () => ({ from: (table: unknown) => ({ where: (where: SQL) => {
      const read = () => {
        const params = dialect.sqlToQuery(where).params, id = String(params[0])
        if (table === aiPosterUsages) return [{ total: rows.usages.filter(row => row.memberId === id && row.createdAt >= date(params[1]) && row.createdAt < date(params[2])).length }]
        const data = rows[key(table)]
        return structuredClone(data.filter(row => {
          if ('scene' in row) return params.length === 1 ? row.scene === id : row.activityId === id && row.memberId === params[1]
          if ('activityId' in row) return row.activityId === id
          if ('reservationId' in row) return row.memberId === id
          return 'id' in row && row.id === id
        }))
      }
      return { for: async () => read(), then: (resolve: (value: unknown) => unknown) => Promise.resolve(read()).then(resolve) }
    } }) }),
    insert: (table: unknown) => ({ values: (input: object) => {
      const save = (update?: object) => {
        const data = rows[key(table)] as object[]
        const old = table === activityPosterCopies ? rows.copies.find(row => row.activityId === (input as { activityId: string }).activityId)
          : table === aiPosterReservations ? rows.reservations.find(row => row.memberId === (input as { memberId: string }).memberId) : undefined
        if (old && update) Object.assign(old, structuredClone(update))
        else data.push(structuredClone(input))
      }
      return { onDuplicateKeyUpdate: async ({ set }: { set: object }) => save(set), then: (resolve: (value: unknown) => unknown) => { save(); return Promise.resolve().then(resolve) } }
    } }),
    delete: (table: unknown) => ({ where: async (where: SQL) => {
      expect(table).toBe(aiPosterReservations)
      const [id, token] = dialect.sqlToQuery(where).params
      rows.reservations = rows.reservations.filter(row => row.memberId !== id || row.reservationId !== token)
    } }),
    transaction: async (work: (tx: unknown) => Promise<unknown>) => {
      const prior = tail; let release!: () => void
      tail = new Promise<void>(resolve => { release = resolve }); await prior
      const before = structuredClone(rows); activeTransactions++
      try { return await work(db) } catch (error) { Object.assign(rows, before); throw error }
      finally { activeTransactions--; release() }
    },
  }
  return { rows, database: { db } as unknown as FlowDatabase, get activeTransactions() { return activeTransactions } }
}
function setup(store = repository()) {
  const identity = { require: vi.fn(async (header?: string) => {
    if (!header) fail('UNAUTHORIZED', '请登录', 401)
    return store.rows.members.find(row => row.id === header) || fail('UNAUTHORIZED', '请登录', 401)
  }) }
  const provider = { generate: vi.fn(async (): Promise<unknown> => { expect(store.activeTransactions).toBe(0); return candidate }) }
  const wechat = { activityCode: vi.fn(async () => ({ base64: 'verified-image', mimeType: 'image/png' as const })) }
  const service = new ActivityPosterService(store.database, identity as unknown as IdentityService, provider as unknown as PosterCopyProvider, wechat as unknown as WechatAdapter)
  const input = () => ({ ...candidate, sourceHash: posterSourceHash(store.rows.activities[0]!), version: store.rows.copies[0]?.version ?? 0 })
  return { store, service, provider, wechat, identity, input }
}
const code = (value: string) => ({ response: { code: value } })
function pending() { let resolve!: (value: unknown) => void; const promise = new Promise<unknown>(yes => { resolve = yes }); return { promise, resolve } }
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.unstubAllEnvs() })

describe('poster copy and sharing boundaries', () => {
  it('returns base information without unconfirmed content and without private fields', async () => {
    const f = setup(), result = await f.service.read(activityId, otherId)
    expect(result).toMatchObject({ copyStatus: 'none', subtitle: '', highlights: [], canEdit: false, version: 0 })
    expect(result).not.toHaveProperty('consultationContact')
    expect(result).toMatchObject({ hostOrganization: null, organizingOrganization: null, sponsorOrganization: null })
    await expect(f.service.read(activityId)).rejects.toMatchObject(code('UNAUTHORIZED'))
  })
  it('reads the organizer’s current public name and credits when another member shares', async () => {
    const f = setup()
    await f.service.save(activityId, f.input(), ownerId)
    f.store.rows.members[0]!.displayName = '发起人昵称'
    f.store.rows.members[1]!.displayName = '转发人昵称'
    const units = { hostOrganization: '主办', organizingOrganization: '承办', sponsorOrganization: '赞助' }
    Object.assign(f.store.rows.activities[0]!, units)
    expect(await f.service.read(activityId, otherId)).toMatchObject({ organizerName: '发起人昵称', ...units, canEdit: false, copyStatus: 'confirmed' })
  })
  it('allows only a complete organizer to confirm, protects version, and shares confirmed copy', async () => {
    const f = setup()
    await expect(f.service.save(activityId, f.input(), otherId)).rejects.toMatchObject(code('FORBIDDEN'))
    expect((await f.service.save(activityId, f.input(), ownerId)).version).toBe(1)
    expect(await f.service.read(activityId, otherId)).toMatchObject({ ...candidate, copyStatus: 'confirmed', canEdit: false })
    await expect(f.service.save(activityId, { ...f.input(), version: 0 }, ownerId)).rejects.toMatchObject(code('POSTER_VERSION_CONFLICT'))
    f.store.rows.members[0]!.boundPhone = null
    await expect(f.service.save(activityId, f.input(), ownerId)).rejects.toMatchObject(code('PROFILE_INCOMPLETE'))
    expect(f.store.rows.copies).toHaveLength(1)
  })
  it('invalidates copy on factual change but not on signup counters', async () => {
    const f = setup(), input = f.input()
    await f.service.save(activityId, input, ownerId)
    f.store.rows.activities[0]!.activeRegistrationCount++
    expect((await f.service.read(activityId, otherId)).copyStatus).toBe('confirmed')
    f.store.rows.activities[0]!.location = '北京'
    expect(await f.service.read(activityId, otherId)).toMatchObject({ copyStatus: 'stale', subtitle: '', highlights: [], version: 1 })
    await expect(f.service.save(activityId, { ...input, version: 1 }, ownerId)).rejects.toMatchObject(code('POSTER_SOURCE_CHANGED'))
  })
  it.each(['draft', 'cancelled', 'removed'])('refuses %s activities for poster reads and codes', async status => {
    const f = setup()
    if (status === 'removed') f.store.rows.activities[0]!.moderation = 'removed'
    else f.store.rows.activities[0]!.lifecycle = status as 'draft' | 'cancelled'
    await expect(f.service.read(activityId, ownerId)).rejects.toBeDefined()
    await expect(f.service.code(activityId, ownerId)).rejects.toBeDefined()
    expect(f.wechat.activityCode).not.toHaveBeenCalled()
  })
  it('uses the caller identity for a permanent code and allows identified visitors', async () => {
    const f = setup(); f.store.rows.members[1]!.boundPhone = null
    const first = await f.service.code(activityId, otherId), again = await f.service.code(activityId, otherId)
    expect(first.scene).toMatch(/^p[a-f0-9]{24}$/); expect(again).toEqual(first)
    expect(f.store.rows.shares).toHaveLength(1); expect(f.wechat.activityCode).toHaveBeenCalledTimes(1)
    expect(await f.service.resolve(first.scene)).toEqual({ activityId, inviteCode: '020202' })
    expect((await f.service.code(activityId, ownerId)).scene).not.toBe(first.scene)
    f.store.rows.activities[0]!.moderation = 'removed'
    await expect(f.service.resolve(first.scene)).rejects.toMatchObject(code('ACTIVITY_UNAVAILABLE'))
  })
  it('rejects unknown scene, prevents duplicate requests and bounds code traffic', async () => {
    const f = setup()
    await expect(f.service.resolve('bad')).rejects.toMatchObject(code('INVALID_POSTER_SCENE'))
    await expect(f.service.resolve('p' + '0'.repeat(24))).rejects.toMatchObject(code('NOT_FOUND'))
    for (let n = 0; n < 30; n++) await f.service.code(activityId, ownerId)
    await expect(f.service.code(activityId, ownerId)).rejects.toMatchObject(code('POSTER_CODE_LIMITED'))
    expect(f.wechat.activityCode).toHaveBeenCalledTimes(1)
  })
  it('does not return a code when activity was removed during the external call', async () => {
    const f = setup()
    f.wechat.activityCode.mockImplementation(async () => {
      f.store.rows.activities[0]!.moderation = 'removed'
      return { base64: 'image', mimeType: 'image/png' }
    })
    await expect(f.service.code(activityId, ownerId)).rejects.toMatchObject(code('ACTIVITY_UNAVAILABLE'))
  })
  it('rejects duplicate code generation and releases the guard after a provider error', async () => {
    const f = setup()
    let reject!: (error: Error) => void
    f.wechat.activityCode.mockImplementationOnce(() => new Promise((_resolve, no) => { reject = no }))
    const first = f.service.code(activityId, ownerId), rejected = expect(first).rejects.toThrow('unavailable')
    await vi.waitFor(() => expect(f.wechat.activityCode).toHaveBeenCalledOnce())
    await expect(f.service.code(activityId, ownerId)).rejects.toMatchObject(code('POSTER_CODE_BUSY'))
    reject(new Error('unavailable')); await rejected
    expect((await f.service.code(activityId, ownerId)).scene).toBe(f.store.rows.shares[0]!.scene)
  })
})

describe('poster AI reservation and confirmation separation', () => {
  it('does not hold transactions during generation, charges successful results and never auto-confirms', async () => {
    const f = setup()
    expect(await f.service.draft(activityId, ownerId)).toMatchObject({ ...candidate, remainingToday: 4 })
    expect(f.provider.generate).toHaveBeenCalledWith({ title: '案例分享', description: '交流实际应用经验' })
    expect(f.store.rows.copies).toEqual([]); expect(f.store.rows.usages).toHaveLength(1)
    expect(f.store.rows.reservations).toEqual([])
  })
  it('independently limits each member to five successful poster drafts', async () => {
    const f = setup()
    for (let n = 0; n < 5; n++) expect((await f.service.draft(activityId, ownerId)).remainingToday).toBe(4 - n)
    await expect(f.service.draft(activityId, ownerId)).rejects.toMatchObject(code('AI_POSTER_DAILY_LIMIT'))
    expect(f.provider.generate).toHaveBeenCalledTimes(5)
  })
  it('does not call AI for another member and does not charge malformed or failed results', async () => {
    const f = setup()
    await expect(f.service.draft(activityId, otherId)).rejects.toMatchObject(code('FORBIDDEN'))
    f.provider.generate.mockResolvedValueOnce({}).mockRejectedValueOnce(new Error('provider error'))
    await expect(f.service.draft(activityId, ownerId)).rejects.toMatchObject(code('AI_POSTER_FAILED'))
    await expect(f.service.draft(activityId, ownerId)).rejects.toThrow('provider error')
    expect(f.store.rows.usages).toEqual([]); expect(f.store.rows.reservations).toEqual([])
  })
  it('rejects activity edits during model wait without charging or auto-publishing', async () => {
    const f = setup(), response = pending()
    f.provider.generate.mockImplementation(() => response.promise)
    const work = f.service.draft(activityId, ownerId)
    const rejected = expect(work).rejects.toMatchObject(code('POSTER_SOURCE_CHANGED'))
    await vi.waitFor(() => expect(f.provider.generate).toHaveBeenCalledOnce())
    expect(f.store.activeTransactions).toBe(0)
    f.store.rows.activities[0]!.title = '新的活动'
    response.resolve(candidate); await rejected
    expect(f.store.rows.usages).toEqual([]); expect(f.store.rows.copies).toEqual([])
  })
  it('fences expired calls across service instances and preserves newer reservations', async () => {
    vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date('2026-11-05T01:00:00Z'))
    const f = setup(), other = setup(f.store), first = pending(), second = pending()
    f.provider.generate.mockImplementation(() => first.promise); other.provider.generate.mockImplementation(() => second.promise)
    const old = f.service.draft(activityId, ownerId), rejected = expect(old).rejects.toMatchObject(code('AI_GENERATION_EXPIRED'))
    await vi.waitFor(() => expect(f.provider.generate).toHaveBeenCalledOnce())
    await expect(other.service.draft(activityId, ownerId)).rejects.toMatchObject(code('AI_GENERATION_IN_PROGRESS'))
    vi.setSystemTime(new Date('2026-11-05T01:02:00Z'))
    const newer = other.service.draft(activityId, ownerId)
    await vi.waitFor(() => expect(other.provider.generate).toHaveBeenCalledOnce())
    const token = f.store.rows.reservations[0]!.reservationId
    first.resolve(candidate); await rejected
    expect(f.store.rows.reservations[0]!.reservationId).toBe(token)
    second.resolve(candidate); expect((await newer).remainingToday).toBe(4)
  })
  it('counts success on the completion day after crossing Beijing midnight', async () => {
    vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date('2026-11-05T15:59:30Z'))
    const f = setup()
    for (let n = 0; n < 4; n++) await f.service.draft(activityId, ownerId)
    f.provider.generate.mockImplementationOnce(async () => {
      vi.setSystemTime(new Date('2026-11-05T16:00:01Z'))
      return candidate
    })
    expect((await f.service.draft(activityId, ownerId)).remainingToday).toBe(4)
    expect(f.store.rows.usages).toHaveLength(5)
  })
})

describe('poster parsing and provider payload', () => {
  it('validates fixed-length text and excludes invented factual fields', () => {
    expect(parsePosterCopy(candidate)).toEqual(candidate)
    for (const value of [{}, { ...candidate, date: 'tomorrow' }, { ...candidate, highlights: ['a'.repeat(25)] }, { ...candidate, subtitle: 'a'.repeat(41) }]) {
      expect(() => parsePosterCopy(value)).toThrow()
    }
    expect(() => checkedPosterCopy({ subtitle: 'line\nbreak', highlights: [] })).toThrow()
    expect(checkedPosterCopy({ subtitle: '', highlights: [] })).toEqual({ subtitle: '', highlights: [] })
    expect(() => requirePosterActivity(undefined)).toThrow()
  })
  it('sends only title and description and uses bounded completion tokens', async () => {
    vi.stubEnv('AI_PROVIDER', 'agentishere'); vi.stubEnv('AI_API_KEY', 'test-only'); vi.stubEnv('AI_BASE_URL', 'https://example.invalid/v1')
    const fetcher = vi.fn(async (_url: unknown, options: RequestInit) => {
      const body = JSON.parse(String(options.body))
      expect(body.max_completion_tokens).toBe(800)
      expect(JSON.parse(body.messages[1].content)).toEqual({ title: '案例', description: '内容' })
      return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(candidate) } }] }))
    })
    vi.stubGlobal('fetch', fetcher)
    expect(await new PosterCopyProvider().generate({ title: '案例', description: '内容', privatePhone: 'secret' } as { title: string; description: string })).toEqual(candidate)
    expect(fetcher).toHaveBeenCalledOnce()
  })
})

it('exercises actual HTTP routes, DTO validation and authenticated/public response boundaries with a repository substitute', async () => {
  const f = setup()
  const module = await Test.createTestingModule({ controllers: [ActivityPosterController], providers: [{ provide: ActivityPosterService, useValue: f.service }] }).compile()
  const app = module.createNestApplication({ logger: false })
  app.setGlobalPrefix('api/v1')
  app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }))
  app.useGlobalFilters(new SafeExceptionFilter())
  await app.listen(0, '127.0.0.1')
  const base = await app.getUrl(), path = `/api/v1/activities/${activityId}/poster`, ownerPath = `/api/v1/organizer/activities/${activityId}/poster`
  const request = (path: string, method = 'GET', token?: string, body?: unknown) => fetch(base + path, {
    method, headers: { ...(token ? { authorization: token } : {}), 'content-type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}),
  })
  try {
    expect((await request(path)).status).toBe(401)
    expect((await request('/api/v1/activities/not-uuid/poster', 'GET', ownerId)).status).toBe(400)
    expect((await request(ownerPath, 'PUT', ownerId, { ...f.input(), inviteCode: 'forged' })).status).toBe(400)
    expect((await request(ownerPath, 'PUT', ownerId, { ...f.input(), highlights: ['a', 'b', 'c'] })).status).toBe(400)
    expect((await request(ownerPath, 'PUT', otherId, f.input())).status).toBe(403)
    const saved = await request(ownerPath, 'PUT', ownerId, f.input())
    expect(saved.status).toBe(200); expect(saved.headers.get('cache-control')).toBe('no-store')
    expect(await saved.json()).toMatchObject({ version: 1, copyStatus: 'confirmed' })
    expect((await request(ownerPath, 'PUT', ownerId, { ...f.input(), version: 0 })).status).toBe(409)
    const codeResponse = await request(path + '-code', 'POST', otherId)
    expect(codeResponse.status).toBe(200)
    const { scene } = await codeResponse.json() as { scene: string }
    const resolved = await request('/api/v1/activity-posters/resolve/' + scene)
    expect(resolved.status).toBe(200)
    expect(Object.keys(await resolved.json() as object).sort()).toEqual(['activityId', 'inviteCode'])
    const draftResponse = await request(ownerPath + '-draft', 'POST', ownerId)
    expect(draftResponse.status).toBe(200)
    expect(await draftResponse.json()).toMatchObject({ ...candidate, remainingToday: 4 })
  } finally { await app.close() }
})
