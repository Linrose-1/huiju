const configured = (import.meta as unknown as { env: Record<string, string> }).env.VITE_API_BASE_URL
export const API_BASE_URL = (configured || 'http://127.0.0.1:3000/api/v1').replace(/\/$/, '')
export function mediaUrl(url: string | null | undefined): string {
  if (!url) return ''
  if (/^https?:\/\//.test(url) || url.startsWith('data:')) return url
  if (url.startsWith('/static/')) return url
  return API_BASE_URL.replace(/\/api\/v1$/, '') + '/' + url.replace(/^\//, '')
}
