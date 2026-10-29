import { fail } from './common.js'

export type ActivityImageData = string[] | { urls: string[]; coverSourceUrl: string | null }
type Images = { coverUrl?: string | null; imageUrls?: ActivityImageData | null }

export function activityImages(activity: Images): string[] {
  const stored = activity.imageUrls
  return (Array.isArray(stored) ? stored : stored?.urls) ?? (activity.coverUrl ? [activity.coverUrl] : [])
}

export function activityCoverSource(activity: Images): string | null {
  if (!activity.coverUrl) return null
  const stored = activity.imageUrls
  return (stored && !Array.isArray(stored) ? stored.coverSourceUrl : null) ?? activity.coverUrl
}

export function activityImageValues(input: { coverUrl?: string | null; imageUrls?: string[] | null; coverSourceUrl?: string | null }) {
  let urls: string[]
  if (input.imageUrls !== undefined) {
    if (!Array.isArray(input.imageUrls) || input.imageUrls.length > 3
      || input.imageUrls.some(url => typeof url !== 'string' || !url || url.length > 2048)
      || new Set(input.imageUrls).size !== input.imageUrls.length) fail('INVALID_ACTIVITY_IMAGES', '活动图片最多3张，不能重复或留空')
    if (input.coverUrl !== undefined && input.coverUrl !== (input.imageUrls[0] ?? null)) fail('INVALID_ACTIVITY_IMAGES', '第一张活动图片须与封面一致')
    urls = input.imageUrls
  } else {
    urls = input.coverUrl ? [input.coverUrl] : []
  }
  const coverUrl = urls[0] ?? null
  const coverSourceUrl = coverUrl ? input.coverSourceUrl ?? coverUrl : null
  if (coverSourceUrl !== null && (typeof coverSourceUrl !== 'string' || !coverSourceUrl || coverSourceUrl.length > 2048)) fail('INVALID_COVER', '请选择有效的封面原图')
  return { coverUrl, imageUrls: { urls, coverSourceUrl } }
}
