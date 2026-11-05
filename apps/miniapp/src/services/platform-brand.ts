import { ref } from 'vue'
import { onHide, onShow, onUnload } from '@dcloudio/uni-app'
import { api } from '@/services/api'

export function usePlatformBrand() {
  const brand = ref({ displayName: '有聚点', visible: true })
  let generation = 0
  async function refresh() {
    const current = ++generation
    try {
      const value = await api.platformBrand()
      if (current === generation) brand.value = value
    } catch { /* Keep the last public value; branding must not block browsing. */ }
  }
  onShow(refresh)
  onHide(() => { generation++ })
  onUnload(() => { generation++ })
  return brand
}
