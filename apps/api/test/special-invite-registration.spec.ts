import 'reflect-metadata'
import { describe, expect, it, vi } from 'vitest'
import { activities, registrationQuestions, type RegistrationScope } from '../src/database/schema/activities.js'
import { communityMembers } from '../src/database/schema/communities.js'
import { MySqlDialect } from 'drizzle-orm/mysql-core'
import type { SQL } from 'drizzle-orm'
import { members } from '../src/database/schema/members.js'
import { registrationAnswers, registrationOperations, registrations } from '../src/database/schema/registrations.js'
import { ActivityService } from '../src/flow/activity.js'
import type { FlowDatabase } from '../src/flow/common.js'
import type { IdentityService } from '../src/flow/identity.js'
import type { RecommendationRecordsService } from '../src/recommendations/records.js'
import type { SpecialInviteService } from '../src/flow/special-invite.js'

type Row = Record<string, unknown>
function fixture() {
  const member = { id: 'member', boundPhone: '13800000000', avatarUrl: '/avatar', displayName: '会员', avatarSetByUser: true, nameSetByUser: true }
  const activity = { id: 'activity', communityId: 'other-community', registrationScope: 'all' as RegistrationScope, feeType: 'paid', lifecycle: 'published', moderation: 'normal', startsAt: new Date('2099-01-01'), endsAt: new Date('2099-01-02'), registrationDeadline: null, capacity: 10, activeRegistrationCount: 0 }
  const membership = new Map<string, boolean>()
  let registration: Row | undefined, operations: Row[] = [], usages: Row[] = [], inTransaction = false
  let questions: Row[] = []
  const lockOrder: unknown[] = []
  const select = () => ({ from: (table: unknown) => {
    let communityId: string
    const result = () => {
      if (table === activities) return [activity]
      if (table === members) return [member]
      if (table === communityMembers) return membership.has(communityId) ? [{ isRegistered: membership.get(communityId) }] : []
      if (table === registrations) return registration ? [registration] : []
      if (table === registrationQuestions) return questions
      if (table === registrationAnswers) return []
      throw new Error('Unexpected table')
    }
    const query = { where: (where: SQL) => {
      if (table === communityMembers) {
        const params = new MySqlDialect().sqlToQuery(where).params
        expect(params[1]).toBe(member.id)
        communityId = String(params[0])
      }
      return query
    }, limit: async () => result(), orderBy: async () => result(), for: async () => { lockOrder.push(table); return result() }, then: (resolve: (value: unknown) => unknown) => Promise.resolve(result()).then(resolve) }
    return query
  } })
  const tx = { select,
    insert: (table: unknown) => ({ values: async (values: Row) => {
      if (table === registrations) registration = { ...values, status: 'active', cancelledAt: null }
      else if (table === registrationOperations) operations.push(values)
      else if (table !== registrationAnswers) throw new Error('Unexpected insert')
    } }),
    update: (table: unknown) => ({ set: (values: Row) => ({ where: async () => { if (table === registrations) Object.assign(registration!, values) } }) }),
    delete: () => ({ where: async () => undefined }),
  }
  const database = { db: { ...tx, transaction: async <T>(work: (value: typeof tx) => Promise<T>) => {
    const saved = structuredClone({ registration, operations, usages })
    inTransaction = true
    try { return await work(tx) }
    catch (error) { registration = saved.registration; operations = saved.operations; usages = saved.usages; throw error }
    finally { inTransaction = false }
  } } } as unknown as FlowDatabase
  const prepare = vi.fn(async (context: unknown, _activity: unknown, code: string, boundPhone: string) => {
    expect(context).toBe(tx)
    expect(inTransaction).toBe(true)
    expect(lockOrder.filter(table => table !== communityMembers).slice(-2)).toEqual([activities, registrations])
    if (activity.registrationScope !== 'all') expect(lockOrder.at(-1)).toBe(communityMembers)
    expect(boundPhone).toBe(member.boundPhone)
    if (usages.some(row => row.id === code)) throw new Error('特邀码已使用')
    return code
  })
  const consume = vi.fn(async (context: unknown, id: string, usedByMemberId: string, operationId: string, usedAt: Date) => {
    expect(context).toBe(tx)
    expect(inTransaction).toBe(true)
    expect(registration?.feeQualification).toBe('invited_free')
    expect(operations.some(row => row.id === operationId)).toBe(true)
    usages.push({ id, usedByMemberId, operationId, usedAt })
  })
  const conversion = vi.fn().mockResolvedValue(undefined)
  const service = new ActivityService(database, { require: async () => member } as unknown as IdentityService,
    { conversion } as unknown as RecommendationRecordsService, { prepare, consume } as unknown as SpecialInviteService)
  return { service, prepare, consume, conversion, activity, member, membership, setQuestions: (rows: Row[]) => { questions = rows }, get registration() { return registration }, get operations() { return operations }, get usages() { return usages } }
}
const input = { answers: [], contactPhone: '13900000001', specialInviteCode: 'ABCDEFGH2345' }

describe('special invite registration transaction composition', () => {
  it.each([
    ['all', false, true], ['all', true, true],
    ['registered', false, false], ['registered', true, true],
    ['unregistered', false, true], ['unregistered', true, false],
  ] as const)('checks scope %s against membership %s for detail and registration', async (scope, isRegistered, eligible) => {
    const f = fixture()
    f.activity.registrationScope = scope
    f.membership.set('xuejia', !isRegistered)
    f.membership.set(f.activity.communityId, isRegistered)
    expect(await f.service.detail(f.activity.id, 'session')).toMatchObject({ registrationScope: scope, registrationScopeEligible: eligible })
    const write = f.service.write(f.activity.id, 'session', 'register', input)
    if (eligible) {
      await expect(write).resolves.toMatchObject({ status: 'active' })
    } else {
      await expect(write).rejects.toMatchObject({ response: { code: 'REGISTRATION_SCOPE_MISMATCH' }, status: 403 })
      expect(f.prepare).not.toHaveBeenCalled()
      expect(f.operations).toEqual([])
      expect(f.registration).toBeUndefined()
    }
  })
  it('preserves an accepted registration and checks current membership again after cancellation', async () => {
    const f = fixture()
    f.activity.registrationScope = 'unregistered'
    const ordinary = { answers: [], contactPhone: input.contactPhone }
    await f.service.write(f.activity.id, 'session', 'register', ordinary)
    f.membership.set(f.activity.communityId, true)
    await expect(f.service.write(f.activity.id, 'session', 'register', ordinary)).resolves.toMatchObject({ status: 'active' })
    await f.service.write(f.activity.id, 'session', 'cancel')
    await expect(f.service.write(f.activity.id, 'session', 'register', ordinary)).rejects.toMatchObject({ response: { code: 'REGISTRATION_SCOPE_MISMATCH' } })
    expect(f.registration?.status).toBe('cancelled')
    expect(f.operations).toHaveLength(2)
  })
  it('uses the verified bound phone, records the operation, and consumes within the same transaction', async () => {
    const f = fixture()
    expect(await f.service.write('activity', 'session', 'register', input)).toMatchObject({ feeQualification: 'invited_free', contactPhone: input.contactPhone })
    expect(f.prepare.mock.calls[0][3]).toBe(f.member.boundPhone)
    expect(f.usages[0]).toMatchObject({ id: input.specialInviteCode, operationId: f.operations[0].id, usedByMemberId: f.member.id })
  })
  it('does not consume for invalid answers or unavailable capacity', async () => {
    const f = fixture()
    f.setQuestions([{ id: 'q', prompt: '必填', type: 'short_text', required: true }])
    await expect(f.service.write('activity', 'session', 'register', input)).rejects.toThrow('必填')
    f.setQuestions([])
    f.activity.activeRegistrationCount = 10
    await expect(f.service.write('activity', 'session', 'register', input)).rejects.toThrow('名额已满')
    expect(f.prepare).not.toHaveBeenCalled()
    expect(f.consume).not.toHaveBeenCalled()
    expect(f.registration).toBeUndefined()
  })
  it('rolls back both qualification and code use when a later transactional write fails', async () => {
    const f = fixture()
    f.conversion.mockRejectedValueOnce(new Error('downstream failed'))
    await expect(f.service.write('activity', 'session', 'register', { ...input, recommendationToken: 'token' })).rejects.toThrow('downstream failed')
    expect(f.consume).toHaveBeenCalledTimes(1)
    expect(f.registration).toBeUndefined()
    expect(f.operations).toEqual([])
    expect(f.usages).toEqual([])
  })
  it('never consumes again for retry or cancel, and needs a different code for a new invitation', async () => {
    const f = fixture()
    await f.service.write('activity', 'session', 'register', input)
    const firstOperation = f.operations[0].id
    await f.service.write('activity', 'session', 'register', input)
    expect(f.consume).toHaveBeenCalledTimes(1)
    await f.service.write('activity', 'session', 'cancel')
    expect(f.usages[0].operationId).toBe(firstOperation)
    await expect(f.service.write('activity', 'session', 'register', input)).rejects.toThrow('已使用')
    expect(f.registration?.status).toBe('cancelled')
    await f.service.write('activity', 'session', 'register', { ...input, specialInviteCode: 'ABCDEFGH2346' })
    expect(f.usages).toHaveLength(2)
    expect(f.usages[0].operationId).toBe(firstOperation)
    expect(f.usages[1].operationId).not.toBe(firstOperation)
    expect(f.operations.at(-1)?.action).toBe('reregistered')
  })
  it('ordinary re-registration clears current free qualification without touching consumed history', async () => {
    const f = fixture()
    await f.service.write('activity', 'session', 'register', input)
    await f.service.write('activity', 'session', 'cancel')
    expect(await f.service.write('activity', 'session', 'register', { answers: [], contactPhone: input.contactPhone })).toMatchObject({ feeQualification: 'ordinary' })
    expect(f.usages).toHaveLength(1)
    expect(f.consume).toHaveBeenCalledTimes(1)
  })
})
