import 'reflect-metadata'
import { describe, expect, it, vi } from 'vitest'
import { IdentityService } from '../src/flow/identity.js'
import { FlowDatabase } from '../src/flow/common.js'
import { WechatAdapter } from '../src/flow/wechat.js'
import { LEGAL_VERSION, legalDocuments, requireLegalConsent } from '../src/platform/legal.js'
import { cleanContent, PlatformService } from '../src/platform/service.js'
import { AdminPlatformController } from '../src/platform/controller.js'
import { AdminService } from '../src/admin/service.js'
import type { AdminTransaction } from '../src/admin/service.js'
import { platformAudit, platformContent } from '../src/database/schema/platform.js'
import { MySqlDialect } from 'drizzle-orm/mysql-core'
import type { SQL } from 'drizzle-orm'

describe('legal consent boundary', () => {
  it.each([undefined, { termsVersion: 'old', privacyVersion: LEGAL_VERSION }, { termsVersion: LEGAL_VERSION, privacyVersion: 'old' }])('rejects missing/stale consent before WeChat or DB access', async consent => {
    const exchange = vi.fn()
    const database = { get db() { throw new Error('must not access database') } }
    const identity = new IdentityService(database as unknown as FlowDatabase, { exchange } as unknown as WechatAdapter)
    await expect(identity.login('code', undefined, consent)).rejects.toThrow('请阅读并同意')
    expect(exchange).not.toHaveBeenCalled()
  })
  it('accepts current versions and explicitly labels both documents development placeholders', () => {
    expect(() => requireLegalConsent({ termsVersion: LEGAL_VERSION, privacyVersion: LEGAL_VERSION })).not.toThrow()
    expect(legalDocuments.development).toBe(true)
    expect(legalDocuments.terms.body).toContain('非正式')
    expect(legalDocuments.privacy.body).toContain('待补充')
  })
})
describe('content authorization', () => {
  it('rejects blank and overlong content, trimming only outer whitespace', () => {
    expect(cleanContent({ activityText: ' 活动 ', assistantText: '助手' })).toEqual({ activityText: '活动', assistantText: '助手' })
    expect(() => cleanContent({ activityText: ' ', assistantText: '助手' })).toThrow('文案须为')
    expect(() => cleanContent({ activityText: '活'.repeat(201), assistantText: '助手' })).toThrow('文案须为')
  })
  it.each([{ grants: [] }, { grants: [{ enabled: false }] }])('checks the locked current grant for every member write', async ({ grants }) => {
    const lock = vi.fn(async () => grants)
    const chain = { from: () => chain, where: () => chain, for: lock }
    const tx = { select: () => chain, insert: vi.fn() }
    const db = { transaction: async (callback: (tx: unknown) => unknown) => callback(tx) }
    const platform = new PlatformService({ db } as unknown as FlowDatabase, { require: async () => ({ id: 'member', boundPhone: '13800000000', avatarUrl: '/avatar.png', displayName: '会员', avatarSetByUser: true, nameSetByUser: true }) } as unknown as IdentityService)
    await expect(platform.saveMemberContent('Bearer token', { activityText: '活动', assistantText: '助手' })).rejects.toThrow('尚未获得')
    expect(lock).toHaveBeenCalledWith('update')
    expect(tx.insert).not.toHaveBeenCalled()
  })
  it('rejects visitor content writes before opening a database transaction', async () => {
    const transaction = vi.fn()
    const platform = new PlatformService({ db: { transaction } } as unknown as FlowDatabase,
      { require: async () => ({ id: 'visitor', boundPhone: null }) } as unknown as IdentityService)
    await expect(platform.saveMemberContent('Bearer token', { activityText: '活动', assistantText: '助手' })).rejects.toMatchObject({ status: 403 })
    expect(transaction).not.toHaveBeenCalled()
  })
  it('uses admin session write+CSRF enforcement for content and super-only enforcement for grants', async () => {
    const withSession = vi.fn<(context: unknown, callback: unknown, options: unknown) => Promise<{ ok: boolean }>>(async () => ({ ok: true }))
    const controller = new AdminPlatformController({} as PlatformService, { withSession } as unknown as AdminService)
    const request = { headers: { cookie: 'cookie', origin: 'http://local', 'x-csrf-token': 'csrf' } }
    await controller.save({ activityText: '活动', assistantText: '助手' }, request)
    expect(withSession.mock.calls[0]?.[2]).toEqual({ write: true })
    await controller.editor('member', { enabled: false }, request)
    expect(withSession.mock.calls[1]?.[2]).toEqual({ write: true, superOnly: true })
  })
  it('locks the current saved content and audits both texts and the responsible actor in the same transaction', async () => {
    const before = { activityText: '旧活动', assistantText: '旧助手' }
    const after = { activityText: '新活动', assistantText: '新助手' }
    const writes: { table: unknown; value: unknown }[] = []
    const lock = vi.fn(async () => [{ id: 'main', ...before }])
    const chain = { from: () => chain, where: () => chain, for: lock }
    const tx = {
      select: () => chain,
      insert: (table: unknown) => ({ values: (value: unknown) => {
        writes.push({ table, value })
        return { onDuplicateKeyUpdate: async () => undefined }
      } }),
      update: (table: unknown) => ({ set: (value: unknown) => ({ where: async () => { writes.push({ table, value }) } }) }),
    }
    const platform = new PlatformService({} as FlowDatabase, {} as IdentityService)
    await expect(platform.saveContent(tx as unknown as AdminTransaction, after, { type: 'admin', id: 'operator' })).resolves.toEqual({ ...after, canEdit: true })
    expect(lock).toHaveBeenCalledWith('update')
    expect(writes[1]).toEqual({ table: platformContent, value: after })
    expect(writes[2]?.table).toBe(platformAudit)
    expect(writes[2]?.value).toMatchObject({ before, after, actorType: 'admin', actorId: 'operator', action: 'content' })
  })
  it('resolves only this page actors and targets with two batch queries, including member-number fallback', async () => {
    const base = { before: {}, after: {}, createdAt: new Date(0), action: 'content', targetMemberId: null }
    const batches = [
      [{ ...base, id: 'a', actorType: 'admin', actorId: 'admin', targetMemberId: 'target' }, { ...base, id: 'b', actorType: 'member', actorId: 'member' }, { ...base, id: 'extra', actorType: 'member', actorId: 'not-on-page' }],
      [{ id: 'admin', name: '运营人员' }],
      [{ id: 'target', name: '被授权会员', number: 'HJtarget' }, { id: 'member', name: ' ', number: 'HJmember' }],
    ]
    const filters: SQL[] = []
    let queries = 0
    const tx = { select: () => {
      const results = batches[queries++]
      const chain = { from: () => chain, orderBy: () => chain, offset: () => chain, limit: () => chain,
        where: (filter: SQL) => { filters.push(filter); return chain },
        then: (resolve: (rows: unknown) => unknown) => Promise.resolve(results).then(resolve) }
      return chain
    } }
    const platform = new PlatformService({} as FlowDatabase, {} as IdentityService)
    const result = await platform.history(tx as unknown as AdminTransaction, { offset: 0, limit: 2 })
    expect(result.hasMore).toBe(true)
    expect(result.items).toHaveLength(2)
    expect(result.items[0]).toMatchObject({ actorName: '运营人员', targetMemberNumber: 'HJtarget' })
    expect(result.items[1]).toMatchObject({ actorName: 'HJmember', targetMemberNumber: null })
    expect(queries).toBe(3)
    expect(filters.map(filter => new MySqlDialect().sqlToQuery(filter).params)).toEqual([['admin'], ['target', 'member']])
  })
})
