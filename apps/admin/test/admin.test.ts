import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { effectScope } from 'vue'

const OriginalRequest = globalThis.Request
let network = vi.fn<typeof fetch>()
type AdminModule = typeof import('../src/services/admin')
let admin: AdminModule
const account = { id: 'admin-one', username: 'operator', displayName: '运营', role: 'operator' as const, active: true, mustChangePassword: false, createdAt: '2026-09-28T00:00:00.000Z' }
function response(data: unknown, status = 200) { return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } }) }
function authenticated() { admin.session.account = { ...account }; admin.session.csrfToken = 'test-csrf' }
beforeEach(async () => {
  vi.resetModules()
  network = vi.fn<typeof fetch>()
  vi.stubGlobal('fetch', network)
  vi.stubGlobal('Request', class extends OriginalRequest {
    constructor(input: RequestInfo | URL, options?: RequestInit) {
      super(typeof input === 'string' && input.startsWith('/') ? `http://localhost${input}` : input, options)
    }
  })
  admin = await import('../src/services/admin')
})
afterEach(() => { vi.unstubAllGlobals() })

describe('admin session and transport', () => {
  it('uses the existing paginated circle contract and rejects forbidden moderation', async () => {
    authenticated()
    network.mockResolvedValueOnce(response({ items: [], hasMore: false }))
    await admin.adminApi.circlePosts('park', 20)
    const list = network.mock.calls[0]![0] as Request
    expect(list.credentials).toBe('include')
    expect(new URL(list.url).pathname).toBe('/api/v1/admin/circle/posts')
    expect(new URL(list.url).searchParams.get('category')).toBe('park')
    expect(new URL(list.url).searchParams.get('offset')).toBe('20')
    expect(new URL(list.url).searchParams.get('limit')).toBe('20')
    network.mockResolvedValueOnce(response({ items: [], hasMore: false }))
    await admin.adminApi.circleOperations('post-id', 40)
    expect((network.mock.calls[1]![0] as Request).url).toContain('/post-id/operations?offset=40&limit=20')
    for (const action of ['removeCirclePost', 'restoreCirclePost'] as const) {
      network.mockResolvedValueOnce(response({ ok: true }))
      await admin.adminApi[action]('post-id', '核对原因')
      const request = network.mock.calls.at(-1)![0] as Request
      expect(request.method).toBe('POST')
      expect(request.credentials).toBe('include')
      expect(request.headers.get('X-CSRF-Token')).toBe('test-csrf')
      expect(new URL(request.url).pathname).toBe(`/api/v1/admin/circle/posts/post-id/${action === 'removeCirclePost' ? 'remove' : 'restore'}`)
      expect(await request.json()).toEqual({ reason: '核对原因' })
    }
    network.mockResolvedValueOnce(response({ code: 'ADMIN_FORBIDDEN' }, 403))
    await expect(admin.adminApi.removeCirclePost('post-id', '原因')).rejects.toThrow('没有执行此操作')
  })
  it('uses cookie and CSRF for content edits and editor authorization, and handles forbidden writes', async () => {
    authenticated()
    network.mockResolvedValueOnce(response({ activityText: '活动文案', assistantText: '助手文案', canEdit: true }))
    await admin.adminApi.saveContent({ activityText: '活动文案', assistantText: '助手文案' })
    const contentRequest = network.mock.calls[0]![0] as Request
    expect(contentRequest.method).toBe('PATCH')
    expect(contentRequest.headers.get('X-CSRF-Token')).toBe('test-csrf')
    expect(contentRequest.credentials).toBe('include')
    expect(await contentRequest.json()).toEqual({ activityText: '活动文案', assistantText: '助手文案' })
    network.mockResolvedValueOnce(response({ code: 'ADMIN_FORBIDDEN' }, 403))
    await expect(admin.adminApi.setContentEditor('member-id', true)).rejects.toThrow('没有执行此操作')
    const editorRequest = network.mock.calls[1]![0] as Request
    expect(editorRequest.method).toBe('PUT')
    expect(editorRequest.headers.get('X-CSRF-Token')).toBe('test-csrf')
    expect(await editorRequest.json()).toEqual({ enabled: true })
  })
  it('exports the complete applied engagement filter as text rather than parsing CSV as JSON', async () => {
    authenticated()
    network.mockResolvedValue(new Response('会员编号,浏览次数\r\nHJ0001,2', { headers: { 'Content-Type': 'text/csv' } }))
    const csv = await admin.adminApi.exportEngagement({ days: 7, behavior: 'browse', profile: 'complete', offset: 0 })
    expect(csv).toContain('HJ0001,2')
    const request = network.mock.calls[0]![0] as Request
    expect(request.credentials).toBe('include')
    const url = new URL(request.url)
    expect(url.pathname).toBe('/api/v1/admin/analytics/export')
    expect(url.searchParams.get('behavior')).toBe('browse')
    expect(url.searchParams.get('profile')).toBe('complete')
    expect(url.searchParams.get('days')).toBe('7')
  })
  it('pages activity moderation and history with encoded filters', async () => {
    authenticated()
    network.mockImplementation(async () => response({ items: [], total: 0, hasMore: false }))
    await admin.adminApi.activities({ status: 'removed', q: '活动 & 学友', offset: 20 })
    const request = network.mock.calls[0]![0] as Request
    const url = new URL(request.url)
    expect(url.pathname).toBe('/api/v1/admin/activities')
    expect(url.searchParams.get('q')).toBe('活动 & 学友')
    expect(url.searchParams.get('status')).toBe('removed')
    expect(url.searchParams.get('offset')).toBe('20')
    expect(request.credentials).toBe('include')
    await admin.adminApi.activityOperations('activity-id', 40)
    expect((network.mock.calls[1]![0] as Request).url).toContain('/activity-id/operations?offset=40')
  })
  it.each(['removeActivity', 'restoreActivity'] as const)('sends only reason with cookie and CSRF for %s', async action => {
    authenticated()
    network.mockResolvedValue(response({ ok: true }))
    await admin.adminApi[action]('activity-id', '审核原因')
    const request = network.mock.calls[0]![0] as Request
    expect(request.method).toBe('POST')
    expect(request.credentials).toBe('include')
    expect(request.headers.get('X-CSRF-Token')).toBe('test-csrf')
    expect(new URL(request.url).pathname).toBe(`/api/v1/admin/activities/activity-id/${action === 'removeActivity' ? 'remove' : 'restore'}`)
    expect(await request.json()).toEqual({ reason: '审核原因' })
  })
  it('sends member filters and paging with cookies and discards late private details after logout', async () => {
    authenticated()
    network.mockResolvedValueOnce(response({ items: [], total: 0, hasMore: false }))
    await admin.adminApi.members({ q: '张 & 李', profile: 'incomplete', offset: 40, inviterId: 'member-id' })
    const request = network.mock.calls[0]![0] as Request
    const url = new URL(request.url)
    expect(url.searchParams.get('q')).toBe('张 & 李')
    expect(url.searchParams.get('profile')).toBe('incomplete')
    expect(url.searchParams.get('offset')).toBe('40')
    expect(url.searchParams.get('inviterId')).toBe('member-id')
    expect(request.credentials).toBe('include')
    let finish!: (value: Response) => void
    network.mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
    const detail = admin.adminApi.member('member-id')
    admin.clearSession()
    finish(response({ id: 'member-id', boundPhone: 'private' }))
    await expect(detail).rejects.toBeInstanceOf(admin.StaleRequestError)
  })
  it('keeps anonymous login failure in the same view lifetime', async () => {
    const epoch = admin.session.epoch
    network.mockResolvedValue(response({ code: 'ADMIN_LOGIN_FAILED' }, 401))
    await expect(admin.adminApi.login('operator', 'wrong-password')).rejects.toThrow('账号或密码不正确')
    expect(admin.session.epoch).toBe(epoch)
    expect(admin.session.account).toBeNull()
  })
  it('uses cookie credentials and csrf for mutations without local persisted secrets', async () => {
    authenticated()
    network.mockResolvedValue(response({ ok: true }))
    await admin.adminApi.hide('comment', 'comment-one', '不当内容')
    const request = network.mock.calls[0]![0] as Request
    expect(request.credentials).toBe('include')
    expect(request.headers.get('X-CSRF-Token')).toBe('test-csrf')
    expect(await request.json()).toEqual({ reason: '不当内容' })
  })
  it('clears identity on authenticated 401 and rejects delayed private results', async () => {
    authenticated()
    let resolve!: (value: Response) => void
    network.mockReturnValueOnce(new Promise((done) => { resolve = done }))
    const pending = admin.adminApi.accounts()
    network.mockResolvedValueOnce(response({ code: 'ADMIN_SESSION_REQUIRED' }, 401))
    await expect(admin.adminApi.feedback('comment', 'visible', 0)).rejects.toThrow('登录已失效')
    expect(admin.session.account).toBeNull()
    expect(admin.session.csrfToken).toBe('')
    resolve(response({ items: [account] }))
    await expect(pending).rejects.toBeInstanceOf(admin.StaleRequestError)
  })
  it('does not resurrect a session from a late restore', async () => {
    let resolve!: (value: Response) => void
    network.mockReturnValue(new Promise((done) => { resolve = done }))
    const pending = admin.adminApi.restore()
    admin.clearSession()
    resolve(response({ account, csrfToken: 'old-csrf' }))
    await expect(pending).rejects.toBeInstanceOf(admin.StaleRequestError)
    expect(admin.session.account).toBeNull()
  })
  it('clears local identity only after successful password change', async () => {
    authenticated()
    network.mockResolvedValueOnce(response({ code: 'INVALID_PASSWORD' }, 400))
    await expect(admin.adminApi.password('old-password', 'new-password')).rejects.toThrow('密码需')
    expect(admin.session.account?.id).toBe(account.id)
    network.mockResolvedValueOnce(response({ ok: true }))
    await admin.adminApi.password('old-password', 'NewPassword123')
    expect(admin.session.account).toBeNull()
  })
  it('keeps the session when logout fails and reports the failure', async () => {
    authenticated()
    network.mockRejectedValue(new Error('offline'))
    await expect(admin.adminApi.logout()).rejects.toThrow('网络连接失败')
    expect(admin.session.account?.id).toBe(account.id)
  })
  it('handles empty feedback, forbidden access, conflicts and request failures', async () => {
    authenticated()
    network.mockResolvedValueOnce(response({ items: [], total: 0, hasMore: false }))
    expect(await admin.adminApi.feedback('review', 'all', 40)).toEqual({ items: [], total: 0, hasMore: false })
    const request = network.mock.calls[0]![0] as Request
    expect(request.url).toContain('offset=40')
    network.mockResolvedValueOnce(response({ code: 'ADMIN_FORBIDDEN' }, 403))
    await expect(admin.adminApi.accounts()).rejects.toThrow('没有执行此操作')
    network.mockResolvedValueOnce(response({}, 409))
    await expect(admin.adminApi.hide('review', 'r', 'reason')).rejects.toThrow('记录已发生变化')
    network.mockRejectedValueOnce(new Error('offline'))
    await expect(admin.adminApi.feedback('review', 'all', 0)).rejects.toThrow('网络连接失败')
  })
  it('guards anonymous and operator routes without forcing password changes', async () => {
    const { allowedRoute } = await import('../src/services/access')
    expect(allowedRoute('/accounts')).toBe('/login')
    authenticated()
    expect(allowedRoute('/accounts')).toBe('/analytics')
    expect(allowedRoute('/feedback')).toBeUndefined()
    admin.session.account!.mustChangePassword = true
    expect(allowedRoute('/feedback')).toBeUndefined()
    expect(allowedRoute('/password')).toBeUndefined()
    admin.session.account!.mustChangePassword = false
    admin.session.account!.role = 'super_admin'
    expect(allowedRoute('/accounts')).toBeUndefined()
  })
  it('invalidates view requests on replacement, identity change and view disposal', async () => {
    const { useRequestScope } = await import('../src/services/request-scope')
    const scope = effectScope()
    const begin = scope.run(useRequestScope)!
    const first = begin()
    const second = begin()
    expect(first()).toBe(false)
    expect(second()).toBe(true)
    admin.clearSession()
    expect(second()).toBe(false)
    const third = begin()
    scope.stop()
    expect(third()).toBe(false)
  })
})
