import { session } from './admin'

export function allowedRoute(path: string) {
  if (!session.account) return path === '/login' ? undefined : '/login'
  if (path === '/login') return '/feedback'
  if (path === '/accounts' && session.account.role !== 'super_admin') return '/feedback'
  return undefined
}
