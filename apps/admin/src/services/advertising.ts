import type { components } from '../../../../packages/api-client/src/generated'
import { client, options, session, unwrap } from './admin'
export type AdvertisingAd = components['schemas']['AdvertisingAdDto']
export type AdvertisingIntroduction = components['schemas']['AdvertisingIntroductionDto']
export type AdvertisingImage = components['schemas']['AdvertisingImageDto']
export type AdInput = components['schemas']['AdvertisingAdInput']
export type IntroductionInput = components['schemas']['AdvertisingIntroductionInput']
export type Placement = 'activity' | 'circle' | 'assistant'
export type AdStatus = 'draft' | 'published' | 'offline'
export type ListFilter = { q: string; offset: number; limit: number; status: 'all' | AdStatus }
const writeOptions = () => ({ ...options(), params: { header: { 'X-CSRF-Token': session.csrfToken } } })
export const advertisingApi = {
  ads: (query: ListFilter & { placement: 'all' | Placement }) => unwrap(client.GET('/api/v1/admin/advertising/ads', { ...options(), params: { query } })),
  createAd: (body: AdInput) => unwrap(client.POST('/api/v1/admin/advertising/ads', { ...writeOptions(), body })),
  updateAd: (id: string, body: AdInput & { version: number }) => unwrap(client.PUT('/api/v1/admin/advertising/ads/{id}', { ...options(), params: { path: { id }, header: { 'X-CSRF-Token': session.csrfToken } }, body })),
  adStatus: (id: string, version: number, status: 'published' | 'offline') => unwrap(client.POST('/api/v1/admin/advertising/ads/{id}/status', { ...options(), params: { path: { id }, header: { 'X-CSRF-Token': session.csrfToken } }, body: { version, status } })),
  introductions: (query: ListFilter) => unwrap(client.GET('/api/v1/admin/advertising/introductions', { ...options(), params: { query } })),
  introduction: (id: string) => unwrap(client.GET('/api/v1/admin/advertising/introductions/{id}', { ...options(), params: { path: { id } } })),
  createIntroduction: (body: IntroductionInput) => unwrap(client.POST('/api/v1/admin/advertising/introductions', { ...writeOptions(), body })),
  updateIntroduction: (id: string, body: IntroductionInput & { version: number }) => unwrap(client.PUT('/api/v1/admin/advertising/introductions/{id}', { ...options(), params: { path: { id }, header: { 'X-CSRF-Token': session.csrfToken } }, body })),
  introductionStatus: (id: string, version: number, status: 'published' | 'offline') => unwrap(client.POST('/api/v1/admin/advertising/introductions/{id}/status', { ...options(), params: { path: { id }, header: { 'X-CSRF-Token': session.csrfToken } }, body: { version, status } })),
  background: () => unwrap(client.GET('/api/v1/admin/advertising/background', options())),
  saveBackground: (imageId: string | null, version: number) => unwrap(client.PUT('/api/v1/admin/advertising/background', { ...writeOptions(), body: { imageId, version } })),
  upload: (body: { base64: string; mimeType: 'image/png' | 'image/jpeg'; purpose: 'source' | 'wide' | 'tall' | 'detail'; sourceImageId?: string }) => unwrap(client.POST('/api/v1/admin/advertising/images', { ...writeOptions(), body })),
}
