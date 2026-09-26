import { useSessionStore } from '@/stores/session'
import { API_BASE_URL } from './environment'
import type { Member, Activity, Session, Registration, MyRegistration, RegistrationInput, PublicMember } from './types'
export class ApiError extends Error {
  constructor(public code: string, message: string, public status = 0) { super(message) }
}
export function errorMessage(error: unknown): string { return error instanceof Error ? error.message : '暂时无法完成，请稍后重试' }
async function request<T>(path: string, method: 'GET' | 'POST' | 'DELETE' = 'GET', data?: object, auth: boolean | 'none' = false): Promise<T> {
  const session = useSessionStore()
  if (session.token && Date.parse(session.expiresAt) <= Date.now()) session.clear()
  if (auth === true && !session.token) throw new ApiError('SESSION_REQUIRED', '登录已失效，请重新登录', 401)
  const epoch = session.epoch
  const token = session.token
  return new Promise((resolve, reject) => {
    uni.request({ url: API_BASE_URL + path, method, data, timeout: 15000,
      header: { 'Content-Type': 'application/json', ...(token && auth !== 'none' ? { Authorization: `Bearer ${token}` } : {}) },
      success(response) {
        if ((epoch !== session.epoch || token !== session.token) && (auth !== false || !!token)) { reject(new ApiError('STALE_REQUEST', '身份已变更，请重新操作')); return }
        const body = response.data as { code?: string; message?: string }
        if (response.statusCode === 401) {
          session.clear()
          if (auth === false && token) { request<T>(path, method, data, false).then(resolve, reject); return }
        }
        if (response.statusCode >= 200 && response.statusCode < 300) resolve(response.data as T)
        else reject(new ApiError(body.code || 'REQUEST_FAILED', typeof body.message === 'string' ? body.message : '请求未能完成，请稍后重试', response.statusCode))
      }, fail() { reject(new ApiError('NETWORK_ERROR', '网络连接失败，请检查网络后重试')) }
    })
  })
}
let refreshing: { token: string; epoch: number; promise: Promise<Member | null> } | null = null
export function refreshMember(): Promise<Member | null> {
  const session = useSessionStore()
  if (!session.token) return Promise.resolve(null)
  if (refreshing?.token === session.token && refreshing.epoch === session.epoch) return refreshing.promise
  const token = session.token
  const epoch = session.epoch
  const promise = request<Member>('/auth/session', 'GET', undefined, true).then(member => {
    if (token !== session.token || epoch !== session.epoch) throw new ApiError('STALE_REQUEST', '身份已变更，请重新操作')
    session.member = member
    return member
  }).finally(() => { if (refreshing?.promise === promise) refreshing = null })
  refreshing = { token, epoch, promise }
  return promise
}
async function memberMutation(path: string, method: 'POST', body: object) {
  const member = await request<Member>(path, method, body, true)
  useSessionStore().member = member
  return member
}
export const api = {
  login: (code: string, inviteCode?: string) => request<Session>('/auth/wechat/session', 'POST', { code, ...(inviteCode ? { inviteCode } : {}) }, 'none'),
  logout: () => request<{ ok: boolean }>('/auth/session', 'DELETE', undefined, true),
  phone: (code: string) => memberMutation('/members/me/phone', 'POST', { code }),
  profile: (displayName: string) => memberMutation('/members/me/profile', 'POST', { displayName }),
  avatar: (base64: string, mimeType: 'image/png' | 'image/jpeg') => memberMutation('/members/me/avatar', 'POST', { base64, mimeType }),
  activities: () => request<{items: Activity[]}>('/activities'),
  activity: (id: string) => request<Activity>(`/activities/${encodeURIComponent(id)}`),
  roster: (id: string) => request<{items: PublicMember[]}>(`/activities/${encodeURIComponent(id)}/registrations`),
  register: (id: string, input: RegistrationInput) => request<Registration>(`/activities/${encodeURIComponent(id)}/registrations`, 'POST', input, true),
  myRegistration: (id: string) => request<Registration>(`/activities/${encodeURIComponent(id)}/registrations/me`, 'GET', undefined, true),
  editRegistration: (id: string, answers: RegistrationInput['answers']) => request<Registration>(`/activities/${encodeURIComponent(id)}/registrations/me/answers`, 'POST', { answers }, true),
  cancel: (id: string) => request<Registration>(`/activities/${encodeURIComponent(id)}/registrations/me/cancel`, 'POST', {}, true),
  registrations: () => request<{items: MyRegistration[]}>('/members/me/registrations', 'GET', undefined, true)
}
