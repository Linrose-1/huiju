import 'reflect-metadata'
import { ValidationPipe } from '@nestjs/common'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import sharp from 'sharp'
import { CardSettingsDto, ProfileDetailsInput } from '../src/flow/member-card-dto.js'
import { cardSettings, MemberCardService, publicCard } from '../src/flow/member-card.js'
import type { FlowDatabase } from '../src/flow/common.js'
import type { IdentityService, Member } from '../src/flow/identity.js'

const member = { id: 'owner', kind: 'member', memberNumber: '1001', avatarUrl: '/avatar.png', displayName: '当前名称', avatarSetByUser: true, nameSetByUser: true, boundPhone: '19900000001', realName: '姓名', email: 'a@example.com', hometown: '深圳', bio: '简介', resources: '资源', needs: '需求', inviteCode: 'private', wechatId: 'rose_wechat', personalTag: '保持好奇', wechatQrFile: null } as Member
const all = { showRealName: true, showEmail: true, showBoundPhone: true, showHometown: true, showBio: true, showResources: true, showNeeds: true }
const empty = { realName: '', email: '', hometown: '', bio: '', resources: '', needs: '' }
const pipe = new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true })
const validateProfile = (value: unknown) => pipe.transform(value, { type: 'body', metatype: ProfileDetailsInput })
const validateSettings = (value: unknown) => pipe.transform(value, { type: 'body', metatype: CardSettingsDto })

function fixture(results: unknown[][] = [], caller: Member = member) {
  const writes: unknown[] = []
  const query: Record<string, unknown> = {}
  for (const name of ['from', 'where', 'limit']) query[name] = () => query
  query.then = (resolve: (value: unknown) => unknown) => Promise.resolve(results.shift() ?? []).then(resolve)
  const db = {
    select: vi.fn(() => query),
    update: vi.fn(() => ({ set: (values: unknown) => ({ where: async () => { writes.push(values) } }) })),
    insert: vi.fn(() => ({ values: (values: unknown) => ({ onDuplicateKeyUpdate: async (update: unknown) => { writes.push({ values, update }) } }) })),
  }
  const requireIdentity = vi.fn().mockResolvedValue(caller)
  const service = new MemberCardService({ db } as unknown as FlowDatabase, { require: requireIdentity } as unknown as IdentityService)
  return { service, db, writes, requireIdentity }
}

describe('member card validation and privacy', () => {
  it('accepts empty optional profile fields, trims strings and validates nonempty email', async () => {
    expect(await validateProfile(empty)).toEqual(empty)
    expect((await validateProfile({ ...empty, email: ' a@example.com ', realName: ' 姓名 ' })).email).toBe('a@example.com')
    for (const email of ['bad', null, 42, undefined]) await expect(validateProfile({ ...empty, email })).rejects.toThrow()
    for (const field of Object.keys(empty)) {
      const missing: Record<string, unknown> = { ...empty }; delete missing[field]
      await expect(validateProfile(missing)).rejects.toThrow()
      await expect(validateProfile({ ...empty, [field]: null })).rejects.toThrow()
    }
  })

  it('rejects oversized fields and unexpected identity or contact updates', async () => {
    for (const [field, length] of Object.entries({ realName: 101, hometown: 101, bio: 2001, resources: 2001, needs: 2001 })) await expect(validateProfile({ ...empty, [field]: '字'.repeat(length) })).rejects.toThrow()
    for (const field of ['boundPhone', 'avatarUrl', 'displayName', 'inviteCode', 'id', 'kind']) await expect(validateProfile({ ...empty, [field]: 'forbidden' })).rejects.toThrow()
  })

  it('requires all seven actual booleans and forbids avatar/name switches', async () => {
    expect(await validateSettings(all)).toEqual(all)
    expect(await validateSettings(cardSettings())).toEqual(cardSettings())
    for (const field of Object.keys(all)) {
      const missing: Record<string, unknown> = { ...all }; delete missing[field]
      await expect(validateSettings(missing)).rejects.toThrow()
      for (const value of ['true', 1, null]) await expect(validateSettings({ ...all, [field]: value })).rejects.toThrow()
    }
    for (const field of ['showAvatar', 'showDisplayName', 'memberId']) await expect(validateSettings({ ...all, [field]: false })).rejects.toThrow()
  })

  it('defaults missing settings to private and omits disabled keys entirely', () => {
    const base = { avatarUrl: member.avatarUrl, displayName: member.displayName }
    expect(publicCard(member, cardSettings())).toEqual(base)
    expect(publicCard(member, cardSettings({ showBio: true }))).toEqual({ ...base, bio: '简介' })
    const full = publicCard(member, all)
    expect(Object.keys(full).sort()).toEqual(['avatarUrl', 'displayName', 'realName', 'email', 'boundPhone', 'hometown', 'bio', 'resources', 'needs'].sort())
    expect(publicCard({ ...member, bio: null }, all).bio).toBeNull()
    expect(publicCard({ ...member, boundPhone: null }, cardSettings())).toEqual({ avatarUrl: null, displayName: '游客1001' })
  })
})

describe('member card service authorization', () => {
  it('requires identity on every endpoint and performs no database operations on denial', async () => {
    const f = fixture(); f.requireIdentity.mockRejectedValue(new Error('SESSION_REQUIRED'))
    for (const operation of [() => f.service.profile(), () => f.service.saveProfile(empty), () => f.service.settings(), () => f.service.saveSettings(all), () => f.service.card('target')]) await expect(operation()).rejects.toThrow('SESSION_REQUIRED')
    expect(f.db.select).not.toHaveBeenCalled(); expect(f.db.update).not.toHaveBeenCalled(); expect(f.db.insert).not.toHaveBeenCalled()
  })

  it('allows incomplete members to maintain their own profile, writing only the six fields', async () => {
    const f = fixture([], { ...member, boundPhone: null })
    expect(await f.service.profile('session')).toEqual({ realName: '姓名', email: 'a@example.com', hometown: '深圳', bio: '简介', resources: '资源', needs: '需求', wechatId: 'rose_wechat', personalTag: '保持好奇', wechatQrUrl: null })
    expect(await f.service.saveProfile({ ...empty, bio: ' 新简介 ' }, 'session')).toEqual({ realName: null, email: null, hometown: null, bio: '新简介', resources: null, needs: null, wechatId: 'rose_wechat', personalTag: '保持好奇', wechatQrUrl: null })
    expect(f.writes).toHaveLength(1)
    expect(f.requireIdentity).toHaveBeenCalledWith('session')
  })

  it('returns private defaults for missing rows and upserts only the seven settings', async () => {
    const f = fixture([[], [all]])
    expect(await f.service.settings('session')).toEqual(cardSettings())
    expect(await f.service.saveSettings(all, 'session')).toEqual(cardSettings(all))
    expect(f.writes).toEqual([{ values: { memberId: member.id, ...all }, update: { set: all } }])
  })

  it('blocks incomplete viewers before querying targets', async () => {
    for (const change of [{ boundPhone: null }, { avatarUrl: null }, { displayName: ' ' }, { nameSetByUser: false }, { avatarSetByUser: false }]) {
      const f = fixture([], { ...member, ...change })
      await expect(f.service.card('target', 'session')).rejects.toMatchObject({ response: { code: 'PROFILE_INCOMPLETE' } })
      expect(f.db.select).not.toHaveBeenCalled()
    }
  })

  it('does not bypass settings for the owner and returns current allowed values only', async () => {
    const f = fixture([[member], [], [{ ...member, bio: '已更新' }], [{ showBio: true }]])
    expect(await f.service.card(member.id, 'session')).toEqual({ avatarUrl: member.avatarUrl, displayName: member.displayName })
    expect(await f.service.card(member.id, 'session')).toEqual({ avatarUrl: member.avatarUrl, displayName: member.displayName, bio: '已更新' })
  })

  it('returns not found for missing target', async () => {
    await expect(fixture([[]]).service.card('missing', 'session')).rejects.toMatchObject({ response: { code: 'NOT_FOUND' } })
  })
})

const qrDirectories: string[] = []
afterEach(async () => {
  vi.unstubAllEnvs()
  for (const directory of qrDirectories.splice(0)) await rm(directory, { recursive: true, force: true })
})
async function qrDirectory() {
  const directory = await mkdtemp(join(tmpdir(), 'huiju-member-qr-'))
  qrDirectories.push(directory); vi.stubEnv('LOCAL_MEMBER_QR_DIRECTORY', directory)
  return directory
}

describe('optional WeChat identity, personal tag and private QR', () => {
  it('validates optional text without accepting null, overlong values or QR paths', async () => {
    expect((await validateProfile({ ...empty, wechatId: '  wx_rose  ', personalTag: ' 保持好奇 ' })).wechatId).toBe('wx_rose')
    for (const [key, max] of [['wechatId', 100], ['personalTag', 50]] as const) {
      expect((await validateProfile({ ...empty, [key]: '字'.repeat(max) }))[key]).toHaveLength(max)
      for (const value of [null, 1, '字'.repeat(max + 1)]) await expect(validateProfile({ ...empty, [key]: value })).rejects.toThrow()
    }
    for (const field of ['wechatQrUrl', 'wechatQrFile']) await expect(validateProfile({ ...empty, [field]: '/private.png' })).rejects.toThrow()
    for (const key of ['showWechatId', 'showWechatQr', 'showPersonalTag']) {
      for (const value of [null, 'true', 1]) await expect(validateSettings({ ...all, [key]: value })).rejects.toThrow()
    }
  })

  it('defaults all new fields to hidden and reveals only enabled fields without internal file names', () => {
    const target = { ...member, wechatQrFile: '00000000-0000-4000-8000-000000000001.png' }
    const hidden = publicCard(target, cardSettings())
    expect(hidden).not.toHaveProperty('wechatId'); expect(hidden).not.toHaveProperty('personalTag'); expect(hidden).not.toHaveProperty('wechatQrUrl')
    expect(publicCard(target, cardSettings({ showWechatId: true }))).toEqual({ ...hidden, wechatId: 'rose_wechat' })
    const visible = publicCard(target, cardSettings({ showWechatQr: true, showPersonalTag: true }))
    expect(visible).toEqual({ ...hidden, personalTag: '保持好奇', wechatQrUrl: '/api/v1/members/owner/wechat-qr' })
    expect(JSON.stringify(visible)).not.toContain(target.wechatQrFile)
  })

  it('preserves new fields and visibility when an older client omits them', async () => {
    const f = fixture([[{ ...all, showWechatId: true, showPersonalTag: true, showWechatQr: true }]])
    const saved = await f.service.saveProfile(empty, 'session')
    expect(saved.wechatId).toBe(member.wechatId); expect(saved.personalTag).toBe(member.personalTag)
    expect(f.writes[0]).not.toHaveProperty('wechatId'); expect(f.writes[0]).not.toHaveProperty('personalTag')
    const settings = await f.service.saveSettings(all, 'session')
    expect(settings.showWechatQr).toBe(true)
    expect(f.writes[1]).toEqual({ values: { memberId: member.id, ...all }, update: { set: all } })
    await f.service.saveProfile({ ...empty, wechatId: '', personalTag: '' }, 'session')
    expect(f.writes[2]).toMatchObject({ wechatId: null, personalTag: null })
  })

  it('uploads validated PNG privately, binds only the caller and removes only the reference', async () => {
    const directory = await qrDirectory(), f = fixture()
    const bytes = await sharp({ create: { width: 8, height: 8, channels: 3, background: '#ffffff' } }).png().toBuffer()
    const result = await f.service.saveWechatQr({ base64: bytes.toString('base64'), mimeType: 'image/png' }, 'session')
    expect(result).toEqual({ wechatQrUrl: '/api/v1/members/owner/wechat-qr' })
    const file = (f.writes[0] as { wechatQrFile: string }).wechatQrFile
    expect(file).toMatch(/^[a-f0-9-]{36}\.png$/)
    expect(await readFile(join(directory, file))).toEqual(bytes)
    expect(await f.service.removeWechatQr('session')).toEqual({ wechatQrUrl: null })
    expect(f.writes[1]).toEqual({ wechatQrFile: null })
    expect(await readFile(join(directory, file))).toEqual(bytes)
    for (const input of [{ base64: bytes.toString('base64'), mimeType: 'image/jpeg' }, { base64: Buffer.alloc(2 * 1024 * 1024 + 1).toString('base64'), mimeType: 'image/png' }]) {
      await expect(f.service.saveWechatQr(input, 'session')).rejects.toMatchObject({ response: { code: 'INVALID_IMAGE' } })
    }
    expect(f.writes).toHaveLength(2)
  })

  it('rechecks QR visibility and membership on every read, including old URLs', async () => {
    const directory = await qrDirectory(), file = '00000000-0000-4000-8000-000000000001.png'
    await writeFile(join(directory, file), Buffer.from('private-image'))
    const target = { ...member, id: 'target', wechatQrFile: file }
    const f = fixture([[target], [{ showWechatQr: true }], [target], [{ showWechatQr: false }]])
    expect((await f.service.wechatQr('target', 'session')).bytes.toString()).toBe('private-image')
    await expect(f.service.wechatQr('target', 'session')).rejects.toMatchObject({ response: { code: 'NOT_FOUND' } })
    const visitor = fixture([], { ...member, boundPhone: null })
    await expect(visitor.service.wechatQr('target', 'session')).rejects.toMatchObject({ response: { code: 'PROFILE_INCOMPLETE' } })
    expect(visitor.db.select).not.toHaveBeenCalled()
    const owner = fixture([[{ ...target, id: member.id }]], { ...member, boundPhone: null })
    expect((await owner.service.wechatQr(member.id, 'session')).type).toBe('image/png')
    expect(owner.db.select).toHaveBeenCalledTimes(1)
    await expect(fixture([[{ ...target, wechatQrFile: '../escape.png' }]], target).service.wechatQr('target', 'session')).rejects.toMatchObject({ response: { code: 'NOT_FOUND' } })
  })

  it('denies all QR operations without identity and never writes or queries data', async () => {
    const f = fixture(); f.requireIdentity.mockRejectedValue(new Error('SESSION_REQUIRED'))
    for (const operation of [() => f.service.saveWechatQr({ base64: '', mimeType: 'image/png' }), () => f.service.removeWechatQr(), () => f.service.wechatQr('target')]) await expect(operation()).rejects.toThrow('SESSION_REQUIRED')
    expect(f.db.select).not.toHaveBeenCalled(); expect(f.db.update).not.toHaveBeenCalled()
  })
})
