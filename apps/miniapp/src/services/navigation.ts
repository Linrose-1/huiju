import { refreshMember, ApiError } from '@/services/api'
import { bootstrapIdentity } from '@/services/wechat'
import { useSessionStore } from '@/stores/session'
export const routes = {
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
export async function requireProfile(returnTo: string): Promise<boolean> {
  const store = useSessionStore()
  if (!store.token) {
    try { await bootstrapIdentity() }
    catch { loginPage(returnTo); return false }
  }
  try {
    const member = await refreshMember()
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
      && ['id', 'edit'].every(key => (previous.options?.[key] || '') === (expected[key] || ''))
    if (sameContext) { uni.navigateBack(); return }
    if ([routes.activity, routes.assistant, routes.mine].includes(path)) uni.switchTab({ url: path })
    else navigate(returnTo, true)
  } else uni.switchTab({ url: routes.activity })
}
