import { computed, reactive } from 'vue'
import { createApiClient } from '../../../../packages/api-client/src/index'
import type { components } from '../../../../packages/api-client/src/generated'

export type AdminAccount = components['schemas']['AdminAccountDto']
export type MemberSummary = components['schemas']['AdminMemberSummaryDto']
export type MemberDetail = components['schemas']['AdminMemberDetailDto']
export type FeedbackItem = components['schemas']['ModerationItemDto']
export type AdminActivity = components['schemas']['AdminActivityDto']
export type ActivityOperation = components['schemas']['ActivityModerationOperationDto']
export type AnalyticsDashboard = components['schemas']['AnalyticsDashboardDto']
export type AnalyticsEvent = components['schemas']['AnalyticsEventDto']
export type AnalyticsMember = components['schemas']['AnalyticsMemberDto']
export type ActivityReport = components['schemas']['ActivityReportDto']
export type ActivityRegistration = components['schemas']['ActivityRegistrationDto']
export type ContentHistory = components['schemas']['AuditDto']
export type ContentEditor = components['schemas']['EditorDto']
export type CirclePost = components['schemas']['CirclePostDto']
export type CircleOperation = components['schemas']['CircleOperationDto']
export type CircleCategory = 'all' | 'park' | 'operation' | 'service' | 'store'
export type EngagementQuery = { days: 7 | 30; behavior: 'all' | 'new' | 'converted' | 'browse' | 'participate' | 'register' | 'attend' | 'publish' | 'comment' | 'review' | 'inactive' | 'silent'; profile: 'all' | 'complete' | 'incomplete'; inviterId?: string; offset: number }
type AdminSession = components['schemas']['AdminSessionDto']

export const client = createApiClient('')
export const session = reactive({ account: null as AdminAccount | null, csrfToken: '', epoch: 0, initialized: false })
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
export async function unwrap<T>(request: Promise<Result<T>>, epoch = session.epoch): Promise<T> {
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
export const options = () => ({ credentials: 'include' as const, headers: { 'X-CSRF-Token': session.csrfToken } })
const csrfHeader = () => ({ 'X-CSRF-Token': session.csrfToken })
function acceptSession(value: AdminSession) {
  session.epoch += 1
  session.account = value.account
  session.csrfToken = value.csrfToken
}
export const adminApi = {
  circlePosts: (category: CircleCategory, offset: number) => unwrap(client.GET('/api/v1/admin/circle/posts', { ...options(), params: { query: { category, offset, limit: 20 } } })),
  circleOperations: (id: string, offset: number) => unwrap(client.GET('/api/v1/admin/circle/posts/{id}/operations', { ...options(), params: { path: { id }, query: { offset, limit: 20 } } })),
  removeCirclePost: (id: string, reason: string) => unwrap(client.POST('/api/v1/admin/circle/posts/{id}/remove', { ...options(), params: { path: { id }, header: csrfHeader() }, body: { reason } })),
  restoreCirclePost: (id: string, reason: string) => unwrap(client.POST('/api/v1/admin/circle/posts/{id}/restore', { ...options(), params: { path: { id }, header: csrfHeader() }, body: { reason } })),
  analytics: (days: 7 | 30) => unwrap(client.GET('/api/v1/admin/analytics', { ...options(), params: { query: { days } } })),
  engagementEvents: (id: string, days: 7 | 30, offset: number) => unwrap(client.GET('/api/v1/admin/analytics/members/{id}/events', { ...options(), params: { path: { id }, query: { days, offset } } })),
  engagement: (query: EngagementQuery) => unwrap(client.GET('/api/v1/admin/analytics/members', { ...options(), params: { query } })),
  exportEngagement: (query: EngagementQuery) => unwrap(client.GET('/api/v1/admin/analytics/export', { ...options(), parseAs: 'text', params: { query } })),
  activityReport: (id: string) => unwrap(client.GET('/api/v1/admin/activities/{id}/report', { ...options(), params: { path: { id } } })),
  activityRegistrations: (id: string, offset: number, status: 'all' | 'active' | 'cancelled') => unwrap(client.GET('/api/v1/admin/activities/{id}/registrations', { ...options(), params: { path: { id }, query: { offset, status } } })),
  content: () => unwrap(client.GET('/api/v1/admin/platform/content', options())),
  saveContent: (body: { activityText: string; assistantText: string }) => unwrap(client.PATCH('/api/v1/admin/platform/content', { ...options(), params: { header: csrfHeader() }, body })),
  contentHistory: (offset: number) => unwrap(client.GET('/api/v1/admin/platform/content/history', { ...options(), params: { query: { offset, limit: 20 } } })),
  contentEditors: (offset: number) => unwrap(client.GET('/api/v1/admin/platform/editors', { ...options(), params: { query: { offset, limit: 20 } } })),
  setContentEditor: (memberId: string, enabled: boolean) => unwrap(client.PUT('/api/v1/admin/platform/editors/{memberId}', { ...options(), params: { path: { memberId }, header: csrfHeader() }, body: { enabled } })),
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
  activities: (query: { status: 'all' | 'normal' | 'removed'; q?: string; offset: number }) => unwrap(client.GET('/api/v1/admin/activities', { ...options(), params: { query } })),
  activityOperations: (id: string, offset: number) => unwrap(client.GET('/api/v1/admin/activities/{id}/operations', { ...options(), params: { path: { id }, query: { offset } } })),
  removeActivity: (id: string, reason: string) => unwrap(client.POST('/api/v1/admin/activities/{id}/remove', {
    ...options(), params: { path: { id }, header: csrfHeader() }, body: { reason },
  })),
  restoreActivity: (id: string, reason: string) => unwrap(client.POST('/api/v1/admin/activities/{id}/restore', {
    ...options(), params: { path: { id }, header: csrfHeader() }, body: { reason },
  })),
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
