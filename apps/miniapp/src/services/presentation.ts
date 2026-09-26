import type { Activity, Registration } from './api/types'
export function dateTime(value: string): string {
  const date = new Date(Date.parse(value) + 8 * 60 * 60 * 1000)
  if (!Number.isFinite(date.getTime())) return '时间待更新'
  const pad = (v: number) => String(v).padStart(2, '0')
  return `${date.getUTCFullYear()}.${pad(date.getUTCMonth() + 1)}.${pad(date.getUTCDate())} ${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}`
}
export function fee(activity: Activity) { return activity.feeType === 'paid' ? `¥${((activity.feeAmountCents || 0) / 100).toFixed(2)}` : '免费' }
export function activityTimeRange(startsAt: string, endsAt: string): string {
  const start = dateTime(startsAt)
  const end = dateTime(endsAt)
  if (start === '时间待更新' || end === '时间待更新') return '时间待更新'
  return `${start} – ${start.slice(0, 10) === end.slice(0, 10) ? end.slice(11) : end}`
}
export function registrationStatus(activity: Activity, registration: Registration) {
  if (activity.registrationState === 'removed') return { title: '活动已下架', description: '活动暂不可报名或修改答案，请留意后续状态。', tone: 'warning', icon: 'info', color: '#b77925' }
  if (activity.registrationState === 'cancelled') return { title: '活动已取消', description: '活动已取消，原报名记录保留。', tone: 'muted', icon: 'closeempty', color: '#74817c' }
  if (registration.status === 'cancelled') return { title: '已取消报名', description: '名额已释放，再次报名需重新提交。', tone: 'muted', icon: 'closeempty', color: '#74817c' }
  return { title: '报名成功', description: '您已成功报名，请按时参加活动。', tone: 'success', icon: 'checkmarkempty', color: '#169761' }
}
export function stateText(state: Activity['registrationState']) {
  return ({ open: '报名中', closed: '已截止', full: '已报满', cancelled: '活动已取消', removed: '活动已下架' })[state] || '暂不可报名'
}
export function canEdit(activity: Activity, registration: Registration) { return registration.status === 'active' && !['cancelled', 'removed'].includes(activity.registrationState) && Date.now() < Date.parse(activity.registrationDeadline) }
export function canCancel(activity: Activity, registration: Registration) { return registration.status === 'active' && Date.now() < Date.parse(activity.startsAt) }
export const feeNotice = '本活动为收费活动，请联系活动发起人了解具体收费事宜'
export const feeDisclaimer = '会聚不参与本活动的收费、收款和退款，相关费用请直接与活动发起人确认'

export function upcomingActivities(items: Activity[], now = Date.now()): Activity[] {
  return items.filter(item => Date.parse(item.startsAt) > now).sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt))
}
