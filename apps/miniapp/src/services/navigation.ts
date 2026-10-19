import { ApiError } from '@/services/api'
import { bootstrapIdentity } from '@/services/wechat'
import { useSessionStore } from '@/stores/session'
export const routes = {
  terms: '/pages/legal/terms', privacy: '/pages/legal/privacy', contentSettings: '/pages/platform/content',
  circle: '/pages/circle/index', circleDetail: '/pages/circle/detail', circleEditor: '/pages/circle/editor', circleMine: '/pages/circle/mine', circleIntents: '/pages/circle/intents',
  feedback: '/pages/activity/feedback',
  profile: '/pages/member/profile', cardSettings: '/pages/member/card-settings', memberCard: '/pages/member/card',
  invitation: '/pages/invitation/index',
  activityDraft: '/pages/assistant/activity-draft',
  activitySearch: '/pages/assistant/activity-search',
  editor: '/pages/activity/editor', manage: '/pages/activity/manage', organizedActivities: '/pages/activity/organized', notifications: '/pages/notification/index',
  activity: '/pages/activity/index', assistant: '/pages/assistant/index', mine: '/pages/mine/index',
  login: '/pages/login/index', detail: '/pages/activity/detail', form: '/pages/registration/form', result: '/pages/registration/detail', registrations: '/pages/registration/index'
}
let navigating = false
export function navigate(url: string, replace = false) {
  if (navigating) return
  navigating = true
  const options = { url, complete: () => { navigating = false } }
  if (replace) uni.redirectTo(options)
  else uni.navigateTo(options)
}
export function loginPage(returnTo = '') {
  navigate(routes.login + (returnTo ? `?returnTo=${encodeURIComponent(returnTo)}` : ''))
}
export async function requireLogin(): Promise<boolean> {
  await bootstrapIdentity()
  return !!useSessionStore().member?.profileComplete
}
export function searchLogin() { loginPage(routes.activitySearch) }
export async function requireProfile(returnTo: string): Promise<boolean> {
  try {
    await bootstrapIdentity()
    const member = useSessionStore().member
    if (!member?.profileComplete) { loginPage(returnTo); return false }
    return true
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) { loginPage(returnTo); return false }
    throw error
  }
}
export function unavailable(feature: string) { uni.showModal({ title: feature, content: '这项功能暂未开放，请先浏览活动。', showCancel: false }) }
export function finishProfile(returnTo: string) {
  const allowed = Object.values(routes).filter(path => path !== routes.login)
  if (returnTo && allowed.some(path => returnTo === path || returnTo.startsWith(path + '?'))) {
    const [path, query = ''] = returnTo.split('?')
    const previous = getCurrentPages().slice(-2)[0] as { route?: string; options?: Record<string, string> } | undefined
    const expected = Object.fromEntries(query.split('&').filter(Boolean).map(part => {
      const [key, ...value] = part.split('=')
      return [key, value.join('=')]
    }))
    const sameContext = previous && '/' + previous.route === path
      && ['id', 'edit', 'searchId', 'recommendationToken'].every(key => encodeURIComponent(previous.options?.[key] || '') === (expected[key] || ''))
    if (sameContext) { uni.navigateBack(); return }
    if ([routes.activity, routes.circle, routes.assistant, routes.mine].includes(path)) uni.switchTab({ url: path })
    else navigate(returnTo, true)
  } else uni.switchTab({ url: routes.activity })
}
