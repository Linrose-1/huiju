import { computed, reactive } from 'vue'
import { createApiClient } from '../../../../packages/api-client/src/index'
import type { components } from '../../../../packages/api-client/src/generated'

export type AdminAccount = components['schemas']['AdminAccountDto']
export type MemberSummary = components['schemas']['AdminMemberSummaryDto']
export type MemberDetail = components['schemas']['AdminMemberDetailDto']
export type FeedbackItem = components['schemas']['ModerationItemDto']
type AdminSession = components['schemas']['AdminSessionDto']

const client = createApiClient('')
export const session = reactive({ account: null as AdminAccount | null, csrfToken: '', epoch: 0 })
export const isSuperAdmin = computed(() => session.account?.role === 'super_admin')
export function clearSession() {
  session.epoch += 1
  session.account = null
  session.csrfToken = ''
}
export class StaleRequestError extends Error {}
export class AdminRequestError extends Error {
  constructor(public status: number, public code: string, message: string) { super(message) }
}

const messages: Record<string, string> = {
  ADMIN_LOGIN_FAILED: '账号或密码不正确，请重试。',
  ADMIN_SESSION_REQUIRED: '登录已失效，请重新登录。',
  FORBIDDEN: '你没有执行此操作的权限。',
  ADMIN_FORBIDDEN: '你没有执行此操作的权限。',
  INVALID_PASSWORD: '密码需为 12–128 位，包含字母和数字，且不能与原密码相同。',
  ADMIN_PASSWORD_CHANGE_REQUIRED: '请先修改初始密码。',
  ADMIN_USERNAME_EXISTS: '该账号已存在，请换一个账号名称。',
  ADMIN_CSRF_REJECTED: '会话校验失败，请刷新页面后重试。',
}
type Result<T> = { data?: T; error?: unknown; response: Response }
async function unwrap<T>(request: Promise<Result<T>>, epoch = session.epoch): Promise<T> {
  let result: Result<T>
  try { result = await request } catch {
    if (epoch !== session.epoch) throw new StaleRequestError()
    throw new Error('网络连接失败，请检查网络后重试。')
  }
  if (epoch !== session.epoch) throw new StaleRequestError()
  if (!result.response.ok || result.data === undefined) {
    const error = result.error as { code?: string; message?: string } | undefined
    const code = error?.code ?? ''
    if (result.response.status === 401 && session.account) clearSession()
    const fallback = result.response.status === 401 ? '登录已失效，请重新登录。'
      : result.response.status === 403 ? '没有权限或会话校验失败，请重新登录后重试。'
        : result.response.status === 409 ? '记录已发生变化，请刷新后重试。'
          : result.response.status === 429 ? '操作过于频繁，请稍后重试。'
            : result.response.status === 400 ? '填写内容不符合要求，请检查后重试。' : '操作未完成，请稍后重试。'
    throw new AdminRequestError(result.response.status, code, messages[code] ?? fallback)
  }
  return result.data
}
const options = () => ({ credentials: 'include' as const, headers: { 'X-CSRF-Token': session.csrfToken } })
const csrfHeader = () => ({ 'X-CSRF-Token': session.csrfToken })
function acceptSession(value: AdminSession) {
  session.epoch += 1
  session.account = value.account
  session.csrfToken = value.csrfToken
}
export const adminApi = {
  async restore() { acceptSession(await unwrap(client.GET('/api/v1/admin/auth/session', options()))) },
  async login(username: string, password: string) {
    acceptSession(await unwrap(client.POST('/api/v1/admin/auth/login', { ...options(), body: { username, password } })))
  },
  async logout() {
    await unwrap(client.POST('/api/v1/admin/auth/logout', { ...options(), params: { header: csrfHeader() } }))
    clearSession()
  },
  async password(currentPassword: string, newPassword: string) {
    await unwrap(client.POST('/api/v1/admin/auth/password', { ...options(), params: { header: csrfHeader() }, body: { currentPassword, newPassword } }))
    clearSession()
  },
  members: (query: { q?: string; profile?: 'all' | 'complete' | 'incomplete'; inviterId?: string; offset: number }) => unwrap(client.GET('/api/v1/admin/members', { ...options(), params: { query } })),
  member: (id: string) => unwrap(client.GET('/api/v1/admin/members/{id}', { ...options(), params: { path: { id } } })),
  accounts: () => unwrap(client.GET('/api/v1/admin/accounts', options())),
  createAccount: (username: string, displayName: string, temporaryPassword: string) => unwrap(client.POST('/api/v1/admin/accounts', {
    ...options(), params: { header: csrfHeader() }, body: { username, displayName, temporaryPassword },
  })),
  resetPassword: (id: string, temporaryPassword: string) => unwrap(client.POST('/api/v1/admin/accounts/{id}/reset-password', {
    ...options(), params: { path: { id }, header: csrfHeader() }, body: { temporaryPassword },
  })),
  accountStatus: (id: string, active: boolean) => unwrap(client.POST('/api/v1/admin/accounts/{id}/status', {
    ...options(), params: { path: { id }, header: csrfHeader() }, body: { active },
  })),
  feedback: (kind: 'comment' | 'review', status: 'visible' | 'hidden' | 'all', offset: number) => unwrap(client.GET('/api/v1/admin/feedback', {
    ...options(), params: { query: { kind, status, offset } },
  })),
  hide: (kind: 'comment' | 'review', id: string, reason: string) => unwrap(client.POST('/api/v1/admin/feedback/{kind}/{id}/hide', {
    ...options(), params: { path: { kind, id }, header: csrfHeader() }, body: { reason },
  })),
}
export function errorMessage(error: unknown) { return error instanceof Error ? error.message : '操作未完成，请稍后重试。' }
export function formatDate(value: string) {
  return new Intl.DateTimeFormat('zh-CN', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Shanghai' }).format(new Date(value))
}
