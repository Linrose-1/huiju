import { afterEach, describe, expect, it, vi } from 'vitest'
import { AdminService } from '../src/admin/service.js'
import { adminOrigin, checkPassword, cookieHeader, csrfFor, hashPassword, readToken, verifyPassword } from '../src/admin/security.js'
import { FlowDatabase } from '../src/flow/common.js'

const token = 'a'.repeat(64)
const context = { cookie: `huiju_admin_session=${token}`, origin: 'https://admin.example.test', csrfToken: csrfFor(token) }
const account = { id: 'admin-id', displayName: '测试运营', status: 'active', createdAt: new Date(), updatedAt: new Date() }
const credential = { adminAccountId: account.id, username: 'operator', role: 'operator', passwordHash: '', mustChangePassword: false, failedAttempts: 0, lockedUntil: null }
function fakeDatabase(results: unknown[][]) {
  const writes: { operation: string; value: unknown }[] = []
  const tx = {
    select() {
      const result = results.shift()
      const query = { from: () => query, innerJoin: () => query, where: () => query, for: () => query, orderBy: () => query, then: (resolve: (value: unknown) => unknown) => Promise.resolve(result).then(resolve) }
      return query
    },
    update() { return { set: (value: unknown) => ({ where: async () => { writes.push({ operation: 'update', value }) } }) } },
    insert() { return { values: async (value: unknown) => { writes.push({ operation: 'insert', value }) } } },
  }
  const transaction = vi.fn(async (callback: (value: typeof tx) => unknown) => callback(tx))
  return { database: { db: { transaction } } as unknown as FlowDatabase, transaction, writes }
}
function sessionRows(overrides = {}) {
  return [[{ id: 'session-id', adminAccountId: account.id }], [{ account, credential: { ...credential, ...overrides } }], [{ id: 'session-id' }]]
}
afterEach(() => vi.unstubAllEnvs())

describe('admin security', () => {
  it('uses salted slow password hashes and rejects wrong/malformed hashes', async () => {
    const hash = await hashPassword('secure-example-1234')
    expect(hash).not.toContain('secure-example-1234')
    expect(await verifyPassword('secure-example-1234', hash)).toBe(true)
    expect(await verifyPassword('wrong-password-1234', hash)).toBe(false)
    expect(await verifyPassword('secure-example-1234', 'invalid')).toBe(false)
    expect(await hashPassword('secure-example-1234')).not.toBe(hash)
    expect(() => checkPassword('short1')).toThrow()
  })
  it('fails closed without origin and restricts insecure cookies to explicitly enabled local development', () => {
    vi.stubEnv('ADMIN_ORIGIN', '')
    expect(() => adminOrigin()).toThrow()
    vi.stubEnv('ADMIN_ORIGIN', 'http://127.0.0.1:5173')
    vi.stubEnv('ADMIN_ALLOW_LOCAL_HTTP', 'true')
    vi.stubEnv('NODE_ENV', 'development')
    expect(cookieHeader(token)).toContain('HttpOnly; SameSite=Strict')
    expect(cookieHeader(token)).not.toContain('; Secure')
    vi.stubEnv('NODE_ENV', 'production')
    expect(() => cookieHeader(token)).toThrow()
    vi.stubEnv('ADMIN_ORIGIN', 'https://admin.example.test')
    expect(cookieHeader(token)).toContain('; Secure')
  })
  it('rejects duplicate cookies and missing cookies', () => {
    expect(readToken(context.cookie)).toBe(token)
    expect(() => readToken()).toThrow()
    expect(() => readToken(`${context.cookie}; ${context.cookie}`)).toThrow()
  })
  it('rejects missing auth, cross-origin and missing CSRF before touching database', async () => {
    vi.stubEnv('ADMIN_ORIGIN', context.origin)
    const { database, transaction } = fakeDatabase([])
    const service = new AdminService(database)
    await expect(service.requireSession({})).rejects.toThrow()
    await expect(service.logout({ ...context, origin: 'https://evil.example' })).rejects.toThrow()
    await expect(service.logout({ ...context, csrfToken: undefined })).rejects.toThrow()
    expect(transaction).not.toHaveBeenCalled()
  })
  it('rejects operator escalation but allows business actions with a legacy password flag', async () => {
    const ordinary = new AdminService(fakeDatabase(sessionRows()).database)
    await expect(ordinary.listAccounts(context)).rejects.toThrow('需要超级管理员权限')
    const callback = vi.fn()
    const initial = new AdminService(fakeDatabase(sessionRows({ mustChangePassword: true })).database)
    await initial.withSession(context, callback)
    expect(callback).toHaveBeenCalledOnce()
  })
  it('re-reads session after locking account and rejects revoked or expired session', async () => {
    const rows = sessionRows()
    rows[2] = []
    const callback = vi.fn()
    const service = new AdminService(fakeDatabase(rows).database)
    await expect(service.withSession(context, callback)).rejects.toThrow('请重新登录后台')
    expect(callback).not.toHaveBeenCalled()
  })
  it('first-login session can be read without leaking password hashes', async () => {
    const service = new AdminService(fakeDatabase(sessionRows({ mustChangePassword: true })).database)
    const result = await service.requireSession(context)
    expect(result.account.mustChangePassword).toBe(false)
    expect(result.csrfToken).toBe(csrfFor(token))
    expect(result.account).not.toHaveProperty('passwordHash')
  })
  it('persists failed login count instead of rolling it back with the authentication error', async () => {
    vi.stubEnv('ADMIN_ORIGIN', context.origin)
    const hash = await hashPassword('correct-password-123')
    const fake = fakeDatabase([[{ account, credential: { ...credential, passwordHash: hash, failedAttempts: 4 } }]])
    await expect(new AdminService(fake.database).login('operator', 'wrong-password-123', context.origin, '127.0.0.1')).rejects.toThrow('账号或密码不正确')
    expect(fake.writes[0]?.value).toMatchObject({ failedAttempts: 5, lockedUntil: expect.any(Date) })
  })
  it('password changes revoke sessions and record audit in the same transaction', async () => {
    vi.stubEnv('ADMIN_ORIGIN', context.origin)
    const hash = await hashPassword('correct-password-123')
    const fake = fakeDatabase([...sessionRows({ mustChangePassword: true }), [{ ...credential, passwordHash: hash }]])
    await new AdminService(fake.database).changePassword(context, { currentPassword: 'correct-password-123', newPassword: 'updated-password-123' })
    expect(fake.transaction).toHaveBeenCalledOnce()
    expect(fake.writes).toEqual(expect.arrayContaining([
      { operation: 'update', value: expect.objectContaining({ mustChangePassword: false }) },
      { operation: 'update', value: { revokedAt: expect.any(Date) } },
      { operation: 'insert', value: expect.objectContaining({ action: 'change_password', targetId: account.id }) },
    ]))
  })
  it.each([false, true])('status change to active=%s revokes old sessions and retains an audit', async (active) => {
    vi.stubEnv('ADMIN_ORIGIN', context.origin)
    const fake = fakeDatabase([...sessionRows({ role: 'super_admin' }), [{ account: { ...account, id: 'target-id' }, credential }]])
    await new AdminService(fake.database).setStatus(context, 'target-id', active)
    expect(fake.writes).toEqual(expect.arrayContaining([
      { operation: 'update', value: { status: active ? 'active' : 'disabled' } },
      { operation: 'update', value: { revokedAt: expect.any(Date) } },
      { operation: 'insert', value: expect.objectContaining({ action: active ? 'enable' : 'disable', targetId: 'target-id' }) },
    ]))
  })
  it('cannot disable or reset another super admin through the web account actions', async () => {
    vi.stubEnv('ADMIN_ORIGIN', context.origin)
    for (const action of ['disable', 'reset']) {
      const fake = fakeDatabase([...sessionRows({ role: 'super_admin' }), [{ account, credential: { ...credential, role: 'super_admin' } }]])
      const service = new AdminService(fake.database)
      const result = action === 'disable' ? service.setStatus(context, account.id, false) : service.resetPassword(context, account.id, 'temporary-password-123')
      await expect(result).rejects.toThrow('超级管理员账号须由部署维护人员管理')
      expect(fake.writes).toHaveLength(0)
    }
  })
  it('reset allows direct login and revokes every previous session', async () => {
    vi.stubEnv('ADMIN_ORIGIN', context.origin)
    const fake = fakeDatabase([...sessionRows({ role: 'super_admin' }), [{ account, credential }]])
    await new AdminService(fake.database).resetPassword(context, account.id, 'temporary-password-123')
    expect(fake.writes).toEqual(expect.arrayContaining([
      { operation: 'update', value: expect.objectContaining({ mustChangePassword: false, failedAttempts: 0, lockedUntil: null }) },
      { operation: 'update', value: { revokedAt: expect.any(Date) } },
      { operation: 'insert', value: expect.objectContaining({ action: 'reset_password' }) },
    ]))
  })
})
