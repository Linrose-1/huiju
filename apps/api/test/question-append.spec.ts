import 'reflect-metadata'
import { describe, expect, it, vi } from 'vitest'
import { activities, registrationQuestions } from '../src/database/schema/activities.js'
import type { FlowDatabase } from '../src/flow/common.js'
import type { IdentityService } from '../src/flow/identity.js'
import { activityValues, OrganizerService } from '../src/flow/organizer.js'
import { validateAnswers } from '../src/flow/activity.js'
import type { ActivityWriteInput, ManagedActivityDto } from '../src/flow/organizer-dto.js'

describe('append questions after registration', () => {
  it('keeps old question IDs and answers while inserting and sorting new private questions', async () => {
    const original = { id: 'old-question', activityId: 'activity', type: 'short_text' as const, prompt: '原问题', required: true, options: null, publicToParticipants: true, sortOrder: 0 }
    const body: ActivityWriteInput = { title: '活动', description: '交流', location: '会议室', consultationContact: '联系发起人',
      startsAt: '2099-01-02T08:00:00.000Z', endsAt: '2099-01-02T10:00:00.000Z', feeType: 'free',
      questions: [{ type: 'long_text', prompt: '新增必填', required: true }, { ...original, publicToParticipants: false }] }
    const activity = { id: 'activity', ...activityValues(body), organizerMemberId: 'owner', lifecycle: 'published', moderation: 'normal', hasRegistrationEver: true, activeRegistrationCount: 1 }
    const writes: { table: unknown; values: Record<string, unknown> }[] = []
    const inserted: Record<string, unknown>[] = []
    const select = vi.fn().mockImplementationOnce(() => ({ from: () => ({ where: () => ({ for: async () => [activity] }) }) }))
      .mockImplementationOnce(() => ({ from: () => ({ where: () => ({ orderBy: async () => [original] }) }) }))
    const tx = {
      select,
      update: (table: unknown) => ({ set: (values: Record<string, unknown>) => ({ where: async () => { writes.push({ table, values }) } }) }),
      insert: (table: unknown) => ({ values: async (values: Record<string, unknown>) => { expect(table).toBe(registrationQuestions); inserted.push(values) } }),
      delete: vi.fn(() => { throw new Error('Deleting questions would break historical answers') }),
    }
    const service = new OrganizerService({ db: { transaction: async (callback: (value: typeof tx) => unknown) => callback(tx) } } as unknown as FlowDatabase,
      { require: vi.fn().mockResolvedValue({ id: 'owner' }) } as unknown as IdentityService)
    vi.spyOn(service, 'detail').mockResolvedValue({} as ManagedActivityDto)
    await service.edit('activity', body, 'Bearer session')
    expect(tx.delete).not.toHaveBeenCalled()
    expect(writes.filter(write => write.table !== activities)).toEqual([{ table: registrationQuestions, values: { sortOrder: 1, publicToParticipants: false } }])
    expect(inserted).toEqual([{ id: expect.any(String), activityId: 'activity', type: 'long_text', prompt: '新增必填', required: true, publicToParticipants: false, options: null, sortOrder: 0 }])
    // Both new registrations and answer edits use the current question list.
    const current = [original, inserted[0]] as (typeof registrationQuestions.$inferSelect)[]
    const oldAnswers = [{ questionId: original.id, value: '原答案' }]
    expect(() => validateAnswers(current, oldAnswers)).toThrow('请回答所有必填问题')
    expect(() => validateAnswers(current, [...oldAnswers, { questionId: String(inserted[0].id), value: '补充答案' }])).not.toThrow()
  })
})
