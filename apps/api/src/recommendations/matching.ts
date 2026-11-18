import { fail } from '../common/errors.js'
import type { ParsedSearch, PublicCandidate } from './types.js'

export const MAX_RECOMMENDATION_CANDIDATES = 60
export const MAX_RECOMMENDATION_TEXT_CHARS = 60000

export function containsTheme(text: string, theme: string): boolean {
  return text.toLowerCase().includes(theme.toLowerCase())
}

export function matchesHardConditions(candidate: PublicCandidate, parsed: ParsedSearch): boolean {
  const { location, time, feeType, themes } = parsed.hard
  const start = Date.parse(candidate.startsAt)
  return !parsed.clarify && (!location || candidate.location.includes(location.value))
    && (!time || (start >= Date.parse(time.from) && start < Date.parse(time.to)))
    && (!feeType || candidate.feeType === feeType.value)
    && (!themes || themes.every(theme => containsTheme(candidate.title, theme.value) || containsTheme(candidate.description, theme.value)))
}

// Rebuild every object, including its identifier: callers may pass richer database rows.
export function publicCandidatePayload(candidates: PublicCandidate[]) {
  const projected = candidates.map((item, index) => ({
    id: `c${index + 1}`, title: item.title, description: item.description, location: item.location,
    startsAt: item.startsAt, endsAt: item.endsAt, feeType: item.feeType, feeAmountCents: item.feeAmountCents,
  }))
  if (projected.length > MAX_RECOMMENDATION_CANDIDATES || JSON.stringify(projected).length > MAX_RECOMMENDATION_TEXT_CHARS) {
    fail('RECOMMENDATION_TOO_BROAD', '候选活动较多，请补充时间、地点或主题条件', 400)
  }
  return projected
}

export function preferenceDifferences(candidate: PublicCandidate, parsed: ParsedSearch): string[] {
  return parsed.preferences.map(preference => {
    if (preference.kind === 'feeType') {
      return candidate.feeType === preference.value ? '' : candidate.feeType === 'paid' ? '该活动收费，未满足免费偏好' : '该活动免费，与收费偏好不同'
    }
    if (preference.kind === 'location' && candidate.location.includes(preference.value)) return ''
    if (preference.kind === 'theme' && (containsTheme(candidate.title, preference.value) || containsTheme(candidate.description, preference.value))) return ''
    return `请核对偏好“${preference.evidence}”，活动公开信息尚不能确认满足`
  }).filter(Boolean)
}
