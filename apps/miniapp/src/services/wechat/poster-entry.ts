import { api } from '@/services/api'
import { useSessionStore } from '@/stores/session'

type Destination = { activityId: string; inviteCode: string }
let entryScene = '', resolved: Destination | null = null
let pending: Promise<Destination> | null = null
let generation = 0
export function posterScene(value: unknown): string {
  if (typeof value !== 'string') return ''
  try { const scene = decodeURIComponent(value); return /^p[a-f0-9]{24}$/.test(scene) ? scene : '' } catch { return '' }
}
// App starts resolution synchronously before any page can establish its first identity.
export function preparePosterEntry(options?: { path?: string; query?: Record<string, unknown> }) {
  const raw = options?.query?.scene
  const scene = options?.path?.replace(/^\//, '') === 'pages/activity/detail' && raw !== undefined ? (posterScene(raw) || '!invalid') : ''
  if (entryScene !== scene) { generation++; entryScene = scene; resolved = null; pending = null }
}
export async function resolvePosterEntry(value: unknown): Promise<Destination> {
  const scene = posterScene(value)
  if (!scene) throw new Error('海报链接无效，请从活动列表重新进入')
  if (entryScene !== scene) { generation++; entryScene = scene; resolved = null; pending = null }
  if (resolved) { useSessionStore().captureInvite(resolved.inviteCode); return resolved }
  if (pending) return pending
  const current = generation
  const request = api.resolveActivityPoster(scene).then(result => {
    if (entryScene !== scene || generation !== current) throw new Error('分享入口已变更，请重新打开活动')
    resolved = result
    useSessionStore().captureInvite(result.inviteCode)
    return result
  }).finally(() => { if (pending === request) pending = null })
  pending = request
  return request
}
export async function awaitPosterEntry() {
  if (entryScene) await resolvePosterEntry(entryScene)
}
export function releasePosterEntry(value: unknown) {
  if (value === undefined || entryScene !== (posterScene(value) || '!invalid')) return
  generation++; entryScene = ''; resolved = null; pending = null
}
