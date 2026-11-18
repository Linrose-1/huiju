import { ref } from 'vue'
import { onShow } from '@dcloudio/uni-app'
import { api, ApiError } from '@/services/api'
import type { PlatformAppearance } from '@/services/api/types'

const defaultTabNames = { circle: '商友圈', activity: '友聚会', assistant: 'i 助手', mine: '我世界' }
export const defaultBrandName = '有聚点'
export const platformBrand = ref<PlatformAppearance>({
  displayName: defaultBrandName, visible: true, logoUrl: null, tabNames: defaultTabNames, partners: [],
})
let refreshing: Promise<void> | null = null

export function refreshPlatformBrand(): Promise<void> {
  if (refreshing) return refreshing
  refreshing = (async () => {
    try {
      const value = await api.platformAppearance()
      platformBrand.value = {
        ...value,
        tabNames: {
          circle: value.tabNames.circle || defaultTabNames.circle,
          activity: value.tabNames.activity || defaultTabNames.activity,
          assistant: value.tabNames.assistant || defaultTabNames.assistant,
          mine: value.tabNames.mine || defaultTabNames.mine,
        },
      }
    } catch (error) {
      platformBrand.value = { ...platformBrand.value, partners: [] }
      if (!(error instanceof ApiError) || error.status !== 404) throw error
      const legacy = await api.platformBrand()
      platformBrand.value = { ...legacy, logoUrl: null, tabNames: defaultTabNames, partners: [] }
    }
  })().finally(() => { refreshing = null })
  return refreshing
}

const appliedNames = Object.values(defaultTabNames)
function applyTabNames() {
  const { circle, activity, assistant, mine } = platformBrand.value.tabNames
  const names = [circle, activity, assistant, mine]
  names.forEach((text, index) => {
    if (appliedNames[index] === text || typeof uni.setTabBarItem !== 'function') return
    uni.setTabBarItem({ index, text, success: () => { appliedNames[index] = text }, fail: () => undefined })
  })
}

export function usePlatformBrand() {
  onShow(() => refreshPlatformBrand().catch(() => undefined).then(applyTabNames))
  return platformBrand
}
