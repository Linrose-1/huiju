import { reactive } from 'vue'
import type { components } from '../../../../packages/api-client/src/generated'
import { client, options, session, unwrap } from './admin'

export const brand = reactive({ displayName: '有聚点', visible: true })
let generation = 0
export function acceptBrand(value: components['schemas']['PublicBrandDto']) {
  generation++
  brand.displayName = value.displayName
  brand.visible = value.visible
}
export async function refreshBrand() {
  const current = ++generation
  const result = await unwrap(client.GET('/api/v1/platform/brand'))
  if (current === generation) acceptBrand(result)
}
export const brandApi = {
  get: () => unwrap(client.GET('/api/v1/admin/platform/brand', options())),
  save: (body: components['schemas']['BrandInput']) => unwrap(client.PUT('/api/v1/admin/platform/brand', {
    ...options(), params: { header: { 'X-CSRF-Token': session.csrfToken } }, body,
  })),
}
