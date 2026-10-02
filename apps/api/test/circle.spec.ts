import 'reflect-metadata'
import { randomUUID } from 'node:crypto'
import { MySqlDialect } from 'drizzle-orm/mysql-core'
import { describe, expect, it, vi } from 'vitest'
import { plainToInstance } from 'class-transformer'
import { validate } from 'class-validator'
import { CircleService, postValues, postState, type CircleTx } from '../src/circle/service.js'
import { CircleWriteInput, CircleIntentInput, CircleQuery } from '../src/circle/dto.js'
import { FlowDatabase } from '../src/flow/common.js'
import { IdentityService } from '../src/flow/identity.js'
import { circlePosts, circleIntents, circleOperations } from '../src/database/schema/circle.js'
import type { SQL } from 'drizzle-orm'

const author = { id: randomUUID(), boundPhone: '19900000001', displayName: '学友', avatarUrl: '/avatar.png', avatarSetByUser: true, nameSetByUser: true }
const viewer = { ...author, id: randomUUID() }
const input = (): CircleWriteInput => ({ requestId: randomUUID(), category: 'park', subtype: 'rent', title: ' 空间出租 ', body: ' 完整正文 ', imageIds: [] })
const post = () => ({ id: randomUUID(), authorId: author.id, requestId: randomUUID(), category: 'park', subtype: 'rent', title: '空间出租', body: '完整正文',
  location: '园区东侧', area: '120㎡', price: '5000元/月', validUntil: null, storeName: null, lifecycle: 'open', moderation: 'normal', removalReason: null,
  createdAt: new Date('2026-09-30'), updatedAt: new Date('2026-09-30') })
function fixture(results: unknown[][] = [], user: typeof author | undefined | null = author) {
  const filters: SQL[] = [], calls: { method: string; args: unknown[] }[] = [], writes: { table: unknown; values: unknown }[] = []
  const tx = {
    select: vi.fn(() => {
      const query: Record<string, unknown> = {}
      for (const method of ['from', 'innerJoin', 'leftJoin', 'orderBy', 'limit', 'offset', 'for']) query[method] = (...args: unknown[]) => { calls.push({ method, args }); return query }
      query.where = (filter: SQL) => { filters.push(filter); return query }
      query.then = (resolve: (rows: unknown[]) => unknown) => { if (!results.length) throw new Error('Unexpected query'); return Promise.resolve(results.shift()!).then(resolve) }
      return query
    }),
    insert: vi.fn((table: unknown) => ({ values: async (values: unknown) => { writes.push({ table, values }) } })),
    update: vi.fn((table: unknown) => ({ set: (values: unknown) => ({ where: async () => { writes.push({ table, values }) } }) })),
    delete: vi.fn((table: unknown) => ({ where: async () => { writes.push({ table, values: 'delete' }) } })),
  } as unknown as CircleTx
  const transaction = vi.fn(async (callback: (tx: CircleTx) => Promise<unknown>) => callback(tx))
  const require = vi.fn(async (_header?: string, optional = false) => {
    if (!user && !optional) throw new Error('请先登录')
    return user
  })
  const service = new CircleService({ db: { ...tx, transaction } } as unknown as FlowDatabase, { require } as unknown as IdentityService)
  return { service, tx, results, writes, calls, filters, require, transaction }
}
describe('circle input and ownership rules', () => {
  it('normalizes required fields and keeps optional blank fields absent', () => {
    expect(postValues({ ...input(), location: ' ', area: '' })).toMatchObject({ title: '空间出租', body: '完整正文', location: null, area: null })
    expect(postValues({ ...input(), category: 'operation', area: '忽略' })).toMatchObject({ subtype: null, area: null, price: null })
  })
  it.each([{ title: ' ' }, { body: '\n' }, { subtype: null }, { validUntil: '2026-02-30' }, { validUntil: 'xxxx' }])('rejects incomplete fields: %j', change => {
    expect(() => postValues({ ...input(), ...change } as CircleWriteInput)).toThrow()
  })
  it('requires store name without introducing official-store fields', () => {
    expect(() => postValues({ ...input(), category: 'store' })).toThrow('门店名称')
    expect(postValues({ ...input(), category: 'store', storeName: ' 门店 ' })).toMatchObject({ storeName: '门店', subtype: null })
  })
  it('validates six own image IDs, phone format and bounded pagination at protocol boundary', async () => {
    for (const patch of [{ imageIds: Array.from({ length: 7 }, () => randomUUID()) }, { imageIds: [randomUUID(), 'https://external/image'] }, { title: ' ' }]) {
      expect((await validate(plainToInstance(CircleWriteInput, { ...input(), ...patch }))).length).toBeGreaterThan(0)
    }
    expect(await validate(plainToInstance(CircleWriteInput, input()))).toEqual([])
    expect((await validate(plainToInstance(CircleIntentInput, { requestId: randomUUID(), phone: 'private text' }))).length).toBeGreaterThan(0)
    for (const query of [{ limit: 101 }, { offset: -1 }, { category: 'unknown' }]) expect((await validate(plainToInstance(CircleQuery, query))).length).toBeGreaterThan(0)
  })
  it('gives moderation precedence without changing the ended lifecycle', () => {
    expect(postState({ moderation: 'removed', lifecycle: 'ended' })).toBe('removed')
    expect(postState({ moderation: 'normal', lifecycle: 'ended' })).toBe('ended')
  })
})
describe('circle service with query-result substitute', () => {
  it('redacts removed public details and does not query author or attachments', async () => {
    const p = { ...post(), moderation: 'removed' }, f = fixture([[p]], null)
    const result = await f.service.detail(p.id)
    expect(result).toMatchObject({ title: '内容已下架', body: '', images: [], author: null, removalReason: null, state: 'removed' })
    expect(JSON.stringify(result)).not.toContain(p.location)
    expect(f.tx.select).toHaveBeenCalledTimes(1)
  })
  it('rejects another member before exposing manage details or intent contacts', async () => {
    const p = post()
    for (const action of ['detail', 'intents'] as const) {
      const f = fixture([[p]], viewer)
      await expect(action === 'detail' ? f.service.detail(p.id, 'token', true) : f.service.intents(p.id, { offset: 0, limit: 20 }, 'token')).rejects.toThrow('仅发布者')
      expect(f.tx.select).toHaveBeenCalledTimes(1)
    }
  })
  it('does not expose phone fields in public details', async () => {
    const p = post(), f = fixture([[p], [{ id: author.id, displayName: author.displayName, avatarUrl: author.avatarUrl }], []], viewer)
    expect(JSON.stringify(await f.service.detail(p.id, 'token'))).not.toMatch(/phone|boundPhone|19900000001/)
  })
  it('rejects incomplete profiles before writes', async () => {
    const f = fixture([[{ ...author, avatarSetByUser: false }]])
    await expect(f.service.save(input(), 'token')).rejects.toThrow('绑定手机号')
    expect(f.writes).toEqual([])
  })
  it('rejects images belonging to another uploader and propagates transaction failure', async () => {
    const p = post(), f = fixture([[author], [], [{ id: randomUUID(), ownerId: viewer.id }]])
    await expect(f.service.save({ ...input(), imageIds: [randomUUID()] }, 'token')).rejects.toThrow('本人上传')
    expect(f.transaction).toHaveBeenCalledTimes(1)
    expect(f.writes.filter(w => w.table === circlePosts)).toHaveLength(1)
    expect(p.authorId).toBe(author.id)
  })
  it.each(['ended', 'removed'])('rejects new intent after %s under a post row lock', async state => {
    const p = { ...post(), lifecycle: state === 'ended' ? 'ended' : 'open', moderation: state === 'removed' ? 'removed' : 'normal' }
    const f = fixture([[viewer], [p], []], viewer)
    await expect(f.service.intent(p.id, { phone: '13800000000', requestId: randomUUID() }, 'token')).rejects.toThrow('不再接收')
    expect(f.writes).toEqual([])
    expect(f.calls.filter(c => c.method === 'for')).toHaveLength(2)
  })
  it('returns acknowledged retries without creating duplicate intents even after removal', async () => {
    const p = { ...post(), moderation: 'removed' }, f = fixture([[viewer], [p], [{ id: randomUUID() }]], viewer)
    expect(await f.service.intent(p.id, { phone: '13800000000', requestId: randomUUID() }, 'token')).toEqual({ ok: true })
    expect(f.writes).toEqual([])
  })
  it('stores only the explicitly supplied phone, not the bound phone', async () => {
    const p = post(), f = fixture([[viewer], [p], []], viewer)
    await f.service.intent(p.id, { phone: '13800000000', requestId: randomUUID() }, 'token')
    expect(f.writes[0]).toMatchObject({ table: circleIntents, values: { phone: '13800000000', memberId: viewer.id, postId: p.id } })
  })
  it('rechecks a changed profile inside the intent transaction before locking or writing the post', async () => {
    const f = fixture([[{ ...viewer, nameSetByUser: false }]], viewer)
    await expect(f.service.intent(randomUUID(), { phone: '13800000000', requestId: randomUUID() }, 'token')).rejects.toThrow('绑定手机号')
    expect(f.tx.select).toHaveBeenCalledTimes(1)
    expect(f.calls.filter(c => c.method === 'for')).toEqual([{ method: 'for', args: ['update'] }])
    expect(f.writes).toEqual([])
  })
  it.each(['ended', 'removed'])('preserves author-only historical contacts after %s', async state => {
    const p = { ...post(), lifecycle: state === 'ended' ? 'ended' : 'open', moderation: state === 'removed' ? 'removed' : 'normal' }
    const rows = [{ intent: { id: randomUUID(), phone: '13800000000', createdAt: new Date() }, member: { id: viewer.id, displayName: '访客', avatarUrl: null } }]
    const own = fixture([[p], rows])
    expect((await own.service.intents(p.id, { limit: 20, offset: 0 }, 'token')).items[0]!.phone).toBe('13800000000')
    const other = fixture([[p]], viewer)
    await expect(other.service.intents(p.id, { limit: 20, offset: 0 }, 'token')).rejects.toThrow('仅发布者')
    expect(other.tx.select).toHaveBeenCalledTimes(1)
    const anonymous = fixture([], null)
    await expect(anonymous.service.intents(p.id, { limit: 20, offset: 0 })).rejects.toThrow('请先登录')
    expect(anonymous.tx.select).not.toHaveBeenCalled()
  })
  it('acknowledges a create retry without overwriting the existing post or its images', async () => {
    const p = post(), f = fixture([[author], [p], [p], [{ id: author.id, displayName: '作者', avatarUrl: null }], []])
    const result = await f.service.save({ ...input(), requestId: p.requestId, title: '重试时已更改的标题', imageIds: [randomUUID()] }, 'token')
    expect(result).toMatchObject({ id: p.id, title: p.title })
    expect(f.writes).toEqual([])
  })
  it('ends only an owned open post and makes the repeated action a no-op', async () => {
    const p = post(), f = fixture([[p], [{ ...p, lifecycle: 'ended' }]])
    expect(await f.service.end(p.id, 'token')).toEqual({ ok: true })
    expect(await f.service.end(p.id, 'token')).toEqual({ ok: true })
    expect(f.writes).toHaveLength(1)
    expect(f.writes[0]).toMatchObject({ table: circlePosts, values: { lifecycle: 'ended' } })
    const other = fixture([[p]], viewer)
    await expect(other.service.end(p.id, 'token')).rejects.toThrow('仅发布者')
    expect(other.writes).toEqual([])
  })
  it('rejects author editing an ended public post or ending a removed post', async () => {
    const p = post(), ended = fixture([[author], [{ ...p, lifecycle: 'ended' }]])
    await expect(ended.service.save(input(), 'token', p.id)).rejects.toThrow('已结束')
    expect(ended.writes).toEqual([])
    const removed = fixture([[{ ...p, moderation: 'removed' }]])
    await expect(removed.service.end(p.id, 'token')).rejects.toThrow('下架帖子不能主动结束')
    expect(removed.writes).toEqual([])
  })
  it('does not reopen a removed post when its author edits', async () => {
    const p = { ...post(), moderation: 'removed' }, f = fixture([[author], [p], [p], [{ id: author.id, displayName: '作者', avatarUrl: null }], []])
    await f.service.save(input(), 'token', p.id)
    const write = f.writes.find(w => w.table === circlePosts)!.values
    expect(write).not.toHaveProperty('moderation')
    expect(write).not.toHaveProperty('lifecycle')
  })
  it('paginates owner-only intent records in stable order', async () => {
    const p = post(), f = fixture([[p], Array.from({ length: 3 }, (_, i) => ({ intent: { id: String(i), phone: '13800000000', createdAt: new Date() }, member: { id: viewer.id, displayName: '访客', avatarUrl: null } }))])
    const result = await f.service.intents(p.id, { limit: 2, offset: 2 }, 'token')
    expect(result.items).toHaveLength(2); expect(result.hasMore).toBe(true)
    expect(f.calls).toContainEqual({ method: 'limit', args: [3] }); expect(f.calls).toContainEqual({ method: 'offset', args: [2] })
    expect(f.calls.find(c => c.method === 'orderBy')!.args).toHaveLength(2)
  })
  it('filters public lists by moderation and category before paging', async () => {
    const f = fixture([[]])
    expect(await f.service.list({ category: 'service', offset: 20, limit: 20 })).toEqual({ items: [], hasMore: false })
    expect(new MySqlDialect().sqlToQuery(f.filters[0]!).params).toEqual(['normal', 'service'])
    expect(f.calls).toContainEqual({ method: 'offset', args: [20] })
  })
  it('moderation requires a reason, changes only moderation and audits once', async () => {
    const p = { ...post(), lifecycle: 'ended' }, f = fixture([[p], [{ ...p, moderation: 'removed' }]])
    await expect(f.service.moderate(f.tx, p.id, 'remove', '  ', 'admin')).rejects.toThrow('操作原因')
    await f.service.moderate(f.tx, p.id, 'remove', '违规', 'admin')
    await f.service.moderate(f.tx, p.id, 'remove', '重复', 'admin')
    expect(f.writes).toHaveLength(2)
    expect(f.writes[0].values).not.toHaveProperty('lifecycle')
    expect(f.writes[1]).toMatchObject({ table: circleOperations, values: { action: 'remove', reason: '违规', adminId: 'admin' } })
  })
  it('restores moderation without reopening an ended post and audits only the first restoration', async () => {
    const p = { ...post(), lifecycle: 'ended', moderation: 'removed' }, f = fixture([[p], [{ ...p, moderation: 'normal' }]])
    await f.service.moderate(f.tx, p.id, 'restore', '复核通过', 'admin')
    await f.service.moderate(f.tx, p.id, 'restore', '重复复核', 'admin')
    expect(f.writes).toHaveLength(2)
    expect(f.writes[0]).toMatchObject({ table: circlePosts, values: { moderation: 'normal', removalReason: null } })
    expect(f.writes[0].values).not.toHaveProperty('lifecycle')
    expect(f.writes[1]).toMatchObject({ table: circleOperations, values: { action: 'restore', reason: '复核通过' } })
  })
})
