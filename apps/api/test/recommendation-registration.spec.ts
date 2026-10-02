import 'reflect-metadata'
import { describe, expect, it, vi } from 'vitest'
import { activities, registrationQuestions } from '../src/database/schema/activities.js'
import { members } from '../src/database/schema/members.js'
import { registrationAnswers, registrationOperations, registrations } from '../src/database/schema/registrations.js'
import { ActivityService } from '../src/flow/activity.js'
import { FlowDatabase } from '../src/flow/common.js'
import { IdentityService } from '../src/flow/identity.js'
import { RecommendationRecordsService } from '../src/recommendations/records.js'

function fixture(initial?: 'active' | 'cancelled', defaultRecords = false) {
  const member = { id: 'member', boundPhone: '13800000000', avatarUrl: '/avatar', displayName: '会员', avatarSetByUser: true, nameSetByUser: true }
  const activity = { id: 'activity', lifecycle: 'published', moderation: 'normal', startsAt: new Date('2099-01-01'), endsAt: new Date('2099-01-02'), registrationDeadline: null, capacity: 10, activeRegistrationCount: 1 }
  type Row = Record<string, unknown>
  let registration: Row | undefined = initial ? { id: 'registration', activityId: activity.id, memberId: member.id, status: initial, contactPhone: '13800000000', currentRegisteredAt: new Date(), cancelledAt: initial === 'cancelled' ? new Date() : null } : undefined
  let operations: Row[] = [], inTransaction = false
  const select = () => ({ from: (table: unknown) => {
    const result = () => {
      if (table === activities) return [activity]
      if (table === members) return [member]
      if (table === registrations) return registration ? [registration] : []
      if (table === registrationQuestions || table === registrationAnswers) return []
      throw new Error('Ordinary registration must not access recommendation storage')
    }
    const query = { where: () => query, limit: async () => result(), for: async () => result(), then: (resolve: (value: unknown) => unknown) => Promise.resolve(result()).then(resolve) }
    return query
  } })
  const tx = { select,
    insert: (table: unknown) => ({ values: async (values: Row) => {
      if (table === registrations) registration = { ...values, status: 'active', cancelledAt: null }
      else if (table === registrationOperations) operations.push(values)
      else throw new Error('Unexpected insert')
    } }),
    update: (table: unknown) => ({ set: (values: Row) => ({ where: async () => { if (table === registrations) Object.assign(registration!, values) } }) }),
    delete: () => ({ where: async () => undefined }),
  }
  const database = { db: { ...tx, transaction: async <T>(work: (value: typeof tx) => Promise<T>) => {
    const previous = structuredClone(registration), previousOperations = structuredClone(operations)
    inTransaction = true
    try { return await work(tx) }
    catch (error) { registration = previous; operations = previousOperations; throw error }
    finally { inTransaction = false }
  } } } as unknown as FlowDatabase
  const conversion = vi.fn(async (_tx: unknown, _token: string, _member: string, _activity: string, operation: string) => {
    expect(inTransaction).toBe(true)
    expect(operations.some(row => row.id === operation)).toBe(true)
  })
  const records = { conversion } as unknown as RecommendationRecordsService
  const identity = { require: async () => member } as unknown as IdentityService
  const service = defaultRecords ? new ActivityService(database, identity) : new ActivityService(database, identity, records)
  return { service, tx, conversion, get operations() { return operations }, get registration() { return registration } }
}
const input = { answers: [], contactPhone: '13800000000', recommendationToken: 'x'.repeat(43) }

describe('recommendation attribution joins the existing registration transaction', () => {
  it.each([undefined, 'cancelled'] as const)('links only an actual new registration operation from %s', async initial => {
    const f = fixture(initial)
    await f.service.write('activity', 'session', 'register', input)
    expect(f.operations).toHaveLength(1)
    expect(f.operations[0].action).toBe(initial ? 'reregistered' : 'registered')
    expect(f.conversion).toHaveBeenCalledExactlyOnceWith(f.tx, input.recommendationToken, 'member', 'activity', f.operations[0].id)
  })
  it.each(['register', 'edit', 'cancel'] as const)('does not attribute active idempotency or edits/cancellations: %s', async action => {
    const f = fixture('active')
    await f.service.write('activity', 'session', action, input)
    expect(f.conversion).not.toHaveBeenCalled()
  })
  it('keeps ordinary registration compatible with an old database without recommendation tables', async () => {
    const f = fixture(undefined, true)
    expect(await f.service.write('activity', 'session', 'register', { answers: [], contactPhone: input.contactPhone })).toMatchObject({ status: 'active' })
    expect(f.operations[0].action).toBe('registered')
  })
  it('rolls back the real registration and its operation if attribution storage fails', async () => {
    const f = fixture()
    f.conversion.mockRejectedValueOnce(new Error('transaction storage failed'))
    await expect(f.service.write('activity', 'session', 'register', input)).rejects.toThrow('transaction storage failed')
    expect(f.registration).toBeUndefined()
    expect(f.operations).toEqual([])
  })
})
