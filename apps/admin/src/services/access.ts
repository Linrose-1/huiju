import { session } from './admin'

export function allowedRoute(path: string) {
  if (!session.account) return path === '/login' ? undefined : '/login'
  if (path === '/login') return '/analytics'
  if (path === '/accounts' && session.account.role !== 'super_admin') return '/analytics'
  return undefined
}
