const configured = (import.meta as unknown as { env: Record<string, string> }).env.VITE_API_BASE_URL
export const LOCAL_TEST = (import.meta as unknown as { env: { HUIJU_LOCAL_TEST: boolean } }).env.HUIJU_LOCAL_TEST === true
export const API_BASE_URL = (LOCAL_TEST ? 'http://127.0.0.1:3001/api/v1' : configured || 'http://127.0.0.1:3000/api/v1').replace(/\/$/, '')
export function mediaUrl(url: string | null | undefined): string {
  if (!url) return ''
  if (/^https?:\/\//.test(url) || url.startsWith('data:')) return url
  if (url.startsWith('/static/')) return url
  return API_BASE_URL.replace(/\/api\/v1$/, '') + '/' + url.replace(/^\//, '')
}
