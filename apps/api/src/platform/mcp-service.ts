import { Injectable } from '@nestjs/common'
import { randomUUID } from 'node:crypto'
import { count, desc, eq } from 'drizzle-orm'
import type { AdminTransaction } from '../admin/service.js'
import { mcpOptionalFields, platformMcpAudit, platformMcpPartners, type McpPartnerSnapshot, type McpPermission } from '../database/schema/platform-mcp.js'
import { fail } from '../flow/common.js'
import type { PageQuery } from '../flow/pagination.js'
import type { CreateMcpPartnerInput, McpAuditPageDto, McpPartnerPageDto, McpStatusDto, UpdateMcpPartnerInput } from './mcp-dto.js'

type Actor = { id: string; displayName: string }

function permission(value: McpPermission): McpPermission {
  return { enabled: value.enabled, fields: value.enabled ? mcpOptionalFields.filter(field => value.fields.includes(field)) : [] }
}

function snapshot(row: McpPartnerSnapshot): McpPartnerSnapshot {
  const { id, name, remark, enabled, search, detail, version } = row
  return { id, name, remark, enabled, search: permission(search), detail: permission(detail), version }
}

@Injectable()
export class McpSettingsService {
  async status(): Promise<McpStatusDto> { return { enabled: false, ready: false } }

  async partners(tx: AdminTransaction, page: PageQuery): Promise<McpPartnerPageDto> {
    const [{ value: total } = { value: 0 }] = await tx.select({ value: count() }).from(platformMcpPartners)
    const rows = await tx.select().from(platformMcpPartners).orderBy(desc(platformMcpPartners.createdAt), desc(platformMcpPartners.id)).limit(page.limit).offset(page.offset)
    return { items: rows.map(snapshot), total, hasMore: page.offset + rows.length < total }
  }

  async audit(tx: AdminTransaction, page: PageQuery): Promise<McpAuditPageDto> {
    const [{ value: total } = { value: 0 }] = await tx.select({ value: count() }).from(platformMcpAudit)
    const rows = await tx.select().from(platformMcpAudit).orderBy(desc(platformMcpAudit.createdAt), desc(platformMcpAudit.id)).limit(page.limit).offset(page.offset)
    return { items: rows.map(row => ({
      id: row.id, actorName: row.actorName, partnerName: row.after.name, createdAt: row.createdAt.toISOString(),
      before: row.before ? snapshot(row.before) : null, after: snapshot(row.after),
    })), total, hasMore: page.offset + rows.length < total }
  }

  async create(tx: AdminTransaction, input: CreateMcpPartnerInput, actor: Actor): Promise<McpPartnerSnapshot> {
    const after = snapshot({ id: randomUUID(), name: input.name, remark: input.remark, enabled: false, version: 1,
      search: { enabled: false, fields: [] }, detail: { enabled: false, fields: [] } })
    await tx.insert(platformMcpPartners).values(after)
    await this.record(tx, actor, null, after)
    return after
  }

  async update(tx: AdminTransaction, id: string, input: UpdateMcpPartnerInput, actor: Actor): Promise<McpPartnerSnapshot> {
    const [row] = await tx.select().from(platformMcpPartners).where(eq(platformMcpPartners.id, id)).for('update')
    if (!row) fail('MCP_PARTNER_NOT_FOUND', '找不到该对接方', 404)
    if (row.version !== input.version) fail('MCP_PARTNER_VERSION_CONFLICT', '配置已变更，请重新加载后再保存', 409)
    const before = snapshot(row)
    const next = snapshot({ id, ...input })
    if (JSON.stringify(before) === JSON.stringify(next)) return before
    const after = { ...next, version: next.version + 1 }
    const { name, remark, enabled, search, detail, version } = after
    await tx.update(platformMcpPartners).set({ name, remark, enabled, search, detail, version }).where(eq(platformMcpPartners.id, id))
    await this.record(tx, actor, before, after)
    return after
  }

  private async record(tx: AdminTransaction, actor: Actor, before: McpPartnerSnapshot | null, after: McpPartnerSnapshot) {
    await tx.insert(platformMcpAudit).values({ id: randomUUID(), actorId: actor.id, actorName: actor.displayName, before, after })
  }
}
