import { Injectable } from '@nestjs/common'
import { and, eq, gt, isNull } from 'drizzle-orm'
import { randomBytes, randomUUID } from 'node:crypto'
import { adminAccountAudit, adminCredentials } from '../database/schema/admin.js'
import { adminAccounts, adminSessions } from '../database/schema/members.js'
import { fail, FlowDatabase } from '../flow/common.js'
import { AdminAccountDto, AdminCreateInput, AdminPasswordInput } from './dto.js'
import { checkOrigin, checkPassword, csrfFor, digest, hashPassword, readToken, verifyPassword } from './security.js'

export interface AdminRequestContext { cookie?: string; origin?: string; csrfToken?: string }
export type AdminTransaction = Parameters<Parameters<FlowDatabase['db']['transaction']>[0]>[0]
type AccountRow = { account: typeof adminAccounts.$inferSelect; credential: typeof adminCredentials.$inferSelect }
function present(row: AccountRow): AdminAccountDto {
  return { id: row.account.id, username: row.credential.username, displayName: row.account.displayName, role: row.credential.role, active: row.account.status === 'active', mustChangePassword: false, createdAt: row.account.createdAt.toISOString() }
}

@Injectable()
export class AdminService {
  constructor(private readonly database: FlowDatabase) {}
  // Supplemental per-process source limit; persistent per-account failures remain authoritative.
  private readonly attempts = new Map<string, { count: number; until: number }>()
  private limit(source: string) {
    const now = Date.now()
    for (const [key, item] of this.attempts) if (item.until <= now) this.attempts.delete(key)
    let item = this.attempts.get(source)
    if (!item) {
      if (this.attempts.size >= 10000) fail('ADMIN_LOGIN_LIMITED', '尝试过于频繁，请稍后再试', 429)
      item = { count: 0, until: now + 15 * 60 * 1000 }
      this.attempts.set(source, item)
    }
    if (++item.count > 30) fail('ADMIN_LOGIN_LIMITED', '尝试过于频繁，请稍后再试', 429)
  }

  async login(username: string, password: string, origin: string | undefined, source: string) {
    checkOrigin(origin)
    this.limit(source)
    const result = await this.database.db.transaction(async (tx) => {
      const [row] = await tx.select({ account: adminAccounts, credential: adminCredentials }).from(adminAccounts).innerJoin(adminCredentials, eq(adminCredentials.adminAccountId, adminAccounts.id)).where(eq(adminCredentials.username, username)).for('update')
      const now = new Date()
      if (!row || row.account.status !== 'active' || (row.credential.lockedUntil && row.credential.lockedUntil > now)) {
        await verifyPassword(password, `scrypt-v1$${'0'.repeat(32)}$${'0'.repeat(128)}`)
        return null
      }
      if (!await verifyPassword(password, row.credential.passwordHash)) {
        const failures = (row.credential.lockedUntil && row.credential.lockedUntil <= now ? 0 : row.credential.failedAttempts) + 1
        await tx.update(adminCredentials).set({ failedAttempts: failures, lockedUntil: failures >= 5 ? new Date(Date.now() + 15 * 60 * 1000) : null }).where(eq(adminCredentials.adminAccountId, row.account.id))
        return null
      }
      await tx.update(adminCredentials).set({ failedAttempts: 0, lockedUntil: null }).where(eq(adminCredentials.adminAccountId, row.account.id))
      const token = randomBytes(32).toString('hex')
      await tx.insert(adminSessions).values({ id: randomUUID(), adminAccountId: row.account.id, tokenHash: digest(token), expiresAt: new Date(Date.now() + 8 * 60 * 60 * 1000) })
      return { token, session: { account: present(row), csrfToken: csrfFor(token) } }
    })
    if (!result) fail('ADMIN_LOGIN_FAILED', '账号或密码不正确，或账号暂不可用', 401)
    return result
  }

  async withSession<T>(context: AdminRequestContext, callback: (tx: AdminTransaction, account: AdminAccountDto) => Promise<T>, options: { write?: boolean; superOnly?: boolean } = {}): Promise<T> {
    const token = readToken(context.cookie)
    if (options.write) {
      checkOrigin(context.origin)
      if (context.csrfToken !== csrfFor(token)) fail('ADMIN_CSRF_REJECTED', '页面已失效，请刷新后再试', 403)
    }
    return this.database.db.transaction(async (tx) => {
      const [candidate] = await tx.select().from(adminSessions).where(eq(adminSessions.tokenHash, digest(token)))
      if (!candidate) fail('ADMIN_SESSION_REQUIRED', '请重新登录后台', 401)
      // Account locking serializes privilege checks with password reset and disable operations.
      const [row] = await tx.select({ account: adminAccounts, credential: adminCredentials }).from(adminAccounts).innerJoin(adminCredentials, eq(adminCredentials.adminAccountId, adminAccounts.id)).where(eq(adminAccounts.id, candidate.adminAccountId)).for('update')
      const [session] = await tx.select().from(adminSessions).where(and(eq(adminSessions.id, candidate.id), isNull(adminSessions.revokedAt), gt(adminSessions.expiresAt, new Date()))).for('update')
      if (!row || row.account.status !== 'active' || !session) fail('ADMIN_SESSION_REQUIRED', '请重新登录后台', 401)
      if (options.superOnly && row.credential.role !== 'super_admin') fail('ADMIN_FORBIDDEN', '需要超级管理员权限', 403)
      return callback(tx, present(row))
    })
  }

  requireSession(context: AdminRequestContext) {
    return this.withSession(context, async (_tx, account) => ({ account, csrfToken: csrfFor(readToken(context.cookie)) }), {})
  }

  logout(context: AdminRequestContext) {
    return this.withSession(context, async (tx) => {
      await tx.update(adminSessions).set({ revokedAt: new Date() }).where(eq(adminSessions.tokenHash, digest(readToken(context.cookie))))
      return { ok: true }
    }, { write: true })
  }

  changePassword(context: AdminRequestContext, input: AdminPasswordInput) {
    checkPassword(input.newPassword)
    if (input.currentPassword === input.newPassword) fail('INVALID_PASSWORD', '新密码不能与原密码相同')
    return this.withSession(context, async (tx, account) => {
      const [credential] = await tx.select().from(adminCredentials).where(eq(adminCredentials.adminAccountId, account.id)).for('update')
      if (!credential || !await verifyPassword(input.currentPassword, credential.passwordHash)) fail('ADMIN_PASSWORD_INCORRECT', '当前密码不正确', 400)
      await tx.update(adminCredentials).set({ passwordHash: await hashPassword(input.newPassword), mustChangePassword: false, failedAttempts: 0, lockedUntil: null }).where(eq(adminCredentials.adminAccountId, account.id))
      await this.revoke(tx, account.id)
      await this.audit(tx, account.id, account.id, 'change_password')
      return { ok: true }
    }, { write: true })
  }

  listAccounts(context: AdminRequestContext) {
    return this.withSession(context, async (tx) => ({ items: (await tx.select({ account: adminAccounts, credential: adminCredentials }).from(adminAccounts).innerJoin(adminCredentials, eq(adminCredentials.adminAccountId, adminAccounts.id)).orderBy(adminAccounts.createdAt)).map(present) }), { superOnly: true })
  }

  async createAccount(context: AdminRequestContext, input: AdminCreateInput) {
    checkPassword(input.temporaryPassword)
    try { return await this.withSession(context, async (tx, actor) => {
      const [existing] = await tx.select().from(adminCredentials).where(eq(adminCredentials.username, input.username))
      if (existing) fail('ADMIN_USERNAME_EXISTS', '账号名称已使用', 409)
      const id = randomUUID()
      const createdAt = new Date()
      await tx.insert(adminAccounts).values({ id, displayName: input.displayName, createdAt })
      await tx.insert(adminCredentials).values({ adminAccountId: id, username: input.username, passwordHash: await hashPassword(input.temporaryPassword), role: 'operator', mustChangePassword: false })
      await this.audit(tx, actor.id, id, 'create')
      return { id, username: input.username, displayName: input.displayName, role: 'operator' as const, active: true, mustChangePassword: false, createdAt: createdAt.toISOString() }
    }, { write: true, superOnly: true }) } catch (error) {
      const cause = error && typeof error === 'object' && 'cause' in error ? error.cause : error
      if (cause && typeof cause === 'object' && 'code' in cause && cause.code === 'ER_DUP_ENTRY') fail('ADMIN_USERNAME_EXISTS', '账号名称已使用', 409)
      throw error
    }
  }

  private async requireOperator(tx: AdminTransaction, id: string) {
    const [row] = await tx.select({ account: adminAccounts, credential: adminCredentials }).from(adminAccounts).innerJoin(adminCredentials, eq(adminCredentials.adminAccountId, adminAccounts.id)).where(eq(adminAccounts.id, id)).for('update')
    if (!row) fail('ADMIN_ACCOUNT_NOT_FOUND', '账号不存在', 404)
    if (row.credential.role !== 'operator') fail('ADMIN_FORBIDDEN', '超级管理员账号须由部署维护人员管理', 403)
  }
  resetPassword(context: AdminRequestContext, id: string, temporaryPassword: string) {
    checkPassword(temporaryPassword)
    return this.withSession(context, async (tx, actor) => {
      await this.requireOperator(tx, id)
      await tx.update(adminCredentials).set({ passwordHash: await hashPassword(temporaryPassword), mustChangePassword: false, failedAttempts: 0, lockedUntil: null }).where(eq(adminCredentials.adminAccountId, id))
      await this.revoke(tx, id)
      await this.audit(tx, actor.id, id, 'reset_password')
      return { ok: true }
    }, { write: true, superOnly: true })
  }
  setStatus(context: AdminRequestContext, id: string, active: boolean) {
    return this.withSession(context, async (tx, actor) => {
      await this.requireOperator(tx, id)
      await tx.update(adminAccounts).set({ status: active ? 'active' : 'disabled' }).where(eq(adminAccounts.id, id))
      await this.revoke(tx, id)
      await this.audit(tx, actor.id, id, active ? 'enable' : 'disable')
      return { ok: true }
    }, { write: true, superOnly: true })
  }
  private async revoke(tx: AdminTransaction, id: string) {
    await tx.update(adminSessions).set({ revokedAt: new Date() }).where(and(eq(adminSessions.adminAccountId, id), isNull(adminSessions.revokedAt)))
  }
  private async audit(tx: AdminTransaction, actorId: string, targetId: string, action: typeof adminAccountAudit.$inferInsert['action']) {
    await tx.insert(adminAccountAudit).values({ id: randomUUID(), actorId, targetId, action })
  }
}
