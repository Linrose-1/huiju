import type { Activity, ManagedActivity } from './api/types'
export type MyActivityState = 'ongoing' | 'upcoming' | 'ended' | 'cancelled' | 'draft' | 'removed'
export const activityFilters = [
  { key: 'all', label: '全部' }, { key: 'ongoing', label: '进行中' },
  { key: 'upcoming', label: '未开始' }, { key: 'ended', label: '已结束' },
  { key: 'cancelled', label: '已取消' }, { key: 'draft', label: '草稿' },
  { key: 'removed', label: '已下架' }
] as const
export function myActivityState(activity: Activity | ManagedActivity, registrationStatus?: string, now = Date.now()): MyActivityState {
  if (activity.registrationState === 'removed') return 'removed'
  if ('lifecycle' in activity && activity.lifecycle === 'draft') return 'draft'
  if (activity.registrationState === 'cancelled' || registrationStatus === 'cancelled') return 'cancelled'
  if (Date.parse(activity.endsAt) <= now) return 'ended'
  return Date.parse(activity.startsAt) <= now ? 'ongoing' : 'upcoming'
}
export function myActivityLabel(activity: Activity | ManagedActivity, registrationStatus?: string, now = Date.now()) {
  const state = myActivityState(activity, registrationStatus, now)
  if (state === 'cancelled' && registrationStatus) return activity.registrationState === 'cancelled' ? '活动已取消' : '已取消报名'
  return activityFilters.find(item => item.key === state)!.label
}
