import type { Member } from './identity.js'
import type { FellowTag } from './fellows-dto.js'

type MatchingProfile = Pick<Member, 'industry' | 'hometownCityCode' | 'schools'>

function key(value: string) {
  return value.normalize('NFKC').trim().replace(/\s+/g, ' ').toLowerCase()
}

export function uniqueSchools(schools: string[]) {
  const names = new Map<string, string>()
  for (const school of schools) {
    const name = key(school)
    if (name && !names.has(name)) names.set(name, school.trim())
  }
  return [...names.values()]
}

export function cityCode(code: string) {
  if (!code) return null
  const province = code.slice(0, 2)
  if (['11', '12', '31', '50'].includes(province)) return province + '0000'
  if (code.slice(2, 4) === '00') return null
  // Directly administered county-level cities have no common prefecture.
  if (code.slice(2, 4) === '90') return code.endsWith('00') ? null : code
  return code.slice(0, 4) + '00'
}

export function fellowTags(viewer: MatchingProfile, invitee: MatchingProfile): FellowTag[] {
  const tags: FellowTag[] = []
  const industry = key(viewer.industry ?? '')
  if (industry && industry === key(invitee.industry ?? '')) tags.push('同行')
  if (viewer.hometownCityCode && viewer.hometownCityCode === invitee.hometownCityCode) tags.push('同乡')
  const schools = new Set((viewer.schools ?? []).map(key).filter(Boolean))
  if (invitee.schools?.some(school => schools.has(key(school)))) tags.push('同校')
  return tags
}
