import { Injectable } from '@nestjs/common'
import {
  and,
  desc,
  eq,
  gt,
  isNull,
  like,
  or,
  sql
} from 'drizzle-orm'
import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import sharp from 'sharp'
import { members, memberSessions, memberVisibilities, wechatIdentities } from '../database/schema/members.js'
import { fail, FlowDatabase } from './common.js'
import { memberNumberPrefix, nextMemberNumber, memberInviteCode, inviteMemberNumber } from './member-number.js'
import { WechatAdapter } from './wechat.js'
import { AvatarInput, MemberDto } from './dto.js'
import { LEGAL_VERSION, recordLegalConsent, requireLegalConsent } from '../platform/legal.js'
import { legalConsents } from '../database/schema/platform.js'
export type Member = typeof members.$inferSelect

export function complete(member: Member) {
  return Boolean(member.boundPhone && member.avatarUrl && member.displayName?.trim()
    && member.avatarSetByUser
    && member.nameSetByUser)
}

export function memberDto(member: Member): MemberDto {
  return {
    id: member.id,
    memberNumber: member.memberNumber,
    inviteCode: memberInviteCode(member.memberNumber, member.inviteCode),
    displayName: member.displayName,
    avatarUrl: member.avatarUrl,
    boundPhone: member.boundPhone,
    profileComplete: complete(member)
  }
}

export function tokenHash(token: string) {
  return createHash('sha256').update(token).digest('hex')
}

export async function validAvatar(input: AvatarInput) {
  const bytes = Buffer.from(input.base64, 'base64')
  if (bytes.length < 24 || bytes.length > 2 * 1024 * 1024
    || !['image/png', 'image/jpeg'].includes(input.mimeType)) {
    fail('INVALID_IMAGE', '请选择 2MB 以内的 PNG 或 JPG 图片')
  }
  try {
    // Bound decoded memory as well as upload size; metadata alone cannot detect damaged pixels.
    const image = sharp(bytes, { failOn: 'warning', limitInputPixels: 4096 * 4096 })
    const metadata = await image.metadata()
    if (`image/${metadata.format}` !== input.mimeType) {
      throw new Error('Image format mismatch')
    }
    await image.raw().toBuffer()
  }
  catch {
    fail('INVALID_IMAGE', '请选择有效且不超过 1677 万像素、2MB 的 PNG 或 JPG 图片')
  }
  return bytes
}

@Injectable()
export class IdentityService {
  protected sessionHash(token: string) { return tokenHash(token) }

  constructor(
    private readonly database: FlowDatabase,
    private readonly wechat: WechatAdapter
  ) {}

  async identify(code: string, inviteCode?: string) {
    return this.establishSession(code, inviteCode)
  }

  async login(code: string, inviteCode?: string, consent?: { termsVersion: string; privacyVersion: string }) {
    requireLegalConsent(consent)
    return this.establishSession(code, inviteCode, consent)
  }

  private async establishSession(code: string, inviteCode?: string, consent?: { termsVersion: string; privacyVersion: string }) {
    const identity = await this.wechat.exchange(code)
    const db = this.database.db
    const find = async () => (await db
      .select({ memberId: wechatIdentities.memberId })
      .from(wechatIdentities)
      .where(and(eq(wechatIdentities.appId, identity.appId), eq(wechatIdentities.openId, identity.openId)))
      .limit(1))[0]
    let existing = await find()
    let registered = false
    if (!existing) {
      try {
        existing = await db.transaction(async (tx) => {
          const root = (await tx
            .select()
            .from(members)
            .where(eq(members.kind, 'platform_root'))
            .limit(1).for('update'))[0]
          if (!root) {
            fail('PLATFORM_NOT_READY', '平台身份尚未初始化，请联系运营人员', 503)
          }
          const inviteNumber = inviteCode ? inviteMemberNumber(inviteCode) : null
          const inviter = inviteCode ? (await tx
            .select()
            .from(members)
            .where(and(inviteNumber ? or(eq(members.memberNumber, inviteNumber), eq(members.inviteCode, inviteCode)) : eq(members.inviteCode, inviteCode), eq(members.kind, 'member')))
            .limit(1))[0] : undefined
          // Serialize number allocation across API processes using the existing root row.
          // Locking reads see the latest committed number even under REPEATABLE READ.
          const createdAt = new Date()
          const prefix = memberNumberPrefix(createdAt)
          const [latest] = await tx.select({ number: members.memberNumber }).from(members)
            .where(and(like(members.memberNumber, prefix + '%'), sql`${members.memberNumber} regexp ${'^' + prefix + '[0-9]{6}$'}`))
            .orderBy(desc(members.memberNumber)).limit(1).for('update')
          const memberNumber = nextMemberNumber(prefix, latest?.number)
          const id = randomUUID()
          await tx
            .insert(members)
            .values({
              id,
              memberNumber,
              createdAt,
              inviteCode: memberInviteCode(memberNumber, ''),
              inviterMemberId: inviter?.id ?? root.id
            })
          await tx
            .insert(wechatIdentities)
            .values({
              id: randomUUID(),
              memberId: id,
              ...identity
            })
          await tx
            .insert(memberVisibilities)
            .values({ memberId: id })
          if (consent) await recordLegalConsent(tx, id, consent)
          return { memberId: id }
        })
        registered = true
      } catch (error) {
        // The unique WeChat identity wins a concurrent first login. Read that
        // committed member instead of creating or rewriting an invitation.
        existing = await find()
        if (!existing) {
          throw error
        }
      }
    }
    const ttl = Number(process.env.MEMBER_SESSION_TTL_SECONDS ?? 604800)
    const maximum = Number(process.env.MEMBER_SESSION_MAX_ACTIVE ?? 5)
    if (!Number.isInteger(ttl) || ttl < 60 || ttl > 2592000
      || !Number.isInteger(maximum)
      || maximum < 1
      || maximum > 20) {
      fail('SERVICE_UNAVAILABLE', '会话配置不可用', 503)
    }
    const token = randomBytes(32).toString('base64url')
    const expiresAt = new Date(Date.now() + ttl * 1000)
    const member = await db.transaction(async (tx) => {
      const [owner] = await tx
        .select()
        .from(members)
        .where(eq(members.id, existing.memberId))
        .for('update')
      const current = await tx
        .select()
        .from(memberSessions)
        .where(and(eq(memberSessions.memberId, owner.id), isNull(memberSessions.revokedAt), gt(memberSessions.expiresAt, new Date())))
        .orderBy(desc(memberSessions.createdAt))
      for (const old of current.slice(maximum - 1))
        await tx
          .update(memberSessions)
          .set({ revokedAt: new Date() })
          .where(eq(memberSessions.id, old.id))
      await tx
        .insert(memberSessions)
        .values({
          id: randomUUID(),
          memberId: owner.id,
          tokenHash: this.sessionHash(token),
          expiresAt
        })
      if (!registered && consent) await recordLegalConsent(tx, owner.id, consent)
      return owner
    })
    return {
      token,
      expiresAt: expiresAt.toISOString(),
      member: memberDto(member)
    }
  }

  async require(header?: string, optional = false) {
    if (!header && optional) {
      return undefined
    }
    if (!header?.match(/^Bearer [A-Za-z0-9_-]{43}$/)) {
      fail('SESSION_REQUIRED', '请先登录', 401)
    }
    const [row] = await this.database.db
      .select({ member: members })
      .from(memberSessions)
      .innerJoin(members, eq(members.id, memberSessions.memberId))
      .where(and(eq(memberSessions.tokenHash, this.sessionHash(header.slice(7))), isNull(memberSessions.revokedAt), gt(memberSessions.expiresAt, new Date()), eq(members.kind, 'member')))
      .limit(1)
    if (!row) {
      fail('SESSION_REQUIRED', '登录已失效，请重新登录', 401)
    }
    return row.member
  }

  async me(header?: string) { return memberDto((await this.require(header))!) }

  async recommendationProfile(memberId: string) {
    const [profile] = await this.database.db.select({ resources: members.resources, needs: members.needs, hometown: members.hometown, bio: members.bio })
      .from(members).where(eq(members.id, memberId))
    return profile ?? { resources: null, needs: null, hometown: null, bio: null }
  }

  async logout(header?: string) {
    await this.require(header)
    await this.database.db
      .update(memberSessions)
      .set({ revokedAt: new Date() })
      .where(eq(memberSessions.tokenHash, this.sessionHash(header!.slice(7))))
    return { ok: true }
  }

  private async requireProfileConsent(header: string | undefined) {
    const member = (await this.require(header))!
    const [consent] = await this.database.db.select({ id: legalConsents.id }).from(legalConsents)
      .where(and(eq(legalConsents.memberId, member.id), eq(legalConsents.termsVersion, LEGAL_VERSION), eq(legalConsents.privacyVersion, LEGAL_VERSION)))
      .limit(1)
    if (!consent) fail('LEGAL_CONSENT_REQUIRED', '请阅读并同意当前版本的用户协议和隐私政策后完善资料', 403)
    return member
  }

  async profile(header: string | undefined, displayName: string) {
    const member = await this.requireProfileConsent(header)
    await this.database.db
      .update(members)
      .set({
        displayName: displayName.trim(),
        nameSetByUser: true
      })
      .where(eq(members.id, member.id))
    return this.me(header)
  }

  async phone(header: string | undefined, code: string) {
    const member = await this.requireProfileConsent(header)
    if (member.boundPhone) {
      fail('PHONE_ALREADY_BOUND', '手机号已绑定，首期暂不支持修改', 409)
    }
    const phone = await this.wechat.phone(code)
    await this.database.db.transaction(async (tx) => {
      const [current] = await tx
        .select()
        .from(members)
        .where(eq(members.id, member.id))
        .for('update')
      if (current.boundPhone) {
        fail('PHONE_ALREADY_BOUND', '手机号已绑定，首期暂不支持修改', 409)
      }
      await tx
        .update(members)
        .set({ boundPhone: phone })
        .where(eq(members.id, member.id))
    })
    return this.me(header)
  }

  private directory() { return resolve(process.env.LOCAL_AVATAR_DIRECTORY ?? '.local-uploads/avatars') }

  async avatar(header: string | undefined, input: AvatarInput) {
    const member = await this.requireProfileConsent(header)
    const bytes = await validAvatar(input)
    const name = `${randomUUID()}.${input.mimeType === 'image/png' ? 'png' : 'jpg'}`
    await mkdir(this.directory(), { recursive: true })
    await writeFile(resolve(this.directory(), name), bytes, { flag: 'wx' })
    await this.database.db
      .update(members)
      .set({
        avatarUrl: `/api/v1/media/avatars/${name}`,
        avatarSetByUser: true
      })
      .where(eq(members.id, member.id))
    return this.me(header)
  }

  async image(name: string) {
    if (!/^[a-f0-9-]{36}\.(png|jpg)$/.test(name)) {
      fail('NOT_FOUND', '图片不存在', 404)
    }
    try {
      return await readFile(resolve(this.directory(), name))
    }
    catch {
      fail('NOT_FOUND', '图片不存在', 404)
    }
  }
}
