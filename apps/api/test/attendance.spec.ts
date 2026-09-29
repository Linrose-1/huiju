import 'reflect-metadata'
import { describe, expect, it, vi } from 'vitest'
import type { SQL } from 'drizzle-orm'
import { MySqlDialect } from 'drizzle-orm/mysql-core'
import { activities } from '../src/database/schema/activities.js'
import { members } from '../src/database/schema/members.js'
import { registrations } from '../src/database/schema/registrations.js'
import type { FlowDatabase } from '../src/flow/common.js'
import type { IdentityService } from '../src/flow/identity.js'
import { OrganizerService } from '../src/flow/organizer.js'

const completeMember = { id: 'owner', boundPhone: '19900000001', avatarUrl: '/avatar.png', displayName: '发起人', avatarSetByUser: true, nameSetByUser: true }
const dialect = new MySqlDialect()

// This repository double verifies service decisions and query scope, not MySQL locking.
function fixture() {
  const activity = { id: 'activity', organizerMemberId: 'owner', lifecycle: 'published', moderation: 'normal', activeRegistrationCount: 2, endsAt: new Date('2020-01-01') }
  const registration = { id: 'registration', activityId: activity.id, status: 'active', attended: false, attendedAt: null as Date | null, attendanceMarkedByMemberId: null as string | null }
  const member = { ...completeMember }
  const locks: unknown[] = []
  const writes: { table: unknown; values: Record<string, unknown> }[] = []
  const selects: unknown[] = []
  const tx = {
    select: () => ({ from: (table: unknown) => ({ where: (where: SQL) => {
      selects.push(table)
      const params = dialect.sqlToQuery(where).params
      const rows = table === activities ? (params.includes(activity.id) ? [activity] : [])
        : table === members ? [member]
          : params.includes(registration.id) && params.includes(registration.activityId) ? [registration] : []
      return { then: (resolve: (value: unknown) => unknown) => Promise.resolve(rows).then(resolve), for: async (mode: string) => { expect(mode).toBe('update'); locks.push(table); return rows } }
    } }) }),
    update: (table: unknown) => ({ set: (values: Record<string, unknown>) => ({ where: async (where: SQL) => {
      expect(dialect.sqlToQuery(where).params).toEqual([registration.id, activity.id])
      writes.push({ table, values }); Object.assign(registration, values)
    } }) }),
  }
  const transaction = vi.fn(async (callback: (value: typeof tx) => unknown) => callback(tx))
  const requireIdentity = vi.fn().mockResolvedValue(completeMember)
  const service = new OrganizerService({ db: { transaction } } as unknown as FlowDatabase, { require: requireIdentity } as unknown as IdentityService)
  const mark = () => service.markAttendance(activity.id, registration.id, 'Bearer session')
  return { service, mark, activity, registration, member, locks, writes, selects, transaction, requireIdentity }
}

describe('organizer attendance', () => {
  it('requires login before touching the database', async () => {
    const f = fixture(); f.requireIdentity.mockRejectedValue(new Error('SESSION_REQUIRED'))
    await expect(f.mark()).rejects.toThrow('SESSION_REQUIRED')
    expect(f.transaction).not.toHaveBeenCalled()
  })

  it('rejects another member or administrator acting for the organizer', async () => {
    for (const id of ['other', 'admin']) {
      const f = fixture(); f.requireIdentity.mockResolvedValue({ ...completeMember, id })
      await expect(f.mark()).rejects.toMatchObject({ response: { code: 'FORBIDDEN' }, status: 403 })
      expect(f.selects).toEqual([activities]); expect(f.writes).toHaveLength(0)
    }
  })

  it('rechecks complete profile inside the transaction', async () => {
    const f = fixture(); f.member.nameSetByUser = false
    await expect(f.mark()).rejects.toMatchObject({ response: { code: 'PROFILE_INCOMPLETE' } })
    expect(f.writes).toHaveLength(0)
  })

  it('rejects missing activities and missing or foreign registrations', async () => {
    const f = fixture()
    await expect(f.service.markAttendance('missing', f.registration.id)).rejects.toMatchObject({ response: { code: 'NOT_FOUND' } })
    await expect(f.service.markAttendance(f.activity.id, 'missing')).rejects.toMatchObject({ response: { code: 'NOT_FOUND' } })
    f.registration.activityId = 'other-activity'
    await expect(f.mark()).rejects.toMatchObject({ response: { code: 'NOT_FOUND' } })
    expect(f.writes).toHaveLength(0)
  })

  it('rejects draft, cancelled and removed activities even for an already marked attendee', async () => {
    for (const state of [{ lifecycle: 'draft' }, { lifecycle: 'cancelled' }, { moderation: 'removed' }]) {
      const f = fixture(); Object.assign(f.activity, state); f.registration.attended = true
      await expect(f.mark()).rejects.toMatchObject({ response: { code: 'ACTIVITY_UNAVAILABLE' }, status: 409 })
      expect(f.locks).toEqual([activities]); expect(f.writes).toHaveLength(0)
    }
  })

  it('rejects a cancelled registration before the idempotency shortcut', async () => {
    const f = fixture(); f.registration.status = 'cancelled'; f.registration.attended = true
    await expect(f.mark()).rejects.toMatchObject({ response: { code: 'REGISTRATION_INACTIVE' }, status: 409 })
    expect(f.writes).toHaveLength(0)
  })

  it('locks activity before registration and writes all attendance fields without changing signup counts', async () => {
    const f = fixture()
    const result = await f.mark()
    expect(f.requireIdentity).toHaveBeenCalledWith('Bearer session')
    expect(f.locks).toEqual([activities, registrations])
    expect(f.writes).toEqual([{ table: registrations, values: { attended: true, attendedAt: expect.any(Date), attendanceMarkedByMemberId: 'owner' } }])
    expect(result).toEqual({ registrationId: f.registration.id, attended: true, attendedAt: f.registration.attendedAt!.toISOString() })
    expect(f.activity.activeRegistrationCount).toBe(2)
    expect(f.registration.status).toBe('active')
  })

  it('allows marking after the event has ended and preserves original time on repeat', async () => {
    const f = fixture()
    const first = await f.mark()
    expect(await f.mark()).toEqual(first)
    expect(f.writes).toHaveLength(1)
  })
})
