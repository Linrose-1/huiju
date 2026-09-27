import type { CardSettings, Member, MemberCard, ProfileDetails } from './api/types'

export const cardFields = [
  { key: 'realName', setting: 'showRealName', label: '真实姓名', icon: 'person' },
  { key: 'email', setting: 'showEmail', label: '邮箱', icon: 'email' },
  { key: 'boundPhone', setting: 'showBoundPhone', label: '绑定手机号', icon: 'phone' },
  { key: 'hometown', setting: 'showHometown', label: '家乡', icon: 'location' },
  { key: 'bio', setting: 'showBio', label: '个人简介', icon: 'compose' },
  { key: 'resources', setting: 'showResources', label: '我有资源', icon: 'wallet' },
  { key: 'needs', setting: 'showNeeds', label: '我需资源', icon: 'heart' }
] as const

export function emptySettings(): CardSettings {
  return { showRealName: false, showEmail: false, showBoundPhone: false, showHometown: false, showBio: false, showResources: false, showNeeds: false }
}

// Preview stays in page memory and uses the same field whitelist as the public card.
export function previewCard(member: Member, details: ProfileDetails, settings: CardSettings): MemberCard {
  const result: MemberCard = { avatarUrl: member.profileComplete ? member.avatarUrl : null, displayName: member.profileComplete ? member.displayName! : '会员' + member.memberNumber }
  for (const field of cardFields) {
    if (settings[field.setting] === true) result[field.key] = field.key === 'boundPhone' ? member.boundPhone : details[field.key]
  }
  return result
}
