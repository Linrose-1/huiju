import { Injectable } from '@nestjs/common'
import { and, eq } from 'drizzle-orm'
import { randomUUID } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { members, memberVisibilities } from '../database/schema/members.js'
import { fail, FlowDatabase } from './common.js'
import { complete, IdentityService, validAvatar, type Member } from './identity.js'
import { AvatarInput } from './dto.js'
import { CardSettingsDto, MemberCardDto, ProfileDetailsDto, ProfileDetailsInput, WechatQrDto } from './member-card-dto.js'

const fields = ['realName', 'email', 'hometown', 'bio', 'resources', 'needs', 'wechatId', 'personalTag'] as const
const visibilityFields = {
  showRealName: 'realName', showEmail: 'email', showBoundPhone: 'boundPhone',
  showHometown: 'hometown', showBio: 'bio', showResources: 'resources', showNeeds: 'needs',
  showWechatId: 'wechatId', showPersonalTag: 'personalTag',
} as const
const settingKeys = [...Object.keys(visibilityFields), 'showWechatQr'] as (keyof CardSettingsDto)[]
const qrUrl = (member: Member) => member.wechatQrFile ? `/api/v1/members/${member.id}/wechat-qr` : null
const profileDetails = (member: Member): ProfileDetailsDto => ({
  ...Object.fromEntries(fields.map(field => [field, member[field] ?? null])), wechatQrUrl: qrUrl(member),
}) as ProfileDetailsDto

export function cardSettings(row?: Partial<CardSettingsDto>): CardSettingsDto {
  return Object.fromEntries(settingKeys.map(key => [key, row?.[key] === true])) as unknown as CardSettingsDto
}

export function publicCard(member: Member, settings: CardSettingsDto): MemberCardDto {
  const card: MemberCardDto = {
    avatarUrl: complete(member) ? member.avatarUrl : null,
    displayName: complete(member) ? member.displayName! : `游客${member.memberNumber}`,
  }
  for (const [setting, field] of Object.entries(visibilityFields)) {
    if (settings[setting as keyof CardSettingsDto]) card[field] = member[field]
  }
  if (settings.showWechatQr) card.wechatQrUrl = qrUrl(member)
  return card
}

@Injectable()
export class MemberCardService {
  constructor(private readonly database: FlowDatabase, private readonly identity: IdentityService) {}

  async profile(header?: string): Promise<ProfileDetailsDto> {
    const member = (await this.identity.require(header))!
    return profileDetails(member)
  }

  async saveProfile(input: ProfileDetailsInput, header?: string): Promise<ProfileDetailsDto> {
    const member = (await this.identity.require(header))!
    const values = Object.fromEntries(fields.filter(field => input[field] !== undefined).map(field => [field, input[field]!.trim() || null]))
    await this.database.db.update(members).set(values).where(eq(members.id, member.id))
    return profileDetails({ ...member, ...values })
  }

  private async settingsFor(id: string) {
    const [settings] = await this.database.db.select().from(memberVisibilities).where(eq(memberVisibilities.memberId, id)).limit(1)
    return cardSettings(settings)
  }

  async settings(header?: string): Promise<CardSettingsDto> {
    const member = (await this.identity.require(header))!
    return this.settingsFor(member.id)
  }

  async saveSettings(input: CardSettingsDto, header?: string): Promise<CardSettingsDto> {
    const member = (await this.identity.require(header))!
    // Old clients do not know the new switches; omission must not revoke them.
    const values = Object.fromEntries(settingKeys.filter(key => input[key] !== undefined).map(key => [key, input[key] === true]))
    await this.database.db.insert(memberVisibilities).values({ memberId: member.id, ...values }).onDuplicateKeyUpdate({ set: values })
    return this.settingsFor(member.id)
  }

  async card(id: string, header?: string): Promise<MemberCardDto> {
    const caller = (await this.identity.require(header))!
    if (!complete(caller)) fail('PROFILE_INCOMPLETE', '请先完善手机号、头像和用户名称', 403)
    const [member] = await this.database.db.select().from(members).where(and(eq(members.id, id), eq(members.kind, 'member'))).limit(1)
    if (!member) fail('NOT_FOUND', '会员名片不存在', 404)
    return publicCard(member, await this.settingsFor(id))
  }

  private qrDirectory() { return resolve(process.env.LOCAL_MEMBER_QR_DIRECTORY || '.local-uploads/member-wechat-qr') }

  async saveWechatQr(input: AvatarInput, header?: string): Promise<WechatQrDto> {
    const member = (await this.identity.require(header))!
    const bytes = await validAvatar(input)
    const file = `${randomUUID()}.${input.mimeType === 'image/png' ? 'png' : 'jpg'}`
    await mkdir(this.qrDirectory(), { recursive: true })
    await writeFile(resolve(this.qrDirectory(), file), bytes, { flag: 'wx' })
    await this.database.db.update(members).set({ wechatQrFile: file }).where(eq(members.id, member.id))
    return { wechatQrUrl: qrUrl({ ...member, wechatQrFile: file }) }
  }

  async removeWechatQr(header?: string): Promise<WechatQrDto> {
    const member = (await this.identity.require(header))!
    await this.database.db.update(members).set({ wechatQrFile: null }).where(eq(members.id, member.id))
    return { wechatQrUrl: null }
  }

  async wechatQr(id: string, header?: string) {
    const caller = (await this.identity.require(header))!
    if (caller.id !== id && !complete(caller)) fail('PROFILE_INCOMPLETE', '请先完善手机号、头像和用户名称', 403)
    const [member] = await this.database.db.select().from(members).where(and(eq(members.id, id), eq(members.kind, 'member'))).limit(1)
    if (!member?.wechatQrFile) fail('NOT_FOUND', '微信二维码不存在', 404)
    if (caller.id !== id && !(await this.settingsFor(id)).showWechatQr) fail('NOT_FOUND', '微信二维码不存在', 404)
    if (!/^[a-f0-9-]{36}\.(png|jpg)$/.test(member.wechatQrFile)) fail('NOT_FOUND', '微信二维码不存在', 404)
    try {
      return { bytes: await readFile(resolve(this.qrDirectory(), member.wechatQrFile)), type: member.wechatQrFile.endsWith('.png') ? 'image/png' : 'image/jpeg' }
    } catch { fail('NOT_FOUND', '微信二维码不存在', 404) }
  }
}
