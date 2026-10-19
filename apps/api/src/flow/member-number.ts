import { fail } from './common.js'

export function memberInviteCode(memberNumber: string, legacyCode: string) {
  return /^HJ[0-9]{14}$/.test(memberNumber) ? 'HJYQM' + memberNumber.slice(2) : legacyCode
}

export function inviteMemberNumber(inviteCode: string) {
  return /^HJYQM[0-9]{14}$/.test(inviteCode) ? 'HJ' + inviteCode.slice(5) : null
}

export function memberNumberPrefix(now: Date) {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now)
  const part = (type: string) => parts.find(item => item.type === type)!.value
  return 'HJ' + part('year') + part('month') + part('day')
}

export function nextMemberNumber(prefix: string, previous?: string) {
  const sequence = previous ? Number(previous.slice(prefix.length)) + 1 : 1
  if (!Number.isInteger(sequence) || sequence < 1 || sequence > 999999) {
    fail('MEMBER_NUMBER_EXHAUSTED', '今日注册名额已达上限，请明日再试', 503)
  }
  return prefix + String(sequence).padStart(6, '0')
}
