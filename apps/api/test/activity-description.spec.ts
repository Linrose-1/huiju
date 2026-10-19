import 'reflect-metadata'
import { describe, expect, it } from 'vitest'
import { plainToInstance } from 'class-transformer'
import { validate } from 'class-validator'
import { activityDescription, type DescriptionDelta } from '../src/flow/activity-description.js'
import { activityValues, validateActivityEdit } from '../src/flow/organizer.js'
import { ActivityService } from '../src/flow/activity.js'
import type { FlowDatabase } from '../src/flow/common.js'
import type { IdentityService } from '../src/flow/identity.js'
import { ActivityWriteInput } from '../src/flow/organizer-dto.js'
import { activities } from '../src/database/schema/activities.js'

const input: ActivityWriteInput = { title: '活动', description: '旧介绍', location: '会议室', consultationContact: '微信号', startsAt: '2030-01-02T08:00:00Z', endsAt: '2030-01-02T10:00:00Z', feeType: 'free', questions: [] }
const delta: DescriptionDelta = { ops: [{ insert: '活动', attributes: { bold: true, italic: true, underline: true } }, { insert: '\n', attributes: { list: 'bullet' } }] }
const started = new Date('2030-01-02T09:00:00Z')
const activity = () => ({ ...activityValues({ ...input, descriptionDelta: delta, registrationNotice: '请提前到场' }), lifecycle: 'published', moderation: 'normal', activeRegistrationCount: 0, hasRegistrationEver: false }) as typeof activities.$inferSelect

describe('activity description and notice', () => {
  it('derives searchable plain text from the delta rather than trusting submitted description', () => {
    const result = activityValues({ ...input, descriptionDelta: delta, registrationNotice: ' 请提前到场 ' })
    expect(result.description).toBe('活动')
    expect(result.descriptionDelta).toEqual(delta)
    expect(result.registrationNotice).toBe('请提前到场')
    expect(activityDescription('ignored', { ops: [{ insert: '一\n', attributes: { list: 'ordered' } }] }).description).toBe('一')
  })
  it.each([
    [], {}, { ops: [] }, { ops: 'text' }, { ops: [{ insert: { image: 'https://example.com/a.png' } }] },
    { ops: [{ insert: 'text', attributes: { link: 'javascript:alert(1)' } }] },
    { ops: [{ insert: 'text', attributes: { color: 'red' } }] },
    { ops: [{ insert: 'text', attributes: { bold: 'true' } }] },
    { ops: [{ insert: 'text', attributes: { list: 'checked' } }] },
    { ops: [{ insert: 'text', attributes: null }] }, { ops: [{ insert: 'text', retain: 1 }] },
    { ops: [{ delete: 1 }] }, { ops: [null] }, { ops: [{ insert: 'text' }], html: '<script>' },
    { ops: [{ insert: ' \n\t' }] }, { ops: [{ insert: 'a'.repeat(10001) }] },
    { ops: Array.from({ length: 1001 }, () => ({ insert: 'a' })) },
  ])('rejects malformed or unsupported rich text %j', value => {
    expect(() => activityValues({ ...input, descriptionDelta: value as DescriptionDelta })).toThrow(expect.objectContaining({ response: expect.objectContaining({ code: 'INVALID_ACTIVITY_DESCRIPTION' }) }))
  })
  it('supports legacy plain text, nullable rich text and blank optional notices with bounded lengths', () => {
    expect(activityValues(input)).toMatchObject({ description: input.description, descriptionDelta: null, registrationNotice: null })
    expect(activityValues({ ...input, descriptionDelta: null, registrationNotice: '  ' }).registrationNotice).toBeNull()
    expect(activityValues({ ...input, description: 'a'.repeat(10000), registrationNotice: 'a'.repeat(500) }).registrationNotice).toHaveLength(500)
    expect(activityDescription('ignored', { ops: [{ insert: 'a'.repeat(10000) + '\n' }] }).description).toHaveLength(10000)
    for (const body of [{ ...input, description: ' ' }, { ...input, description: 'a'.repeat(10001) }, { ...input, registrationNotice: 'a'.repeat(501) }]) expect(() => activityValues(body)).toThrow()
  })
  it('DTO retains both optional fields for domain validation and rejects non-object deltas and oversized notices', async () => {
    const options = { whitelist: true, forbidNonWhitelisted: true }
    const value = plainToInstance(ActivityWriteInput, { ...input, descriptionDelta: delta, registrationNotice: '提醒' })
    expect(await validate(value, options)).toHaveLength(0)
    expect(activityValues(value).descriptionDelta).toEqual(delta)
    for (const body of [{ ...input, descriptionDelta: [] }, { ...input, registrationNotice: 'a'.repeat(501) }]) expect((await validate(plainToInstance(ActivityWriteInput, body), options))).not.toHaveLength(0)
  })
  it('preserves omitted fields on contact edits and accepts equivalent formatting attribute order after start', () => {
    const existing = activity()
    const legacyContact = { ...input, description: existing.description, consultationContact: '新联系方式' }
    expect(validateActivityEdit(existing, [], legacyContact, started).values).toMatchObject({ descriptionDelta: delta, registrationNotice: '请提前到场' })
    const reordered: DescriptionDelta = { ops: [{ insert: '活动', attributes: { underline: true, italic: true, bold: true } }, { insert: '\n', attributes: { list: 'bullet' } }] }
    expect(() => validateActivityEdit(existing, [], { ...legacyContact, descriptionDelta: reordered, registrationNotice: '请提前到场' }, started)).not.toThrow()
  })
  it('locks new fields after start, including formatting-only edits and explicit clears', () => {
    const existing = activity(), body = { ...input, description: existing.description }
    for (const update of [{ descriptionDelta: null }, { descriptionDelta: { ops: [{ insert: '活动\n' }] } }, { registrationNotice: '新须知' }, { registrationNotice: null }]) {
      expect(() => validateActivityEdit(existing, [], { ...body, ...update }, started)).toThrow('仅可修改')
    }
  })
  it('lets legacy clients change plain text before start without retaining mismatched rich text', () => {
    const result = validateActivityEdit(activity(), [], input, new Date('2030-01-01')).values
    expect(result).toMatchObject({ description: '旧介绍', descriptionDelta: null, registrationNotice: '请提前到场' })
  })
  it.each(['normal', 'removed'] as const)('public detail projects new fields with %s moderation', async moderation => {
    const row = { ...activity(), id: 'activity', moderation }
    const db = { select: () => {
      let table: unknown
      const chain = { from: (value: unknown) => { table = value; return chain }, where: () => chain, limit: () => chain, orderBy: () => chain,
        then: (resolve: (rows: unknown) => unknown) => Promise.resolve(table === activities ? [row] : []).then(resolve) }
      return chain
    } }
    const service = new ActivityService({ db } as unknown as FlowDatabase, { require: async () => undefined } as unknown as IdentityService)
    const result = await service.detail(row.id)
    expect(result.descriptionDelta).toEqual(moderation === 'removed' ? null : delta)
    expect(result.registrationNotice).toBe(moderation === 'removed' ? null : '请提前到场')
  })
})
