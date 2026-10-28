import { readFileSync } from 'node:fs'
import ts from 'typescript'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as vue from 'vue'
import { session } from '../src/services/admin'
import { useRequestScope } from '../src/services/request-scope'
const scopes: vue.EffectScope[] = []
const network = { ads: vi.fn(), introductions: vi.fn(), createAd: vi.fn(), updateAd: vi.fn() }
function page(path: string, exported: string, props: object = {}) {
  const source = readFileSync(new URL(path, import.meta.url), 'utf8').match(/<script setup lang="ts">([\s\S]*?)<\/script>/)![1]
  const code = ts.transpileModule(`${source}\nexport { ${exported} };`, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
  const scope = vue.effectScope(); scopes.push(scope); const result: Record<string, unknown> = {}
  scope.run(() => new Function('require', 'exports', 'defineProps', 'defineEmits', 'defineExpose', 'window', code)((name: string) => {
    if (name === 'vue') return { ...vue, onMounted() {}, onBeforeUnmount() {} }
    if (name === 'vue-router') return { onBeforeRouteLeave() {} }
    if (name === 'element-plus') return { ElMessage: { success() {} }, ElMessageBox: { confirm: async () => true } }
    if (name.endsWith('/advertising')) return { advertisingApi: network }
    if (name.endsWith('/admin')) return { errorMessage: (e: Error) => e.message, formatDate: String }
    if (name.endsWith('/request-scope')) return { useRequestScope }
    return {}
  }, result, () => props, () => vi.fn(), () => {}, { addEventListener() {}, removeEventListener() {} }))
  return result
}
beforeEach(() => { vi.resetAllMocks(); session.epoch++ })
afterEach(() => scopes.splice(0).forEach(s => s.stop()))
describe('advertising page request boundaries', () => {
  it('maps activity and assistant to tall images and circle to wide images without previewing deselected placements', () => {
    const p = page('../src/modules/advertising/AdEditor.vue', 'form,needsWide,needsTall,previewImage', { initial: { placements: ['activity'], wideImageUrl: '/wide.jpg', tallImageUrl: '/tall.jpg' } }) as { form: vue.Ref<{ placements: string[] }>; needsWide: vue.ComputedRef<boolean>; needsTall: vue.ComputedRef<boolean>; previewImage: vue.ComputedRef<{ url: string; ratio: string } | null> }
    for (const placement of ['activity', 'assistant']) {
      p.form.value.placements = [placement]
      expect(p.needsTall.value).toBe(true); expect(p.needsWide.value).toBe(false)
      expect(p.previewImage.value).toEqual({ url: '/tall.jpg', ratio: '2' })
    }
    p.form.value.placements = ['circle']
    expect(p.needsWide.value).toBe(true); expect(p.needsTall.value).toBe(false)
    expect(p.previewImage.value).toEqual({ url: '/wide.jpg', ratio: '3' })
    p.form.value.placements = []
    expect(p.previewImage.value).toBeNull()
  })
  it('uses applied filters for subsequent pages, avoiding offset against an unsubmitted query', async () => {
    network.ads.mockResolvedValue({ items: [], total: 45, hasMore: true })
    const p = page('../src/modules/advertising/AdvertisingPage.vue', 'load,q,offset') as { load(reset?: boolean): Promise<void>; q: vue.Ref<string>; offset: vue.Ref<number> }
    p.q.value = '青禾'; await p.load(true); p.q.value = '未提交'; p.offset.value = 20; await p.load()
    expect(network.ads.mock.calls[1]![0]).toMatchObject({ q: '青禾', offset: 20 })
  })
  it('ignores a prior response after a later filter request', async () => {
    let finish!: (value: unknown) => void
    network.ads.mockImplementationOnce(() => new Promise(resolve => { finish = resolve })).mockResolvedValueOnce({ items: [{ id: 'new' }], total: 1 })
    const p = page('../src/modules/advertising/AdvertisingPage.vue', 'load,ads') as { load(reset?: boolean): Promise<void>; ads: vue.Ref<{ id: string }[]> }
    const first = p.load(true); await p.load(true); finish({ items: [{ id: 'stale' }], total: 1 }); await first
    expect(p.ads.value.map(x => x.id)).toEqual(['new'])
  })
  it('retains the previous page and exposes an error on a failed load', async () => {
    network.ads.mockResolvedValueOnce({ items: [{ id: 'existing' }], total: 22 }).mockRejectedValueOnce(new Error('network'))
    const p = page('../src/modules/advertising/AdvertisingPage.vue', 'load,ads,error') as { load(): Promise<void>; ads: vue.Ref<{ id: string }[]>; error: vue.Ref<string> }
    await p.load(); await p.load(); expect(p.ads.value[0]!.id).toBe('existing'); expect(p.error.value).toBe('network')
  })
  it('locks duplicate saves and keeps draft fields when saving fails', async () => {
    let reject!: (reason: Error) => void
    network.createAd.mockImplementation(() => new Promise((_resolve, fail) => { reject = fail }))
    const p = page('../src/modules/advertising/AdEditor.vue', 'save,form,saving,error') as { save(): Promise<void>; form: vue.Ref<{ title: string; introductionId: string }>; saving: vue.Ref<boolean>; error: vue.Ref<string> }
    p.form.value.title = '广告'; p.form.value.introductionId = 'intro'; const first = p.save(); await p.save(); expect(network.createAd).toHaveBeenCalledTimes(1); reject(new Error('conflict')); await first
    expect(p.form.value.title).toBe('广告'); expect(p.saving.value).toBe(false); expect(p.error.value).toBe('conflict')
  })
})
