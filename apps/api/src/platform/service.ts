import { Injectable } from '@nestjs/common'
import { and, desc, eq, inArray } from 'drizzle-orm'
import { randomUUID } from 'node:crypto'
import { AdminTransaction } from '../admin/service.js'
import { adminAccounts, members } from '../database/schema/members.js'
import { platformAudit, platformContent, platformEditors } from '../database/schema/platform.js'
import { fail, FlowDatabase } from '../flow/common.js'
import { complete, IdentityService } from '../flow/identity.js'
import { PageQuery } from '../flow/pagination.js'
import { ContentInput } from './dto.js'
import { recordLegalConsent, requireLegalConsent } from './legal.js'

export const defaultContent = { activityText: '连接资产运营人才，共建共享“学加”学友生态', assistantText: '“学加”活动智能助手' }
export function cleanContent(input: ContentInput) {
  const result = { activityText: input.activityText.trim(), assistantText: input.assistantText.trim() }
  if (Object.values(result).some(value => !value || value.length > 200)) fail('INVALID_CONTENT', '文案须为1至200字', 400)
  return result
}
@Injectable()
export class PlatformService {
  constructor(private readonly database: FlowDatabase, private readonly identity: IdentityService) {}

  async content(tx: AdminTransaction | FlowDatabase['db'] = this.database.db) {
    const [row] = await tx.select().from(platformContent).where(eq(platformContent.id, 'main')).limit(1)
    return row ? { activityText: row.activityText, assistantText: row.assistantText } : { ...defaultContent }
  }
  async publicContent(header?: string) {
    const member = await this.identity.require(header, true)
    const [editor] = member ? await this.database.db.select().from(platformEditors).where(eq(platformEditors.memberId, member.id)).limit(1) : []
    return { ...await this.content(), canEdit: !!member && complete(member) && editor?.enabled === true }
  }
  async saveContent(tx: AdminTransaction, input: ContentInput, actor: { type: 'member' | 'admin'; id: string }) {
    const after = cleanContent(input)
    // A stable singleton lock prevents lost audit snapshots on concurrent saves.
    await tx.insert(platformContent).values({ id: 'main', ...defaultContent }).onDuplicateKeyUpdate({ set: { id: 'main' } })
    const [row] = await tx.select().from(platformContent).where(eq(platformContent.id, 'main')).for('update')
    const before = { activityText: row.activityText, assistantText: row.assistantText }
    await tx.update(platformContent).set(after).where(eq(platformContent.id, 'main'))
    await tx.insert(platformAudit).values({ id: randomUUID(), actorType: actor.type, actorId: actor.id, action: 'content', before, after })
    return { ...after, canEdit: true }
  }
  async saveMemberContent(header: string | undefined, input: ContentInput) {
    const member = (await this.identity.require(header))!
    if (!complete(member)) fail('PROFILE_INCOMPLETE', '请先完善手机号、头像和用户名称', 403)
    return this.database.db.transaction(async tx => {
      const [editor] = await tx.select().from(platformEditors).where(eq(platformEditors.memberId, member.id)).for('update')
      if (!editor?.enabled) fail('CONTENT_EDITOR_REQUIRED', '尚未获得运营文案编辑权限', 403)
      return this.saveContent(tx, input, { type: 'member', id: member.id })
    })
  }
  async editors(tx: AdminTransaction, query: PageQuery) {
    const rows = await tx.select({ memberId: members.id, memberNumber: members.memberNumber, displayName: members.displayName, enabled: platformEditors.enabled })
      .from(platformEditors).innerJoin(members, eq(platformEditors.memberId, members.id))
      .where(and(eq(members.kind, 'member'), eq(platformEditors.enabled, true)))
      .orderBy(desc(platformEditors.updatedAt), members.id).offset(query.offset).limit(query.limit + 1)
    return { items: rows.slice(0, query.limit), hasMore: rows.length > query.limit }
  }
  async setEditor(tx: AdminTransaction, memberId: string, enabled: boolean, actorId: string) {
    const [member] = await tx.select({ id: members.id }).from(members).where(and(eq(members.id, memberId), eq(members.kind, 'member'))).limit(1)
    if (!member) fail('MEMBER_NOT_FOUND', '会员不存在', 404)
    // Retain revoked rows so privilege changes and member edits lock the same row.
    await tx.insert(platformEditors).values({ memberId, enabled: false }).onDuplicateKeyUpdate({ set: { memberId } })
    const [previous] = await tx.select().from(platformEditors).where(eq(platformEditors.memberId, memberId)).for('update')
    await tx.update(platformEditors).set({ enabled, updatedAt: new Date() }).where(eq(platformEditors.memberId, memberId))
    await tx.insert(platformAudit).values({ id: randomUUID(), actorType: 'admin', actorId, action: 'editor', targetMemberId: memberId, before: { enabled: previous.enabled }, after: { enabled } })
    return { ok: true }
  }
  async history(tx: AdminTransaction, query: PageQuery) {
    const rows = await tx.select().from(platformAudit).orderBy(desc(platformAudit.createdAt), desc(platformAudit.id)).offset(query.offset).limit(query.limit + 1)
    const page = rows.slice(0, query.limit)
    const adminIds = [...new Set(page.filter(row => row.actorType === 'admin').map(row => row.actorId))]
    const memberIds = [...new Set(page.flatMap(row => [...(row.actorType === 'member' ? [row.actorId] : []), ...(row.targetMemberId ? [row.targetMemberId] : [])]))]
    const admins = adminIds.length ? await tx.select({ id: adminAccounts.id, name: adminAccounts.displayName }).from(adminAccounts).where(inArray(adminAccounts.id, adminIds)) : []
    const people = memberIds.length ? await tx.select({ id: members.id, name: members.displayName, number: members.memberNumber }).from(members).where(inArray(members.id, memberIds)) : []
    const adminNames = new Map(admins.map(row => [row.id, row.name]))
    const memberNames = new Map(people.map(row => [row.id, row.name?.trim() || row.number]))
    const memberNumbers = new Map(people.map(row => [row.id, row.number]))
    return { items: page.map(row => ({ ...row,
      actorName: (row.actorType === 'admin' ? adminNames.get(row.actorId) : memberNames.get(row.actorId)) || '历史账号',
      targetMemberNumber: row.targetMemberId ? memberNumbers.get(row.targetMemberId) ?? null : null,
      createdAt: row.createdAt.toISOString(),
    })), hasMore: rows.length > query.limit }
  }
  async accept(header: string | undefined, consent: { termsVersion: string; privacyVersion: string }) {
    requireLegalConsent(consent)
    const member = (await this.identity.require(header))!
    await this.database.db.transaction(tx => recordLegalConsent(tx, member.id, consent))
    return { ok: true }
  }
}
