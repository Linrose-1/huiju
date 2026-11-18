import { readFileSync } from 'node:fs'
import ts from 'typescript'
import * as vue from 'vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AdminRequestError, isSuperAdmin, session } from '../src/services/admin'
import { allowedRoute } from '../src/services/access'
import type { McpPartner, McpPartnerInput } from '../src/services/mcp'
import { useRequestScope } from '../src/services/request-scope'

const scopes: vue.EffectScope[] = []
beforeEach(() => {
  session.epoch++
  session.account = { id: 'admin', role: 'super_admin', username: 'admin', displayName: '管理员', active: true, mustChangePassword: false, createdAt: '' }
})
afterEach(() => { scopes.splice(0).forEach(scope => scope.stop()) })

const partner: McpPartner = {
  id: 'partner', name: '合作平台', remark: '', enabled: false, version: 1,
  search: { enabled: true, fields: ['location'] }, detail: { enabled: false, fields: [] },
}
const firstPage = { items: [partner], hasMore: true, total: 21 }
function fixture() {
  const api = {
    status: vi.fn(async () => ({ enabled: false, ready: false })),
    partners: vi.fn<(offset: number) => Promise<typeof firstPage>>(async () => firstPage),
    audit: vi.fn(async () => ({ items: [], hasMore: false, total: 0 })),
    create: vi.fn(async () => partner),
    update: vi.fn(async () => partner),
  }
  const success = vi.fn()
  const source = readFileSync(new URL('../src/modules/mcp/McpSettingsPage.vue', import.meta.url), 'utf8').match(/<script setup lang="ts">([\s\S]*?)<\/script>/)![1]
  const code = ts.transpileModule(source + '\nexport { loadStatus, loadPartners, open, closeDrawer, save, form, drawer, saving, conflict, changes, formError, partnerOffset, partners };',
    { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText
  const deps: Record<string, unknown> = {
    vue: { ...vue, onMounted() {} }, 'element-plus': { ElMessage: { success } },
    '../../services/admin': { AdminRequestError, isSuperAdmin, errorMessage: (e: Error) => e.message },
    '../../services/mcp': { mcpApi: api, mcpPageSize: 20 }, '../../services/request-scope': { useRequestScope },
  }
  const exports = {}, scope = vue.effectScope(); scopes.push(scope)
  scope.run(() => new Function('require', 'exports', code)((name: string) => deps[name], exports))
  const page = exports as {
    loadStatus(): Promise<void>; loadPartners(offset?: number): Promise<void>
    open(partner: McpPartner | null): void; closeDrawer(): void; save(): Promise<void>
    form: vue.Ref<McpPartnerInput>; drawer: vue.Ref<boolean>; saving: vue.Ref<boolean>; conflict: vue.Ref<boolean>
    changes: vue.ComputedRef<string[]>; formError: vue.Ref<string>; partnerOffset: vue.Ref<number>; partners: vue.Ref<typeof firstPage>
  }
  return { api, page, scope, success }
}
describe('MCP settings admin', () => {
  it('blocks operator navigation and direct page requests', async () => {
    expect(allowedRoute('/mcp-settings')).toBeUndefined()
    session.account!.role = 'operator'
    expect(allowedRoute('/mcp-settings')).toBe('/analytics')
    const h = fixture()
    await h.page.loadStatus(); await h.page.loadPartners()
    h.page.open(null); await h.page.save()
    expect(h.api.status).not.toHaveBeenCalled()
    expect(h.api.partners).not.toHaveBeenCalled()
    expect(h.api.create).not.toHaveBeenCalled()
  })
  it('creates a partner without activation or grants, then reloads both lists', async () => {
    const h = fixture()
    await h.page.loadStatus()
    h.page.open(null); h.page.form.value.name = '  合作平台  '
    expect(h.page.form.value.enabled).toBe(false)
    expect(h.page.form.value.search).toEqual({ enabled: false, fields: [] })
    await h.page.save()
    expect(h.api.create).toHaveBeenCalledWith({ name: '合作平台', remark: '' })
    expect(h.api.partners).toHaveBeenCalledWith(0)
    expect(h.api.audit).toHaveBeenCalledWith(0)
    expect(h.page.drawer.value).toBe(false)
  })
  it('keeps search and detail independent, with no grants on disabled capabilities, and cancel leaves the source intact', async () => {
    const h = fixture(); await h.page.loadStatus()
    h.page.open(partner)
    h.page.form.value.search.fields.push('description')
    h.page.closeDrawer()
    expect(partner.search.fields).toEqual(['location'])
    expect(h.api.update).not.toHaveBeenCalled()
    h.page.open(partner)
    h.page.form.value.search.enabled = false
    h.page.form.value.detail = { enabled: true, fields: ['cover'] }
    expect(h.page.changes.value).toEqual(['搜索公开活动：未授权', '查看公开活动详情：基础字段、封面'])
    await h.page.save()
    expect(h.api.update).toHaveBeenCalledWith(partner.id, expect.objectContaining({
      version: 1, search: { enabled: false, fields: [] }, detail: { enabled: true, fields: ['cover'] },
    }))
  })
  it('locks repeated saves and keeps unsaved changes when the server reports a version conflict', async () => {
    const h = fixture(); await h.page.loadStatus()
    h.page.open(partner); h.page.form.value.name = '修改'
    let reject!: (failure: Error) => void
    h.api.update.mockImplementation(() => new Promise((_resolve, fail) => { reject = fail }))
    const pending = h.page.save()
    h.page.closeDrawer(); await h.page.save()
    expect(h.page.drawer.value).toBe(true)
    expect(h.api.update).toHaveBeenCalledTimes(1)
    reject(new AdminRequestError(409, 'MCP_PARTNER_VERSION_CONFLICT', '冲突')); await pending
    expect(h.page.conflict.value).toBe(true)
    expect(h.page.form.value.name).toBe('修改')
    expect(h.page.formError.value).toContain('重新读取')
    expect(h.api.audit).not.toHaveBeenCalled()
    expect(h.success).not.toHaveBeenCalled()
  })
  it('preserves the current page and retries the requested page after a load failure', async () => {
    const h = fixture(); await h.page.loadPartners(0)
    h.api.partners.mockRejectedValueOnce(new Error('网络不通'))
    await h.page.loadPartners(20)
    expect(h.page.partnerOffset.value).toBe(0)
    expect(h.page.partners.value.items).toEqual([partner])
    h.api.partners.mockResolvedValueOnce({ items: [], hasMore: false, total: 21 })
    await h.page.loadPartners()
    expect(h.api.partners).toHaveBeenLastCalledWith(20)
    expect(h.page.partnerOffset.value).toBe(20)
  })
})
