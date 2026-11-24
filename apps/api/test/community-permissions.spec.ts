import 'reflect-metadata'
import { ValidationPipe } from '@nestjs/common'
import { MySqlDialect } from 'drizzle-orm/mysql-core'
import type { SQL } from 'drizzle-orm'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AdminCommunityPermissionsController } from '../src/admin/community-permissions-controller.js'
import { AdminService, type AdminTransaction } from '../src/admin/service.js'
import { csrfFor } from '../src/admin/security.js'
import { communityMembers, rosterPermissionAudit } from '../src/database/schema/communities.js'
import type { FlowDatabase } from '../src/flow/common.js'
import type { IdentityService } from '../src/flow/identity.js'
import { CommunityRosterService } from '../src/flow/community-roster.js'
import { CommunityPermissionsInput } from '../src/flow/community-roster-dto.js'

const member = { id: 'reader', boundPhone: '13800000001', avatarUrl: '/a', displayName: '测试', avatarSetByUser: true, nameSetByUser: true }
const page = { offset: 0, limit: 1 }
const legacy = { communityId: 'group-a', communityName: '甲社群', isAdmin: true, canViewRoster: false }
const readOnly = { canViewRoster: true, canRecognizeMembers: false }
const token = '1'.repeat(64)
const headers = { cookie: 'huiju_admin_session=' + token, origin: 'https://admin.example.test', 'x-csrf-token': csrfFor(token) }
function accountRows(role: string) {
  return [[{ id: 'session', adminAccountId: 'admin' }], [{
    account: { id: 'admin', status: 'active', displayName: '管理员', createdAt: new Date(0) },
    credential: { username: 'admin', role },
  }], [{ id: 'session' }]]
}
function fixture(results: unknown[][]) {
  const query: Record<string, unknown> = {}
  const filters: unknown[][] = []
  for (const name of ['from', 'limit', 'orderBy', 'offset', 'innerJoin', 'for']) query[name] = vi.fn(() => query)
  const where = (filter: SQL) => { filters.push(new MySqlDialect().sqlToQuery(filter).params); return query }
  query.where = where
  query.then = (resolve: (rows: unknown[]) => unknown) => Promise.resolve(results.shift() ?? []).then(resolve)
  const set = vi.fn(() => ({ where })), values = vi.fn().mockResolvedValue(undefined)
  const update = vi.fn(() => ({ set })), insert = vi.fn(() => ({ values }))
  const tx = { select: () => query, update, insert } as unknown as AdminTransaction
  const database = { db: { ...tx, transaction: (work: (tx: AdminTransaction) => unknown) => work(tx) } } as unknown as FlowDatabase
  const roster = new CommunityRosterService(database, { require: async () => member } as unknown as IdentityService)
  return { tx, roster, controller: new AdminCommunityPermissionsController(new AdminService(database), roster), update, set, insert, values, filters }
}
afterEach(() => vi.unstubAllEnvs())

describe('community roster permissions', () => {
  it('allows only the super administrator to inspect grants or change them, with CSRF required', async () => {
    vi.stubEnv('ADMIN_ORIGIN', headers.origin)
    const params = { communityId: 'group-a', memberId: member.id }
    const viewer = fixture(accountRows('operator'))
    const forbidden = { response: { code: 'ADMIN_FORBIDDEN' } }
    await expect(viewer.controller.list(member.id, page, { headers })).rejects.toMatchObject(forbidden)
    const writer = fixture(accountRows('operator'))
    await expect(writer.controller.set(params, readOnly, { headers })).rejects.toMatchObject(forbidden)
    expect(writer.update).not.toHaveBeenCalled()
    await expect(writer.controller.set(params, readOnly, { headers: { ...headers, 'x-csrf-token': '' } }))
      .rejects.toMatchObject({ response: { code: 'ADMIN_CSRF_REJECTED' } })
  })
  it('paginates grants by member and preserves legacy permissions', async () => {
    const f = fixture([...accountRows('super_admin'), [legacy, { ...legacy, communityId: 'group-b' }], [{ total: 2 }]])
    expect(await f.controller.list(member.id, page, { headers })).toEqual({
      items: [{ communityId: legacy.communityId, communityName: legacy.communityName, canViewRoster: true, canRecognizeMembers: true }],
      total: 2, hasMore: true,
    })
    expect(f.filters.slice(-2)).toEqual([[member.id], [member.id]])
  })
  it('downgrades only the requested member in the requested community and audits the change', async () => {
    vi.stubEnv('ADMIN_ORIGIN', headers.origin)
    const f = fixture([...accountRows('super_admin'), [legacy]])
    const params = { communityId: legacy.communityId, memberId: member.id }
    await expect(f.controller.set(params, readOnly, { headers })).resolves.toEqual({ communityId: legacy.communityId, communityName: legacy.communityName, ...readOnly })
    expect(f.update).toHaveBeenCalledWith(communityMembers)
    expect(f.set).toHaveBeenCalledWith({ canViewRoster: true, isAdmin: false })
    expect(f.filters.slice(-2)).toEqual([[legacy.communityId, member.id], [legacy.communityId, member.id]])
    expect(f.insert).toHaveBeenCalledWith(rosterPermissionAudit)
    expect(f.values).toHaveBeenCalledWith(expect.objectContaining({ ...params, actorId: 'admin', before: { canViewRoster: true, canRecognizeMembers: true }, after: readOnly }))
  })
  it('keeps permission writes idempotent, and refuses grants outside a membership or without view access', async () => {
    const f = fixture([[{ ...legacy, isAdmin: false, canViewRoster: true }], []])
    const set = (input: CommunityPermissionsInput) => f.roster.setMemberPermissions(f.tx, member.id, legacy.communityId, input, 'admin')
    await set(readOnly)
    await expect(set(readOnly)).rejects.toMatchObject({ response: { code: 'COMMUNITY_MEMBER_NOT_FOUND' } })
    await expect(set({ canViewRoster: false, canRecognizeMembers: true })).rejects.toMatchObject({ response: { code: 'INVALID_ROSTER_PERMISSIONS' } })
    expect(f.update).not.toHaveBeenCalled()
    expect(f.insert).not.toHaveBeenCalled()
    const pipe = new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true })
    for (const body of [{}, { ...readOnly, canViewRoster: 'true' }, { ...readOnly, isAdmin: true }]) {
      await expect(pipe.transform(body, { type: 'body', metatype: CommunityPermissionsInput })).rejects.toThrow()
    }
  })
  it('allows the roster read of a viewer but denies both recognition and revocation; checks the community on every request', async () => {
    const viewer = { isAdmin: false, canViewRoster: true }
    const f = fixture([[viewer], [{ memberId: 'target' }], [{ total: 1 }], [viewer], [viewer], []])
    await expect(f.roster.list(page, 'session', 'group-a')).resolves.toMatchObject({ canRecognizeMembers: false, total: 1 })
    for (const state of [true, false]) {
      await expect(f.roster.recognize('target', state, 'session', 'group-a')).rejects.toMatchObject({ response: { code: 'COMMUNITY_RECOGNITION_REQUIRED' } })
    }
    await expect(f.roster.list(page, 'session', 'group-b')).rejects.toMatchObject({ response: { code: 'COMMUNITY_ADMIN_REQUIRED' } })
    expect(f.filters).toEqual([['group-a', member.id], ['group-a'], ['group-a'], ['group-a', member.id], ['group-a', member.id], ['group-b', member.id]])
    expect(f.update).not.toHaveBeenCalled()
  })
})
