import { Injectable } from '@nestjs/common'
import { and, eq } from 'drizzle-orm'
import { members, memberVisibilities } from '../database/schema/members.js'
import { fail, FlowDatabase } from './common.js'
import { complete, IdentityService, type Member } from './identity.js'
import { CardSettingsDto, MemberCardDto, ProfileDetailsDto, ProfileDetailsInput } from './member-card-dto.js'

const fields = ['realName', 'email', 'hometown', 'bio', 'resources', 'needs'] as const
const visibilityFields = {
  showRealName: 'realName', showEmail: 'email', showBoundPhone: 'boundPhone',
  showHometown: 'hometown', showBio: 'bio', showResources: 'resources', showNeeds: 'needs',
} as const

export function cardSettings(row?: Partial<CardSettingsDto>): CardSettingsDto {
  return Object.fromEntries(Object.keys(visibilityFields).map(key => [key, row?.[key as keyof CardSettingsDto] === true])) as unknown as CardSettingsDto
}

export function publicCard(member: Member, settings: CardSettingsDto): MemberCardDto {
  const card: MemberCardDto = {
    avatarUrl: complete(member) ? member.avatarUrl : null,
    displayName: complete(member) ? member.displayName! : `会员${member.memberNumber}`,
  }
  for (const [setting, field] of Object.entries(visibilityFields)) {
    if (settings[setting as keyof CardSettingsDto]) card[field] = member[field]
  }
  return card
}

@Injectable()
export class MemberCardService {
  constructor(private readonly database: FlowDatabase, private readonly identity: IdentityService) {}

  async profile(header?: string): Promise<ProfileDetailsDto> {
    const member = (await this.identity.require(header))!
    return Object.fromEntries(fields.map(field => [field, member[field]])) as unknown as ProfileDetailsDto
  }

  async saveProfile(input: ProfileDetailsInput, header?: string): Promise<ProfileDetailsDto> {
    const member = (await this.identity.require(header))!
    const values = Object.fromEntries(fields.map(field => [field, input[field].trim() || null])) as unknown as ProfileDetailsDto
    await this.database.db.update(members).set(values).where(eq(members.id, member.id))
    return values
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
    const values = cardSettings(input)
    await this.database.db.insert(memberVisibilities).values({ memberId: member.id, ...values }).onDuplicateKeyUpdate({ set: values })
    return values
  }

  async card(id: string, header?: string): Promise<MemberCardDto> {
    const caller = (await this.identity.require(header))!
    if (!complete(caller)) fail('PROFILE_INCOMPLETE', '请先完善手机号、头像和用户名称', 403)
    const [member] = await this.database.db.select().from(members).where(and(eq(members.id, id), eq(members.kind, 'member'))).limit(1)
    if (!member) fail('NOT_FOUND', '会员名片不存在', 404)
    return publicCard(member, await this.settingsFor(id))
  }
}
