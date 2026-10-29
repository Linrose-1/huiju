import 'reflect-metadata'
import { ValidationPipe } from '@nestjs/common'
import { describe, expect, it, vi } from 'vitest'
import { connectionMembers, connectionPage, fellowSummary, FellowsService, type RelationMember } from '../src/flow/fellows.js'
import { ConnectionQuery } from '../src/flow/fellows-dto.js'
import { PageQuery } from '../src/flow/pagination.js'
import type { FlowDatabase } from '../src/flow/common.js'
import type { IdentityService } from '../src/flow/identity.js'

function member(id: string, inviterMemberId: string | null = 'root', overrides: Partial<RelationMember> = {}): RelationMember {
  return { id, inviterMemberId, kind: 'member', displayName: id, avatarUrl: '/avatar', boundPhone: '13800000000', avatarSetByUser: true, nameSetByUser: true, ...overrides }
}
const root = member('root', null, { kind: 'platform_root' })
function tree(rows: RelationMember[]) {
  const map = new Map([root, ...rows].map(row => [row.id, row]))
  const load = vi.fn(async (id: string) => map.get(id))
  return { load, path: (a: string, b: string) => connectionMembers(map.get(a)!, map.get(b)!, load) }
}
function serviceFixture(rows: unknown[][], caller = member('me')) {
  const query: Record<string, unknown> = {}
  for (const method of ['from', 'where', 'limit', 'offset', 'orderBy']) query[method] = vi.fn(() => query)
  query.then = (resolve: (value: unknown) => unknown) => Promise.resolve(rows.shift() ?? []).then(resolve)
  const select = vi.fn(() => query)
  const identity = { require: vi.fn(async () => caller) }
  return { service: new FellowsService({ db: { select } } as unknown as FlowDatabase, identity as unknown as IdentityService), query, select, identity }
}

describe('complete natural-person invitation paths', () => {
  it('finds upward, downward and cross-branch paths with actual invitation direction', async () => {
    const nodes = tree([member('B'), member('C', 'B'), member('D', 'C'), member('E', 'B')])
    expect((await nodes.path('B', 'D')).map(n => n.id)).toEqual(['B', 'C', 'D'])
    expect((await nodes.path('D', 'B')).map(n => n.id)).toEqual(['D', 'C', 'B'])
    const path = await nodes.path('D', 'E')
    expect(path.map(n => n.id)).toEqual(['D', 'C', 'B', 'E'])
    expect(connectionPage(path[0], path[3], path, new ConnectionQuery()).edges).toEqual([
      { fromIndex: 1, toIndex: 0 }, { fromIndex: 2, toIndex: 1 }, { fromIndex: 2, toIndex: 3 },
    ])
  })

  it('does not create a connection through the platform root; self is a single node', async () => {
    const nodes = tree([member('A'), member('B')])
    expect(await nodes.path('A', 'B')).toEqual([])
    expect((await nodes.path('A', 'A')).map(n => n.id)).toEqual(['A'])
    expect(connectionPage(member('A'), member('B'), [], new ConnectionQuery())).toMatchObject({ connected: false, totalNodes: 0, nodes: [], edges: [], nextCursor: null })
  })

  it('keeps deep paths intact and provides each cross-page edge exactly once', async () => {
    const rows = Array.from({ length: 1007 }, (_, i) => member(String(i), i ? String(i - 1) : 'root'))
    const nodes = tree(rows)
    const path = await nodes.path('1006', '0')
    expect(path).toHaveLength(1007)
    expect(nodes.load.mock.calls.length).toBeLessThanOrEqual(1006)
    const indices: number[] = [], edges: unknown[] = []
    let cursor: number | null = 0
    while (cursor !== null) {
      const page = connectionPage(rows[1006], rows[0], path, { cursor, limit: 20 })
      expect(page.source.memberId).toBe('1006')
      expect(page.target.memberId).toBe('0')
      expect(page.totalNodes).toBe(1007)
      indices.push(...page.nodes.map(n => n.index))
      edges.push(...page.edges)
      cursor = page.nextCursor
    }
    expect(indices).toEqual(Array.from({ length: 1007 }, (_, i) => i))
    expect(edges).toHaveLength(1006)
    expect(edges[19]).toEqual({ fromIndex: 20, toIndex: 19 })
    expect(connectionPage(rows[1006], rows[0], path, { cursor: 2000, limit: 20 })).toMatchObject({ connected: true, nodes: [], nextCursor: null })
  })

  it('preserves anonymous guest nodes without ids, contact data or partial names', async () => {
    const guest = member('G', 'A', { boundPhone: null, displayName: '私密半成品' })
    const nodes = tree([member('A'), guest, member('B', 'G')])
    const path = await nodes.path('A', 'B')
    expect(path).toHaveLength(3)
    const page = connectionPage(path[0], path[2], path, new ConnectionQuery())
    expect(page.nodes[1].member).toEqual({ memberId: null, displayName: '待完善资料的学友', avatarUrl: null, canOpenCard: false })
    expect(JSON.stringify(page)).not.toContain('私密半成品')
    expect(JSON.stringify(page)).not.toContain('13800000000')
    expect(Object.keys(fellowSummary(member('A'))).sort()).toEqual(['avatarUrl', 'canOpenCard', 'displayName', 'memberId'])
  })

  it.each([
    [member('A', 'A'), member('B', 'A')],
    [member('A', 'B'), member('B', 'A')],
    [member('A', 'missing'), member('B', 'A')],
    [member('A', null), member('B', 'A')],
  ])('rejects loops and broken ancestry instead of claiming a complete path', async (a, b) => {
    await expect(tree([a, b]).path('A', 'B')).rejects.toThrow('暂时无法完整展示')
  })
})

describe('fellows permission and pagination', () => {
  it('requires complete authenticated caller before reading relationship data', async () => {
    const fixture = serviceFixture([], member('me', 'root', { boundPhone: null }))
    await expect(fixture.service.list(new PageQuery(), 'Bearer example')).rejects.toThrow('请先完善')
    await expect(fixture.service.path('other', new ConnectionQuery())).rejects.toThrow('请先完善')
    expect(fixture.select).not.toHaveBeenCalled()
    expect(fixture.identity.require).toHaveBeenCalledWith('Bearer example')
  })

  it('hides root inviter and pages direct invitees with a server count', async () => {
    const fixture = serviceFixture([[root], [{ total: 3 }], [member('a'), member('b'), member('c')]])
    const result = await fixture.service.list({ offset: 2, limit: 2 })
    expect(result).toMatchObject({ inviter: null, total: 3, hasMore: true })
    expect(result.items.map(n => n.memberId)).toEqual(['a', 'b'])
    expect(fixture.query.offset).toHaveBeenCalledWith(2)
    expect(fixture.query.limit).toHaveBeenCalledWith(3)
  })

  it('returns natural inviter summary and anonymous invitees without extra fields', async () => {
    const fixture = serviceFixture([[member('inviter')], [{ total: 1 }], [member('guest', 'me', { nameSetByUser: false })]], member('me', 'inviter'))
    expect(await fixture.service.list(new PageQuery())).toEqual({ inviter: fellowSummary(member('inviter')), items: [fellowSummary(member('guest', 'me', { nameSetByUser: false }))], total: 1, hasMore: false })
  })

  it('does not expose root or absent targets', async () => {
    for (const rows of [[root], []]) {
      await expect(serviceFixture([rows]).service.path('target', new ConnectionQuery())).rejects.toThrow('学友不存在')
    }
  })

  it('computes only from the authenticated caller and allows anonymous guest targets', async () => {
    const caller = member('me')
    const target = member('guest', 'me', { boundPhone: null })
    const fixture = serviceFixture([[target], [root]], caller)
    const result = await fixture.service.path('guest', new ConnectionQuery(), 'session')
    expect(result).toMatchObject({ connected: true, totalNodes: 2, source: { memberId: 'me' }, target: { memberId: null } })
  })

  it('validates cursor and bounded page size without limiting path depth', async () => {
    const pipe = new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true })
    const parse = (value: unknown) => pipe.transform(value, { type: 'query', metatype: ConnectionQuery })
    expect(await parse({ cursor: '1000001' })).toEqual({ cursor: 1000001, limit: 20 })
    for (const value of [{ cursor: -1 }, { cursor: 0.5 }, { limit: 101 }, { source: 'someone' }]) await expect(parse(value)).rejects.toThrow()
  })
})
