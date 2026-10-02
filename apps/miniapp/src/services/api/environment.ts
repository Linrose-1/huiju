const configured = (import.meta as unknown as { env: Record<string, string> }).env.VITE_API_BASE_URL
export const LOCAL_TEST = (import.meta as unknown as { env: { HUIJU_LOCAL_TEST: boolean } }).env.HUIJU_LOCAL_TEST === true
const circleReview = (import.meta as unknown as { env: { HUIJU_CIRCLE_REVIEW: boolean } }).env.HUIJU_CIRCLE_REVIEW === true
if (circleReview && configured && !/^http:\/\/127\.0\.0\.1:301[67]\/api\/v1$/.test(configured)) throw new Error('学友圈验收只能连接本机隔离入口 3016 / 3017')
export const API_BASE_URL = (circleReview ? configured || 'http://127.0.0.1:3016/api/v1' : LOCAL_TEST ? 'http://127.0.0.1:3001/api/v1' : configured || 'http://127.0.0.1:3000/api/v1').replace(/\/$/, '')
export function mediaUrl(url: string | null | undefined): string {
  if (!url) return ''
  if (/^https?:\/\//.test(url) || url.startsWith('data:')) return url
  if (url.startsWith('/static/')) return url
  return API_BASE_URL.replace(/\/api\/v1$/, '') + '/' + url.replace(/^\//, '')
}
