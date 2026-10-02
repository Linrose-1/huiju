import { useSessionStore } from '@/stores/session'
import { API_BASE_URL } from './environment'
import type { ActivitySearchResult } from './types'
import type { CirclePost, CircleList, CircleWriteInput, CircleIntentList, CircleImage, Attendance, CommentList, ReviewList, FeedbackContext, ReviewStats, AiActivityDraftResult } from './types'
import type { Member, Activity, Session, Registration, RegistrationInput, ActivityWriteInput, ManagedActivity, ReadingList, ReadingStats, ProfileDetails, ProfileDetailsInput, CardSettings, MemberCard, ManagedActivityList, RegistrationList, PublicRoster, OrganizerRoster, NotificationList } from './types'
export class ApiError extends Error {
  constructor(public code: string, message: string, public status = 0) { super(message) }
}
export function errorMessage(error: unknown): string { return error instanceof Error ? error.message : '暂时无法完成，请稍后重试' }
const safeMessages: Record<string, string> = {
  AI_GENERATION_IN_PROGRESS: '正在生成草稿，请等待本次生成完成',
  AI_GENERATION_EXPIRED: '本次生成已超时，请手动重试',
  AI_BUSY: '生成请求较多，请稍后手动重试'
}
export type { ActivityCounts } from './types'
export type ListQuery = { offset?: number; limit?: number; status?: string }
function listQuery(query: ListQuery = {}) {
  return `offset=${query.offset ?? 0}&limit=${query.limit ?? 20}${query.status ? `&status=${encodeURIComponent(query.status)}` : ''}`
}
async function request<T>(path: string, method: 'GET' | 'POST' | 'DELETE' = 'GET', data?: object, auth: boolean | 'none' = false, timeout = 15000): Promise<T> {
  const session = useSessionStore()
  if (session.token && Date.parse(session.expiresAt) <= Date.now()) session.clear()
  if (auth === true && !session.token) throw new ApiError('SESSION_REQUIRED', '登录已失效，请重新登录', 401)
  const epoch = session.epoch
  const token = session.token
  return new Promise((resolve, reject) => {
    uni.request({ url: API_BASE_URL + path, method, data, timeout,
      header: { 'Content-Type': 'application/json', ...(token && auth !== 'none' ? { Authorization: `Bearer ${token}` } : {}) },
      success(response) {
        if ((epoch !== session.epoch || token !== session.token) && (auth !== false || !!token)) { reject(new ApiError('STALE_REQUEST', '身份已变更，请重新操作')); return }
        const body = response.data as { code?: string; message?: string }
        if (response.statusCode === 401) {
          session.clear()
          if (auth === false && token) { request<T>(path, method, data, false).then(resolve, reject); return }
        }
        if (response.statusCode >= 200 && response.statusCode < 300) resolve(response.data as T)
        else reject(new ApiError(body.code || 'REQUEST_FAILED', safeMessages[body.code || ''] || (typeof body.message === 'string' ? body.message : '请求未能完成，请稍后重试'), response.statusCode))
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
  searchActivities: (input: { requestId: string; messages: string[] }) => request<ActivitySearchResult>('/ai/activity-searches', 'POST', input, true, 100000),
  moreActivitySearch: (id: string, cursor: string) => request<ActivitySearchResult>(`/ai/activity-searches/${encodeURIComponent(id)}?cursor=${encodeURIComponent(cursor)}`, 'GET', undefined, true),
  searchImpressions: (id: string, activityIds: string[]) => request<{ ok: boolean }>(`/ai/activity-searches/${encodeURIComponent(id)}/impressions`, 'POST', { activityIds }, true),
  searchView: (id: string, activityId: string) => request<{ sourceToken: string | null }>(`/ai/activity-searches/${encodeURIComponent(id)}/views`, 'POST', { activityId }, true),
  circlePosts: (query: { offset?: number; category?: string } = {}, mine = false) => request<CircleList>(`/circle/${mine ? 'mine' : 'posts'}?offset=${query.offset ?? 0}&limit=20&category=${encodeURIComponent(query.category || 'all')}`, 'GET', undefined, mine ? true : 'none'),
  circlePost: (id: string, manage = false) => request<CirclePost>(`/circle/posts/${encodeURIComponent(id)}${manage ? '/manage' : ''}`, 'GET', undefined, manage ? true : false),
  saveCirclePost: (input: CircleWriteInput, id = '') => request<CirclePost>(`/circle/posts${id ? '/' + encodeURIComponent(id) + '/edit' : ''}`, 'POST', input, true),
  endCirclePost: (id: string) => request<{ ok: boolean }>(`/circle/posts/${encodeURIComponent(id)}/end`, 'POST', {}, true),
  circleIntents: (id: string, offset = 0) => request<CircleIntentList>(`/circle/posts/${encodeURIComponent(id)}/intents?offset=${offset}&limit=20`, 'GET', undefined, true),
  submitCircleIntent: (id: string, phone: string, requestId: string) => request<{ ok: boolean }>(`/circle/posts/${encodeURIComponent(id)}/intents`, 'POST', { phone, requestId }, true),
  uploadCircleImage: (base64: string, mimeType: 'image/png' | 'image/jpeg') => request<CircleImage>('/circle/images', 'POST', { base64, mimeType }, true),
  generateActivityDraft: (idea: string) => request<AiActivityDraftResult>('/ai/activity-drafts', 'POST', { idea }, true, 100000),
  markAttendance: (id: string, registrationId: string) => request<Attendance>(`/activities/${encodeURIComponent(id)}/registrations/${encodeURIComponent(registrationId)}/attendance`, 'POST', {}, true),
  feedbackComments: (id: string, offset = 0, mine = false) => request<CommentList>(`/activities/${encodeURIComponent(id)}/comments${mine ? '/mine' : ''}?offset=${offset}`, 'GET', undefined, mine ? true : 'none'),
  feedbackReviews: (id: string, offset = 0) => request<ReviewList>(`/activities/${encodeURIComponent(id)}/reviews?offset=${offset}`, 'GET', undefined, 'none'),
  feedbackContext: (id: string) => request<FeedbackContext>(`/activities/${encodeURIComponent(id)}/feedback-context`, 'GET', undefined, useSessionStore().token ? true : 'none'),
  reviewStats: (id: string) => request<ReviewStats>(`/activities/${encodeURIComponent(id)}/reviews/stats`, 'GET', undefined, true),
  createComment: (id: string, content: string) => request<{ok: boolean}>(`/activities/${encodeURIComponent(id)}/comments`, 'POST', { content }, true),
  editComment: (id: string, content: string) => request<{ok: boolean}>(`/comments/${encodeURIComponent(id)}/edit`, 'POST', { content }, true),
  deleteComment: (id: string) => request<{ok: boolean}>(`/comments/${encodeURIComponent(id)}/delete`, 'POST', {}, true),
  createReview: (id: string, content: string, score: number) => request<{ok: boolean}>(`/activities/${encodeURIComponent(id)}/reviews`, 'POST', { content, score }, true),
  editReview: (id: string, content: string, score: number) => request<{ok: boolean}>(`/reviews/${encodeURIComponent(id)}/edit`, 'POST', { content, score }, true),
  deleteReview: (id: string) => request<{ok: boolean}>(`/reviews/${encodeURIComponent(id)}/delete`, 'POST', {}, true),
  profileDetails: () => request<ProfileDetails>('/members/me/profile-details', 'GET', undefined, true),
  saveProfileDetails: (input: ProfileDetailsInput) => request<ProfileDetails>('/members/me/profile-details', 'POST', input, true),
  cardSettings: () => request<CardSettings>('/members/me/card-settings', 'GET', undefined, true),
  saveCardSettings: (input: CardSettings) => request<CardSettings>('/members/me/card-settings', 'POST', input, true),
  memberCard: (id: string) => request<MemberCard>(`/members/${encodeURIComponent(id)}/card`, 'GET', undefined, true),
  recordView: (id: string, input: {eventId: string; visitorId: string}) => request<{ok: boolean}>(`/activities/${encodeURIComponent(id)}/views`, 'POST', input, useSessionStore().token ? true : 'none'),
  activityReaders: (id: string, offset = 0) => request<ReadingList>(`/activities/${encodeURIComponent(id)}/readers?offset=${offset}`, 'GET', undefined, 'none'),
  activityViewStats: (id: string) => request<ReadingStats>(`/activities/${encodeURIComponent(id)}/view-stats`, 'GET', undefined, true),
  uploadCover: (base64: string, mimeType: 'image/png' | 'image/jpeg') => request<{coverUrl: string}>('/media/covers', 'POST', { base64, mimeType }, true),
  createActivity: (input: ActivityWriteInput) => request<ManagedActivity>('/activities', 'POST', input, true),
  updateActivity: (id: string, input: ActivityWriteInput) => request<ManagedActivity>(`/activities/${encodeURIComponent(id)}/edit`, 'POST', input, true),
  publishActivity: (id: string) => request<ManagedActivity>(`/activities/${encodeURIComponent(id)}/publish`, 'POST', {}, true),
  managedActivity: (id: string) => request<ManagedActivity>(`/activities/${encodeURIComponent(id)}/manage`, 'GET', undefined, true),
  organizedActivities: (query: ListQuery = {}) => request<ManagedActivityList>(`/members/me/activities?${listQuery(query)}`, 'GET', undefined, true),
  organizerRoster: (id: string, query: ListQuery = {}) => request<OrganizerRoster>(`/activities/${encodeURIComponent(id)}/registrations/manage?${listQuery(query)}`, 'GET', undefined, true),
  cancelActivity: (id: string, reason: string) => request<ManagedActivity>(`/activities/${encodeURIComponent(id)}/cancel`, 'POST', { reason }, true),
  notifications: (query: ListQuery = {}) => request<NotificationList>(`/members/me/notifications?${listQuery(query)}`, 'GET', undefined, true),
  readNotification: (id: string) => request<{ok: boolean}>(`/members/me/notifications/${encodeURIComponent(id)}/read`, 'POST', {}, true),
  login: (code: string, inviteCode?: string) => request<Session>('/auth/wechat/session', 'POST', { code, ...(inviteCode ? { inviteCode } : {}) }, 'none'),
  logout: () => request<{ ok: boolean }>('/auth/session', 'DELETE', undefined, true),
  phone: (code: string) => memberMutation('/members/me/phone', 'POST', { code }),
  profile: (displayName: string) => memberMutation('/members/me/profile', 'POST', { displayName }),
  avatar: (base64: string, mimeType: 'image/png' | 'image/jpeg') => memberMutation('/members/me/avatar', 'POST', { base64, mimeType }),
  activities: (query: { offset?: number; sort?: 'latest' | 'upcoming'; q?: string } = {}) => {
    const params = [`offset=${query.offset ?? 0}`]
    if (query.sort) params.push(`sort=${query.sort}`)
    if (query.q) params.push(`q=${encodeURIComponent(query.q)}`)
    return request<{items: Activity[]; hasMore: boolean}>(`/activities?${params.join('&')}`)
  },
  activity: (id: string) => request<Activity>(`/activities/${encodeURIComponent(id)}`),
  roster: (id: string, query: ListQuery = {}) => request<PublicRoster>(`/activities/${encodeURIComponent(id)}/registrations?${listQuery(query)}`),
  register: (id: string, input: RegistrationInput) => request<Registration>(`/activities/${encodeURIComponent(id)}/registrations`, 'POST', input, true),
  myRegistration: (id: string) => request<Registration>(`/activities/${encodeURIComponent(id)}/registrations/me`, 'GET', undefined, true),
  editRegistration: (id: string, answers: RegistrationInput['answers']) => request<Registration>(`/activities/${encodeURIComponent(id)}/registrations/me/answers`, 'POST', { answers }, true),
  cancel: (id: string) => request<Registration>(`/activities/${encodeURIComponent(id)}/registrations/me/cancel`, 'POST', {}, true),
  registrations: (query: ListQuery = {}) => request<RegistrationList>(`/members/me/registrations?${listQuery(query)}`, 'GET', undefined, true)
}
