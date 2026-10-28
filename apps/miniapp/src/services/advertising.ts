import { computed, ref } from 'vue'
import { errorMessage } from './api'
import type { AdvertisingPublicAdList } from './api/types'

// Keep lightweight metadata for loaded pages; the view mounts only adjacent images.
export function useAdvertising(fetchPage: (offset: number) => Promise<AdvertisingPublicAdList>) {
  const items = ref<AdvertisingPublicAdList['items']>([]), index = ref(0), total = ref(0)
  const loading = ref(false), error = ref(''), hasMore = ref(false), visible = ref(false)
  let generation = 0, offset = 0
  const autoplay = computed(() => visible.value && items.value.length > 1 && !error.value
    && !(hasMore.value && index.value >= items.value.length - 1))
  async function load(append = false) {
    if (!visible.value || (append && (loading.value || !hasMore.value))) return
    const current = append ? generation : ++generation
    if (!append) { items.value = []; index.value = 0; total.value = 0; offset = 0; hasMore.value = false }
    loading.value = true; error.value = ''
    try {
      const result = await fetchPage(offset)
      if (current !== generation || !visible.value) return
      const known = new Set(items.value.map(item => item.id))
      items.value = [...items.value, ...result.items.filter(item => !known.has(item.id))]
      offset += result.items.length
      total.value = result.total
      hasMore.value = result.hasMore
      if (result.hasMore && !result.items.length) throw new Error('图片列表已变化，请重新加载')
    } catch (e) { if (current === generation && visible.value) error.value = errorMessage(e) }
    finally { if (current === generation) loading.value = false }
  }
  function change(value: number) {
    if (!Number.isInteger(value) || value < 0 || value >= items.value.length) return
    index.value = value
    if (value >= items.value.length - 3 && hasMore.value && !error.value) void load(true)
  }
  function imageVisible(value: number) {
    const distance = Math.abs(value - index.value)
    return distance <= 1 || (!hasMore.value && distance === items.value.length - 1)
  }
  function hide() { visible.value = false; generation++; loading.value = false }
  async function show() { visible.value = true; await load(); if (items.value.length && items.value.length <= 3 && hasMore.value && !error.value) void load(true) }
  function retry() { return items.value.length && hasMore.value ? load(true) : load() }
  return { items, index, total, loading, error, hasMore, autoplay, imageVisible, change, show, hide, retry }
}
