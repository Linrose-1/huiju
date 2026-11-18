import { reactive } from 'vue'
import type { components } from '../../../../packages/api-client/src/generated'
import { AdminRequestError, client, options, session, unwrap } from './admin'

type PublicBrand = components['schemas']['PublicBrandDto']
export type BrandAppearance = NonNullable<components['schemas']['BrandInput']['appearance']>
export type BrandImageInput = { base64: string; mimeType: 'image/png' | 'image/jpeg'; purpose: 'logo' | 'code' }
export const brand = reactive({ displayName: '有聚点', visible: true, logoUrl: null as string | null })
let generation = 0
export function acceptBrand(value: PublicBrand & { appearance?: BrandAppearance; logoUrl?: string | null }) {
  generation++
  brand.displayName = value.displayName
  brand.visible = value.visible
  const logo = value.appearance?.logoImageId
  brand.logoUrl = value.logoUrl ?? (logo ? '/api/v1/platform/appearance/images/' + encodeURIComponent(logo) : null)
}
export async function refreshBrand() {
  const current = ++generation
  const result = await unwrap(client.GET('/api/v1/platform/appearance')).catch(error => {
    if (error instanceof AdminRequestError && error.status === 404) return unwrap(client.GET('/api/v1/platform/brand'))
    throw error
  })
  if (current === generation) acceptBrand(result)
}
export const brandApi = {
  get: () => unwrap(client.GET('/api/v1/admin/platform/brand', options())),
  save: (body: components['schemas']['BrandInput']) => unwrap(client.PUT('/api/v1/admin/platform/brand', {
    ...options(), params: { header: { 'X-CSRF-Token': session.csrfToken } }, body,
  })),
  uploadImage: (body: BrandImageInput) => unwrap(client.POST('/api/v1/admin/platform/brand/images', {
    ...options(), params: { header: { 'X-CSRF-Token': session.csrfToken } }, body,
  })),
  imagePreview: (id: string) => '/api/v1/admin/platform/brand/images/' + encodeURIComponent(id),
}
