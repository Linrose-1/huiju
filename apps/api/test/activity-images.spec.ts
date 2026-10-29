import 'reflect-metadata'
import { describe, expect, it, vi } from 'vitest'
import { ValidationPipe } from '@nestjs/common'
import sharp from 'sharp'
import { activityImages, activityCoverSource } from '../src/flow/activity-images.js'
import { activityValues, OrganizerService, validateActivityEdit } from '../src/flow/organizer.js'
import { ActivityWriteInput, ManagedActivityDto } from '../src/flow/organizer-dto.js'
import type { FlowDatabase } from '../src/flow/common.js'
import type { IdentityService } from '../src/flow/identity.js'
import type { activities } from '../src/database/schema/activities.js'

const owner = '00000000-0000-4000-8000-000000000001'
const prefix = '/api/v1/media/covers/'
const cover = `${prefix}${owner}_00000000-0000-4000-8000-000000000002.png`
const extra = `${prefix}${owner}_00000000-0000-4000-8000-000000000003.png`
const third = `${prefix}${owner}_00000000-0000-4000-8000-000000000004.png`
const input: ActivityWriteInput = { title: '活动', description: '交流', location: '园区', consultationContact: '联系发起人', startsAt: '2099-01-02T08:00:00.000Z', endsAt: '2099-01-02T10:00:00.000Z', feeType: 'free', questions: [] }
const base = { ...activityValues(input), organizerMemberId: owner, lifecycle: 'published', moderation: 'normal', hasRegistrationEver: false, activeRegistrationCount: 0 } as typeof activities.$inferSelect
const pipe = new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true })
const png = (width: number, height: number) => sharp({ create: { width, height, channels: 3, background: '#176448' } }).png().toBuffer()

function serviceFixture() {
  const transaction = vi.fn().mockResolvedValue(undefined)
  const service = new OrganizerService({ db: { transaction } } as unknown as FlowDatabase, { require: vi.fn().mockResolvedValue({ id: owner }) } as unknown as IdentityService)
  vi.spyOn(service, 'detail').mockResolvedValue({} as ManagedActivityDto)
  return { service, transaction }
}

describe('activity images', () => {
  it('validates 0..3 unique URLs and rejects nullable or malformed image lists', async () => {
    for (const imageUrls of [[], [cover], [cover, extra], [cover, extra, third]]) {
      await expect(pipe.transform({ ...input, imageUrls }, { type: 'body', metatype: ActivityWriteInput })).resolves.toBeInstanceOf(ActivityWriteInput)
      expect(activityValues({ ...input, imageUrls })).toMatchObject({ coverUrl: imageUrls[0] ?? null, imageUrls: { urls: imageUrls, coverSourceUrl: imageUrls[0] ?? null } })
    }
    for (const imageUrls of [null, 'bad', [cover, extra, third, 'fourth'], [cover, cover], [''], [5]]) {
      await expect(pipe.transform({ ...input, imageUrls }, { type: 'body', metatype: ActivityWriteInput })).rejects.toThrow()
    }
    expect(() => activityValues({ ...input, coverUrl: cover, imageUrls: [extra] })).toThrow('第一张')
  })

  it('reads old single covers without rewriting them and preserves omitted images on edit', () => {
    const legacy = { ...base, coverUrl: 'https://example.com/legacy.jpg', imageUrls: null }
    expect(activityImages(legacy)).toEqual([legacy.coverUrl])
    expect(activityImages(base)).toEqual([])
    expect(validateActivityEdit(legacy, [], input).values).toMatchObject({ coverUrl: legacy.coverUrl, imageUrls: { urls: [legacy.coverUrl], coverSourceUrl: legacy.coverUrl } })
    expect(() => validateActivityEdit(legacy, [], { ...input, consultationContact: '新的联系方式' }, base.startsAt)).not.toThrow()
    expect(() => validateActivityEdit(base, [], { ...input, consultationContact: '新的联系方式' }, base.startsAt)).not.toThrow()
    const current = { ...base, coverUrl: cover, imageUrls: [cover, extra] }
    expect(activityImages(validateActivityEdit(current, [], { ...input, coverUrl: cover }).values)).toEqual([cover, extra])
    expect(validateActivityEdit(current, [], { ...input, imageUrls: [] }).values).toMatchObject({ coverUrl: null, imageUrls: { urls: [], coverSourceUrl: null } })
  })

  it('compares image content after activity start, and prevents any image changes', () => {
    const current = { ...base, coverUrl: cover, imageUrls: [cover, extra] }
    expect(() => validateActivityEdit(current, [], { ...input, imageUrls: [cover, extra] }, base.startsAt)).not.toThrow()
    expect(() => validateActivityEdit(current, [], { ...input, imageUrls: [cover] }, base.startsAt)).toThrow('仅可修改')
  })

  it('checks ownership, existence and 5:4 of new covers before entering write transaction', async () => {
    const { service, transaction } = serviceFixture()
    const read = vi.spyOn(service, 'coverImage').mockResolvedValue(await png(125, 100))
    await expect(service.create({ ...input, imageUrls: [cover] })).resolves.toBeDefined()
    expect(transaction).toHaveBeenCalledTimes(1)
    transaction.mockClear()
    for (const url of ['https://example.com/new.jpg', cover.replace(owner, '00000000-0000-4000-8000-000000000099'), `${prefix}../private.png`]) {
      await expect(service.create({ ...input, imageUrls: [url] })).rejects.toThrow('本人上传')
    }
    read.mockResolvedValue(await png(100, 125))
    await expect(service.create({ ...input, imageUrls: [cover] })).rejects.toThrow('5:4')
    read.mockRejectedValue(new Error('图片不存在'))
    await expect(service.create({ ...input, imageUrls: [cover] })).rejects.toThrow('图片不存在')
    expect(transaction).not.toHaveBeenCalled()
  })

  it('allows arbitrary proportions for later images but checks their ownership and existence', async () => {
    const { service, transaction } = serviceFixture()
    const first = await png(125, 100), later = await png(40, 160)
    const read = vi.spyOn(service, 'coverImage').mockImplementation(name => Promise.resolve(name === cover.slice(prefix.length) ? first : later))
    await service.create({ ...input, imageUrls: [cover, extra, third] })
    expect(read).toHaveBeenCalledTimes(3)
    expect(transaction).toHaveBeenCalledTimes(1)
    await expect(service.create({ ...input, imageUrls: [cover, 'https://example.com/photo.jpg'] })).rejects.toThrow('本人上传')
  })

  it('preserves a legacy cover during service editing while validating newly attached images', async () => {
    const legacy = { ...base, id: 'activity', coverUrl: 'https://example.com/legacy.jpg', imageUrls: null }
    const rows: unknown[][] = [[legacy], []]
    const query: Record<string, unknown> = {}
    for (const name of ['from', 'where', 'for', 'orderBy']) query[name] = () => query
    query.then = (resolve: (value: unknown) => unknown) => Promise.resolve(rows.shift()).then(resolve)
    const set = vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue(undefined) })
    const tx = { select: () => query, update: () => ({ set }) }
    const db = { transaction: (callback: (value: typeof tx) => Promise<void>) => callback(tx) }
    const service = new OrganizerService({ db } as unknown as FlowDatabase, { require: vi.fn().mockResolvedValue({ id: owner }) } as unknown as IdentityService)
    vi.spyOn(service, 'detail').mockResolvedValue({} as ManagedActivityDto)
    const read = vi.spyOn(service, 'coverImage').mockResolvedValue(await png(40, 160))
    await service.edit(legacy.id, { ...input, imageUrls: [legacy.coverUrl, extra] })
    expect(set).toHaveBeenCalledWith(expect.objectContaining({ coverUrl: legacy.coverUrl, imageUrls: { urls: [legacy.coverUrl, extra], coverSourceUrl: legacy.coverUrl } }))
    expect(read).toHaveBeenCalledTimes(1)
    expect(read).toHaveBeenCalledWith(extra.slice(prefix.length))
  })

  it('preserves source originals across later edits and clears them with the cover', () => {
    const current = { ...base, coverUrl: cover, imageUrls: { urls: [cover, extra], coverSourceUrl: third } }
    expect(activityImages(current)).toEqual([cover, extra])
    expect(activityCoverSource(current)).toBe(third)
    expect(activityCoverSource({ coverUrl: cover, imageUrls: [cover] })).toBe(cover)
    expect(validateActivityEdit(current, [], input).values.imageUrls.coverSourceUrl).toBe(third)
    expect(validateActivityEdit(current, [], { ...input, imageUrls: [cover, extra] }).values.imageUrls.coverSourceUrl).toBe(third)
    expect(validateActivityEdit(current, [], { ...input, imageUrls: [extra] }).values.imageUrls.coverSourceUrl).toBe(extra)
    expect(validateActivityEdit(current, [], { ...input, imageUrls: [], coverSourceUrl: third }).values.imageUrls.coverSourceUrl).toBeNull()
    expect(() => validateActivityEdit(current, [], { ...input, consultationContact: '新联系方式' }, base.startsAt)).not.toThrow()
    expect(() => validateActivityEdit(current, [], { ...input, coverSourceUrl: extra }, base.startsAt)).toThrow('仅可修改')
  })

  it('accepts owner source originals with any aspect ratio but rejects foreign or missing sources', async () => {
    const { service, transaction } = serviceFixture()
    const cropped = await png(125, 100), source = await png(40, 160)
    const read = vi.spyOn(service, 'coverImage').mockImplementation(name => Promise.resolve(name === cover.slice(prefix.length) ? cropped : source))
    await service.create({ ...input, imageUrls: [cover], coverSourceUrl: third })
    expect(read).toHaveBeenCalledWith(third.slice(prefix.length))
    expect(transaction).toHaveBeenCalledTimes(1)
    transaction.mockClear()
    await expect(service.create({ ...input, imageUrls: [cover], coverSourceUrl: third.replace(owner, '00000000-0000-4000-8000-000000000099') })).rejects.toThrow('本人上传的封面原图')
    await expect(service.create({ ...input, imageUrls: [cover], coverSourceUrl: 'https://example.com/source.jpg' })).rejects.toThrow('本人上传的封面原图')
    read.mockImplementation(name => name === cover.slice(prefix.length) ? Promise.resolve(cropped) : Promise.reject(new Error('图片不存在')))
    await expect(service.create({ ...input, imageUrls: [cover], coverSourceUrl: third })).rejects.toThrow('图片不存在')
    expect(transaction).not.toHaveBeenCalled()
  })
})
