import { readFileSync } from 'node:fs'
import ts from 'typescript'
import * as vue from 'vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AdminRequestError, session } from '../src/services/admin'
import { useRequestScope } from '../src/services/request-scope'
import { allowedRoute } from '../src/services/access'

const scopes: vue.EffectScope[] = []
beforeEach(() => { session.epoch++; session.account = { id: 'admin', role: 'super_admin', username: 'admin', displayName: '管理员', active: true, mustChangePassword: false, createdAt: '' } })
afterEach(() => { scopes.splice(0).forEach(scope => scope.stop()); vi.restoreAllMocks() })
function page() {
  const api = { get: vi.fn(), save: vi.fn() }, accept = vi.fn(), success = vi.fn()
  const source = readFileSync(new URL('../src/modules/brand/BrandPage.vue', import.meta.url), 'utf8').match(/<script setup lang="ts">([\s\S]*?)<\/script>/)![1]
  const code = ts.transpileModule(source + '\nexport { load, save, form, error, loaded, saving };', { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText
  const deps: Record<string, unknown> = {
    vue: { ...vue, onMounted() {} }, 'element-plus': { ElMessage: { success } },
    '../../services/admin': { errorMessage: (e: Error) => e.message },
    '../../services/brand': { brandApi: api, acceptBrand: accept },
    '../../services/request-scope': { useRequestScope },
  }
  const exports = {}, scope = vue.effectScope(); scopes.push(scope)
  scope.run(() => new Function('require', 'exports', code)((name: string) => deps[name], exports))
  return { ...exports as { load(): Promise<void>; save(): Promise<void>; form: { displayName: string; visible: boolean; version: number }; error: vue.Ref<string>; loaded: vue.Ref<boolean>; saving: vue.Ref<boolean> }, api, accept, success, scope }
}
describe('brand configuration', () => {
  it('guards operator navigation and allows super-admin settings', () => {
    expect(allowedRoute('/brand')).toBeUndefined()
    session.account!.role = 'operator'
    expect(allowedRoute('/brand')).toBe('/analytics')
    session.account = null
    expect(allowedRoute('/brand')).toBe('/login')
  })
  it('cannot save before loading; trims input and preserves name and visibility on conflict', async () => {
    const h = page()
    await h.save(); expect(h.api.save).not.toHaveBeenCalled()
    h.api.get.mockResolvedValue({ displayName: '有聚点', visible: true, version: 2 })
    await h.load()
    h.form.displayName = '  新品牌  '; h.form.visible = false
    h.api.save.mockRejectedValue(new AdminRequestError(409, 'BRAND_VERSION_CONFLICT', '请重新读取'))
    await h.save()
    expect(h.api.save).toHaveBeenCalledWith({ displayName: '新品牌', visible: false, version: 2 })
    expect(h.form).toEqual({ displayName: '  新品牌  ', visible: false, version: 2 })
    expect(h.error.value).toBe('请重新读取')
    expect(h.saving.value).toBe(false)
    expect(h.accept).toHaveBeenCalledTimes(1)
    h.form.displayName = ' '
    await h.save(); expect(h.api.save).toHaveBeenCalledTimes(1)
  })
  it('locks duplicate saves and applies the returned version only on success', async () => {
    const h = page()
    h.api.get.mockResolvedValue({ displayName: '有聚点', visible: true, version: 0 }); await h.load()
    let finish!: (value: unknown) => void
    h.api.save.mockImplementation(() => new Promise(resolve => { finish = resolve }))
    const saving = h.save(); await h.save()
    expect(h.api.save).toHaveBeenCalledTimes(1)
    finish({ displayName: '新品牌', visible: false, version: 1 }); await saving
    expect(h.form.version).toBe(1); expect(h.accept).toHaveBeenLastCalledWith({ displayName: '新品牌', visible: false, version: 1 })
  })
  it.each(['dispose', 'identity'])('ignores a late save after %s', async mode => {
    const h = page()
    h.api.get.mockResolvedValue({ displayName: '有聚点', visible: true, version: 1 }); await h.load()
    let finish!: (value: unknown) => void
    h.api.save.mockImplementation(() => new Promise(resolve => { finish = resolve }))
    const pending = h.save()
    if (mode === 'dispose') h.scope.stop(); else session.epoch++
    finish({ displayName: '旧账号结果', visible: false, version: 2 }); await pending
    expect(h.accept).toHaveBeenCalledTimes(1); expect(h.success).not.toHaveBeenCalled()
  })
})
