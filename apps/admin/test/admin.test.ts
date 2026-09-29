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
    expect(allowedRoute('/accounts')).toBe('/feedback')
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
