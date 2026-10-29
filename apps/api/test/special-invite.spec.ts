import 'reflect-metadata'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ValidationPipe } from '@nestjs/common'
import { createInviteCode, inviteHash, openInvite, sealInvite } from '../src/flow/special-invite-crypto.js'
import { inviteExpiresAt, requireInviteAvailable, SpecialInviteService, specialInviteStatus } from '../src/flow/special-invite.js'
import { SpecialInviteCreateInput, SpecialInviteQuery, SpecialInviteVerifyInput } from '../src/flow/special-invite-dto.js'
import { RegistrationInput } from '../src/flow/dto.js'
import type { FlowDatabase } from '../src/flow/common.js'
import type { IdentityService } from '../src/flow/identity.js'
import type { activities } from '../src/database/schema/activities.js'
import type { activityInviteCodes } from '../src/database/schema/registrations.js'

type Activity = typeof activities.$inferSelect
type Invite = typeof activityInviteCodes.$inferSelect
const activity = { id: 'activity', organizerMemberId: 'owner', feeType: 'paid', lifecycle: 'published', moderation: 'normal', startsAt: new Date('2099-02-02'), endsAt: new Date('2099-02-03'), registrationDeadline: new Date('2099-02-01'), capacity: 10, activeRegistrationCount: 0 } as Activity
const member = { id: 'owner', boundPhone: '13800000001', avatarUrl: '/avatar', displayName: '会员', avatarSetByUser: true, nameSetByUser: true }
const code = 'ABCDEFGH2345', phone = member.boundPhone
const pipe = new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true })
function invite(overrides: Partial<Invite> = {}): Invite {
  return { id: 'invite', activityId: activity.id, issuerMemberId: member.id, phoneHash: inviteHash('phone', phone), codeHash: inviteHash('code', code), encryptedPayload: sealInvite('invite', activity.id, { code, phone }), createdAt: new Date(), expiresAt: inviteExpiresAt(activity), usedAt: null, usedByMemberId: null, operationId: null, ...overrides }
}
function fixture(rows: unknown[][], actor = member) {
  const query: Record<string, unknown> = {}
  for (const name of ['from', 'where', 'for', 'limit', 'offset', 'orderBy', 'leftJoin']) query[name] = vi.fn(() => query)
  query.then = (resolve: (value: unknown) => unknown) => Promise.resolve(rows.shift() ?? []).then(resolve)
  const values = vi.fn().mockResolvedValue(undefined)
  const tx = { select: () => query, insert: () => ({ values }) }
  const db = { ...tx, transaction: async <T>(work: (value: typeof tx) => Promise<T>) => work(tx) }
  return { service: new SpecialInviteService({ db } as unknown as FlowDatabase, { require: async () => actor } as unknown as IdentityService), values, query }
}

beforeEach(() => vi.stubEnv('ACTIVITY_INVITE_KEY', Buffer.alloc(32, 7).toString('base64')))
afterEach(() => vi.unstubAllEnvs())

describe('special invite protection and contracts', () => {
  it('encrypts code and phone with randomized authenticated ciphertext bound to the row', () => {
    const encryptedPayload = sealInvite('id', 'activity', { code, phone })
    expect(encryptedPayload).not.toContain(code)
    expect(encryptedPayload).not.toContain(phone)
    expect(encryptedPayload).not.toBe(sealInvite('id', 'activity', { code, phone }))
    expect(openInvite({ id: 'id', activityId: 'activity', encryptedPayload })).toEqual({ code, phone })
    expect(() => openInvite({ id: 'other', activityId: 'activity', encryptedPayload })).toThrow('暂不可用')
    expect(() => openInvite({ id: 'id', activityId: 'other', encryptedPayload })).toThrow('暂不可用')
    expect(() => openInvite({ id: 'id', activityId: 'activity', encryptedPayload: 'broken' })).toThrow('暂不可用')
    expect(inviteHash('phone', phone)).not.toContain(phone)
    expect(inviteHash('phone', code)).not.toBe(inviteHash('code', code))
    expect(createInviteCode()).toMatch(/^[A-HJ-NP-Z2-9]{12}$/)
  })
  it('fails closed for missing, malformed or rotated keys with a safe message', () => {
    const encryptedPayload = sealInvite('id', 'activity', { code, phone })
    for (const key of ['', 'short', Buffer.alloc(31).toString('base64')]) {
      vi.stubEnv('ACTIVITY_INVITE_KEY', key)
      expect(() => inviteHash('phone', phone)).toThrow('特邀码服务暂不可用')
    }
    vi.stubEnv('ACTIVITY_INVITE_KEY', Buffer.alloc(32, 8).toString('base64'))
    expect(() => openInvite({ id: 'id', activityId: 'activity', encryptedPayload })).toThrow('暂不可用')
  })
  it('validates phone, code, optional registration code and bounded state pagination', async () => {
    expect(await pipe.transform({ phone }, { type: 'body', metatype: SpecialInviteCreateInput })).toMatchObject({ phone })
    expect(await pipe.transform({ code: ' abcdefgh2345 ' }, { type: 'body', metatype: SpecialInviteVerifyInput })).toMatchObject({ code })
    for (const value of [{ phone: '123' }, { phone, hidden: true }]) await expect(pipe.transform(value, { type: 'body', metatype: SpecialInviteCreateInput })).rejects.toThrow()
    await expect(pipe.transform({ code: '123' }, { type: 'body', metatype: SpecialInviteVerifyInput })).rejects.toThrow()
    for (const value of [{ status: 'unknown' }, { limit: 101 }, { offset: -1 }]) await expect(pipe.transform(value, { type: 'query', metatype: SpecialInviteQuery })).rejects.toThrow()
    expect(await pipe.transform({ contactPhone: phone, answers: [], specialInviteCode: code }, { type: 'body', metatype: RegistrationInput })).toMatchObject({ specialInviteCode: code })
    await expect(pipe.transform({ contactPhone: phone, answers: [], specialInviteCode: null }, { type: 'body', metatype: RegistrationInput })).rejects.toThrow()
  })
})

describe('special invite lifecycle and ownership', () => {
  it('pauses removal and free mode, resumes paid mode, and keeps use/expiry permanent', () => {
    const now = new Date('2099-01-01')
    expect(specialInviteStatus(activity, null, now)).toBe('unused')
    expect(specialInviteStatus({ ...activity, moderation: 'removed' }, null, now)).toBe('paused')
    expect(specialInviteStatus({ ...activity, feeType: 'free' }, null, now)).toBe('paused')
    expect(specialInviteStatus({ ...activity, lifecycle: 'cancelled' }, null, now)).toBe('expired')
    expect(specialInviteStatus(activity, null, activity.registrationDeadline!)).toBe('expired')
    expect(specialInviteStatus(activity, null, now, new Date('2098-12-31'))).toBe('expired')
    expect(specialInviteStatus({ ...activity, lifecycle: 'cancelled' }, now, new Date('2100-01-01'))).toBe('used')
    expect(() => requireInviteAvailable({ ...activity, activeRegistrationCount: 10 }, now)).toThrow('名额已满')
  })
  it('reuses an existing unused code without storing plaintext or creating a second row', async () => {
    const stored = invite()
    const reused = fixture([[activity], [stored]])
    expect(await reused.service.create(activity.id, phone)).toMatchObject({ id: stored.id, code, maskedPhone: '138 **** 0001', status: 'unused' })
    expect(reused.values).not.toHaveBeenCalled()
    const fresh = fixture([[activity], []])
    const created = await fresh.service.create(activity.id, phone)
    const saved = fresh.values.mock.calls[0][0] as Invite
    expect(saved.encryptedPayload).not.toContain(created.code)
    expect(saved.encryptedPayload).not.toContain(phone)
    expect(saved.expiresAt).toEqual(activity.registrationDeadline)
    expect(openInvite(saved)).toEqual({ code: created.code, phone })
  })
  it('rejects another organizer and unavailable activity before generating a code', async () => {
    for (const target of [{ ...activity, organizerMemberId: 'other' }, { ...activity, feeType: 'free' }, { ...activity, lifecycle: 'draft' }, { ...activity, lifecycle: 'cancelled' }, { ...activity, moderation: 'removed' }]) {
      const f = fixture([[target]])
      await expect(f.service.create(activity.id, phone)).rejects.toThrow()
      expect(f.values).not.toHaveBeenCalled()
    }
  })
  it('only verifies unused valid matching codes, without any write', async () => {
    const stored = invite()
    const f = fixture([[activity], [stored]])
    expect(await f.service.verify(activity.id, code)).toMatchObject({ valid: true, maskedPhone: '138 **** 0001' })
    expect(f.values).not.toHaveBeenCalled()
    for (const row of [undefined, invite({ usedAt: new Date(), operationId: 'op', usedByMemberId: 'owner' }), invite({ expiresAt: new Date('2000-01-01') })]) {
      await expect(fixture([[activity], row ? [row] : []]).service.verify(activity.id, code)).rejects.toThrow()
    }
    await expect(fixture([[{ ...activity, feeType: 'free' }], [stored]]).service.verify(activity.id, code)).rejects.toThrow('暂不能')
  })
  it('lists only through owner access and returns bounded rows with masked phones', async () => {
    const row = invite()
    const f = fixture([[activity], [{ value: 3 }], [{ invite: row, registrationId: null }, { invite: row, registrationId: null }]])
    const result = await f.service.list(activity.id, Object.assign(new SpecialInviteQuery(), { limit: 1, offset: 1 }))
    expect(result).toMatchObject({ total: 3, hasMore: true })
    expect(result.items).toHaveLength(1)
    expect(result.items[0].maskedPhone).toBe('138 **** 0001')
    expect(JSON.stringify(result)).not.toContain(phone)
    expect(f.query.limit).toHaveBeenCalledWith(2)
    expect(f.query.offset).toHaveBeenCalledWith(1)
    await expect(fixture([[{ ...activity, organizerMemberId: 'other' }]]).service.list(activity.id, new SpecialInviteQuery())).rejects.toThrow('仅活动发起人')
  })
})
