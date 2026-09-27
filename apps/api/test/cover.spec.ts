import 'reflect-metadata'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import sharp from 'sharp'
import { OrganizerService, activityValues } from '../src/flow/organizer.js'
import { FlowDatabase } from '../src/flow/common.js'
import { IdentityService } from '../src/flow/identity.js'

const member = { id: '11111111-1111-4111-8111-111111111111', boundPhone: '19900000001', avatarUrl: '/avatar.png', avatarSetByUser: true, displayName: '测试', nameSetByUser: true }
const body = { title: '测试', description: '介绍', location: '地点', consultationContact: '测试', startsAt: '2099-01-01T00:00:00Z', endsAt: '2099-01-01T01:00:00Z', feeType: 'free' as const, questions: [] }
let directory = ''
afterEach(async () => { vi.unstubAllEnvs(); if (directory) { await rm(directory, { recursive: true, force: true }); directory = '' } })
function service(require = vi.fn().mockResolvedValue(member)) {
  return new OrganizerService({} as FlowDatabase, { require } as unknown as IdentityService)
}
describe('local cover storage', () => {
  it('validates decoded bytes, stores separately, serves bytes and verifies ownership/existence', async () => {
    directory = await mkdtemp(join(tmpdir(), 'huiju-cover-'))
    vi.stubEnv('LOCAL_COVER_DIRECTORY', directory)
    const api = service()
    const bytes = await sharp({ create: { width: 32, height: 18, channels: 3, background: '#167a54' } }).png().toBuffer()
    const result = await api.uploadCover({ base64: bytes.toString('base64'), mimeType: 'image/png' })
    const name = result.coverUrl.split('/').pop()!
    expect(await api.coverImage(name)).toEqual(bytes)
    expect(activityValues({ ...body, coverUrl: result.coverUrl }).coverUrl).toBe(result.coverUrl)
    const other = service(vi.fn().mockResolvedValue({ ...member, id: '22222222-2222-4222-8222-222222222222' }))
    await expect(other.create({ ...body, coverUrl: result.coverUrl })).rejects.toThrow('本人上传')
    await expect(api.create({ ...body, coverUrl: result.coverUrl.replace(name, member.id + '_33333333-3333-4333-8333-333333333333.png') })).rejects.toThrow('图片不存在')
    await expect(api.coverImage('../secret')).rejects.toThrow('图片不存在')
    await expect(api.uploadCover({ base64: bytes.toString('base64'), mimeType: 'image/jpeg' })).rejects.toThrow('有效')
    await expect(api.uploadCover({ base64: Buffer.alloc(2 * 1024 * 1024 + 1).toString('base64'), mimeType: 'image/png' })).rejects.toThrow('2MB')
    expect(await readdir(directory)).toEqual([name])
  })
  it('requires authenticated complete identity before accepting files', async () => {
    await expect(service(vi.fn().mockRejectedValue(new Error('未登录'))).uploadCover({ base64: '', mimeType: 'image/png' })).rejects.toThrow('未登录')
    await expect(service(vi.fn().mockResolvedValue({ ...member, avatarSetByUser: false })).uploadCover({ base64: '', mimeType: 'image/png' })).rejects.toThrow('绑定手机号')
  })
})
