import { api, ApiError } from './api'
import { API_BASE_URL } from './api/environment'
const storageKey = `huiju:reading-visitor:${API_BASE_URL}`
// Random analytics identifiers grant no access or identity.
function uuid() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const n = Math.floor(Math.random() * 16)
    return (c === 'x' ? n : (n & 3) | 8).toString(16)
  })
}
function visitor() {
  const stored = uni.getStorageSync(storageKey)
  if (typeof stored === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(stored)) return stored
  const value = uuid()
  uni.setStorageSync(storageKey, value)
  return value
}
export function createReadingVisit() {
  let input = { eventId: uuid(), visitorId: visitor() }
  return {
    async record(id: string, isCurrent: () => boolean) {
      try { await api.recordView(id, { ...input }) }
      catch (e) {
        if (!isCurrent() || !(e instanceof ApiError) || e.code !== 'VISITOR_CHANGED') throw e
        input = { eventId: uuid(), visitorId: uuid() }
        uni.setStorageSync(storageKey, input.visitorId)
        await api.recordView(id, { ...input })
      }
    }
  }
}
