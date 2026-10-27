import { ref, watch, type Ref } from 'vue'
import { useSessionStore } from '@/stores/session'
import { errorMessage, ApiError } from '@/services/api'
import { mediaUrl } from '@/services/api/environment'
export const circleCategories = [{ key: 'park', label: '园区资源' }, { key: 'operation', label: '运营资源' }, { key: 'service', label: '服务资源' }, { key: 'store', label: '门店' }] as const
export const circleSubtypes = [{ key: 'rent', label: '出租' }, { key: 'sale', label: '出售' }, { key: 'transfer', label: '转让' }, { key: 'seek_rent', label: '寻租' }, { key: 'buy', label: '购买' }] as const
export function categoryLabel(key: string) { return circleCategories.find(x => x.key === key)?.label || '' }
export function subtypeLabel(key: string | null) { return circleSubtypes.find(x => x.key === key)?.label || '' }
export function stateLabel(state: string) { return ({ open: '公开中', ended: '已结束', removed: '已下架' } as Record<string, string>)[state] || '' }
export function circleTime(value: string) {
  const time = new Date(Date.parse(value) + 8 * 3600000)
  if (!Number.isFinite(time.getTime())) return ''
  return `${time.getUTCFullYear()}年${time.getUTCMonth() + 1}月${time.getUTCDate()}日 ${String(time.getUTCHours()).padStart(2, '0')}:${String(time.getUTCMinutes()).padStart(2, '0')}`
}
export function newRequestId() { return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => { const r = Math.floor(Math.random() * 16); return (c === 'x' ? r : (r & 3) | 8).toString(16) }) }
export function useCircleList<T extends { id: string }>(fetchPage: (offset: number) => Promise<{ items: T[]; hasMore: boolean }>) {
  const session = useSessionStore(), items = ref<T[]>([]) as Ref<T[]>
  const loading = ref(false), loadingMore = ref(false), error = ref(''), moreError = ref(''), hasMore = ref(false)
  let version = 0, offset = 0
  function clear() { version++; items.value = []; offset = 0; loading.value = false; loadingMore.value = false; error.value = ''; moreError.value = ''; hasMore.value = false }
  async function load(append = false) {
    if (append && (loading.value || loadingMore.value || !hasMore.value || moreError.value)) return
    if (!append) clear()
    const current = version, token = session.token, epoch = session.epoch
    if (append) loadingMore.value = true; else loading.value = true
    const valid = () => current === version && token === session.token && epoch === session.epoch
    try {
      const page = await fetchPage(offset)
      if (!valid()) return
      const seen = new Set(items.value.map(x => x.id))
      items.value = [...items.value, ...page.items.filter(x => !seen.has(x.id) && !!seen.add(x.id))]
      offset += page.items.length; hasMore.value = page.hasMore
    } catch (e) { if (valid()) { if (append) moreError.value = errorMessage(e); else error.value = errorMessage(e) } }
    finally { if (valid()) { loading.value = false; loadingMore.value = false }; uni.stopPullDownRefresh() }
  }
  function retryMore() { moreError.value = ''; return load(true) }
  watch(() => [session.token, session.epoch], clear, { flush: 'sync' })
  return { items, loading, loadingMore, error, moreError, hasMore, load, clear, retryMore }
}
export async function circleImagePreview(url: string, privateImage = false): Promise<string> {
  if (!privateImage) return mediaUrl(url)
  const session = useSessionStore(), token = session.token, epoch = session.epoch
  return new Promise((yes, no) => uni.downloadFile({ url: mediaUrl(url), header: { Authorization: 'Bearer ' + token },
    success: response => {
      if (token !== session.token || epoch !== session.epoch) { no(new ApiError('STALE_REQUEST', '身份已变更')); return }
      if (response.statusCode === 200) yes(response.tempFilePath); else no(new Error('图片加载失败，请重试'))
    }, fail: () => no(new Error('图片加载失败，请重试')) }))
}
