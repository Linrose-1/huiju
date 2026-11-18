import type { paths } from '../../../../packages/api-client/src/generated'
import { client, options, session, unwrap } from './admin'

type PartnerList = paths['/api/v1/admin/platform/mcp/partners']['get']
type PartnerCreate = paths['/api/v1/admin/platform/mcp/partners']['post']
type PartnerUpdate = paths['/api/v1/admin/platform/mcp/partners/{id}']['put']
type AuditList = paths['/api/v1/admin/platform/mcp/audit']['get']

export type McpStatus = paths['/api/v1/admin/platform/mcp']['get']['responses'][200]['content']['application/json']
export type McpPartner = PartnerList['responses'][200]['content']['application/json']['items'][number]
export type McpAudit = AuditList['responses'][200]['content']['application/json']['items'][number]
export type McpPartnerInput = PartnerUpdate['requestBody']['content']['application/json']
export type McpField = McpPartnerInput['search']['fields'][number]
type McpPartnerCreate = PartnerCreate['requestBody']['content']['application/json']

export const mcpPageSize = 20
const csrf = () => ({ 'X-CSRF-Token': session.csrfToken })
export const mcpApi = {
  status: () => unwrap(client.GET('/api/v1/admin/platform/mcp', options())),
  partners: (offset: number) => unwrap(client.GET('/api/v1/admin/platform/mcp/partners', { ...options(), params: { query: { offset, limit: mcpPageSize } } })),
  audit: (offset: number) => unwrap(client.GET('/api/v1/admin/platform/mcp/audit', { ...options(), params: { query: { offset, limit: mcpPageSize } } })),
  create: (body: McpPartnerCreate) => unwrap(client.POST('/api/v1/admin/platform/mcp/partners', { ...options(), params: { header: csrf() }, body })),
  update: (id: string, body: McpPartnerInput) => unwrap(client.PUT('/api/v1/admin/platform/mcp/partners/{id}', {
    ...options(), params: { path: { id }, header: csrf() }, body,
  })),
}
