import 'reflect-metadata'
import { randomBytes, randomUUID } from 'node:crypto'
import { eq } from 'drizzle-orm'
import { describe, expect, it, vi } from 'vitest'
import { AdminService } from '../src/admin/service.js'
import { ADMIN_COOKIE, csrfFor, hashPassword } from '../src/admin/security.js'
import { createDatabase } from '../src/database/db.js'
import { adminAccountAudit, adminCredentials } from '../src/database/schema/admin.js'
import { adminAccounts, adminSessions } from '../src/database/schema/members.js'
import { FlowDatabase } from '../src/flow/common.js'

// Never loads development credentials. Requires separate authorization and migration 0005.
describe.skipIf(process.env.HUIJU_DB_TEST !== 'admin-auth-rollback')('admin auth real MySQL rollback', () => {
  it('enforces initial change, role restrictions, password reset and disable against real stored sessions', async () => {
    const connectionString = process.env.TEST_DATABASE_URL
    if (!connectionString) throw new Error('TEST_DATABASE_URL required')
    const target = new URL(connectionString)
    if (target.protocol !== 'mysql:' || target.search || target.hash || target.hostname !== '127.0.0.1' || target.port !== '3306' || target.pathname !== '/huiju') throw new Error('Only separately authorized 127.0.0.1:3306/huiju is supported')
    const origin = 'https://admin.example.test'
    vi.stubEnv('ADMIN_ORIGIN', origin)
    const connection = createDatabase(connectionString)
    const rollback = new Error('ADMIN_AUTH_ROLLBACK_COMPLETE')
    const superId = randomUUID()
    const username = `test-${superId}`
    const operatorUsername = `test-${randomUUID()}`
    const password = `T${randomBytes(24).toString('hex')}1`
    const newPassword = `T${randomBytes(24).toString('hex')}2`
    const resetPassword = `T${randomBytes(24).toString('hex')}3`
    const request = (token: string) => ({ cookie: `${ADMIN_COOKIE}=${token}`, csrfToken: csrfFor(token), origin })
    let operatorId = '', completed = false
    try {
      await expect(connection.db.transaction(async tx => {
        await tx.insert(adminAccounts).values({ id: superId, displayName: '隔离超管' })
        await tx.insert(adminCredentials).values({ adminAccountId: superId, username, role: 'super_admin', passwordHash: await hashPassword(password), mustChangePassword: false })
        const database = Object.create(FlowDatabase.prototype) as FlowDatabase
        Object.defineProperty(database, 'db', { value: tx })
        const auth = new AdminService(database)
        const login = (name: string, secret: string) => auth.login(name, secret, origin, 'rollback-test')
        const superLogin = await login(username, password)
        const superContext = request(superLogin.token)
        const operator = await auth.createAccount(superContext, { username: operatorUsername, displayName: '隔离运营', temporaryPassword: password })
        operatorId = operator.id
        expect(operator.role).toBe('operator')
        const initialLogin = await login(operatorUsername, password)
        const initialContext = request(initialLogin.token)
        expect((await auth.requireSession(initialContext)).account.mustChangePassword).toBe(false)
        await expect(auth.withSession(initialContext, async () => true)).resolves.toBe(true)
        await auth.changePassword(initialContext, { currentPassword: password, newPassword })
        await expect(auth.requireSession(initialContext)).rejects.toMatchObject({ status: 401 })
        await expect(login(operatorUsername, password)).rejects.toMatchObject({ status: 401 })
        const changedLogin = await login(operatorUsername, newPassword)
        const changedContext = request(changedLogin.token)
        expect((await auth.requireSession(changedContext)).account.mustChangePassword).toBe(false)
        await expect(auth.createAccount(changedContext, { username: `test-${randomUUID()}`, displayName: '不可创建', temporaryPassword: password })).rejects.toMatchObject({ response: { code: 'ADMIN_FORBIDDEN' } })
        await expect(auth.setStatus(superContext, superId, false)).rejects.toMatchObject({ response: { code: 'ADMIN_FORBIDDEN' } })
        await auth.resetPassword(superContext, operatorId, resetPassword)
        await expect(auth.requireSession(changedContext)).rejects.toMatchObject({ status: 401 })
        await expect(login(operatorUsername, newPassword)).rejects.toMatchObject({ status: 401 })
        const resetLogin = await login(operatorUsername, resetPassword)
        const resetContext = request(resetLogin.token)
        expect(resetLogin.session.account.mustChangePassword).toBe(false)
        await auth.setStatus(superContext, operatorId, false)
        await expect(auth.requireSession(resetContext)).rejects.toMatchObject({ status: 401 })
        await expect(login(operatorUsername, resetPassword)).rejects.toMatchObject({ status: 401 })
        await auth.setStatus(superContext, operatorId, true)
        await expect(auth.requireSession(resetContext)).rejects.toMatchObject({ status: 401 })
        const reenabled = await login(operatorUsername, resetPassword)
        expect(reenabled.session.account.mustChangePassword).toBe(false)
        const sessions = await tx.select().from(adminSessions).where(eq(adminSessions.adminAccountId, operatorId))
        expect(sessions.filter(session => !session.revokedAt)).toHaveLength(1)
        const audit = await tx.select().from(adminAccountAudit).where(eq(adminAccountAudit.targetId, operatorId))
        expect(audit.map(item => item.action).sort()).toEqual(['create', 'change_password', 'reset_password', 'disable', 'enable'].sort())
        completed = true
        throw rollback
      })).rejects.toBe(rollback)
      expect(completed).toBe(true)
      for (const id of [superId, operatorId]) {
        expect(await connection.db.select().from(adminAccounts).where(eq(adminAccounts.id, id))).toEqual([])
        expect(await connection.db.select().from(adminCredentials).where(eq(adminCredentials.adminAccountId, id))).toEqual([])
        expect(await connection.db.select().from(adminSessions).where(eq(adminSessions.adminAccountId, id))).toEqual([])
        expect(await connection.db.select().from(adminAccountAudit).where(eq(adminAccountAudit.targetId, id))).toEqual([])
      }
    } finally { vi.unstubAllEnvs(); await connection.pool.end() }
  }, 30000)
})
