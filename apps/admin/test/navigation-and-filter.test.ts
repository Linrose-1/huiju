import { readFileSync } from 'node:fs'
import ts from 'typescript'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as vue from 'vue'
import { createMemoryHistory } from 'vue-router'
import { adminApi, AdminRequestError, clearSession, session } from '../src/services/admin'
import * as admin from '../src/services/admin'
import { useRequestScope } from '../src/services/request-scope'
import { router, allowedRoute } from '../src/router'

vi.mock('vue-router', async importOriginal => ({
  ...await importOriginal<typeof import('vue-router')>(),
  createWebHistory: () => createMemoryHistory(),
}))

const scopes: vue.EffectScope[] = []
const account = { id: 'operator', username: 'operator', displayName: '运营', role: 'operator' as const, active: true, mustChangePassword: false, createdAt: '2026-10-02T00:00:00Z' }
function pageScript(path: string, exported: string, dependencies: Record<string, unknown>) {
  const source = readFileSync(new URL(path, import.meta.url), 'utf8').match(/<script setup lang="ts">([\s\S]*?)<\/script>/)![1]
  const code = ts.transpileModule(`${source}\nexport { ${exported} };`, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
  const scope = vue.effectScope()
  scopes.push(scope)
  const result: Record<string, unknown> = {}
  scope.run(() => new Function('require', 'exports', code)(
    (name: string) => name === 'vue' ? { ...vue, onMounted() {} } : dependencies[name], result,
  ))
  return result
}
function app() {
  return pageScript('../src/App.vue', 'restore, ready, startupError', {
    './services/admin': admin,
    './services/brand': { brand: vue.reactive({ displayName: '有聚点', visible: true }), refreshBrand: async () => {} },
    './router': { router, allowedRoute },
    'vue-router': { useRoute: () => ({
      get path() { return router.currentRoute.value.path },
      get fullPath() { return router.currentRoute.value.fullPath },
    }) },
    'element-plus': { ElMessage: { error: vi.fn() } },
  }) as { restore(): Promise<void>; ready: vue.Ref<boolean>; startupError: vue.Ref<string> }
}
beforeEach(() => {
  clearSession()
  // Each test starts a fresh browser session bootstrap.
  session.initialized = false
})
afterEach(() => { scopes.splice(0).forEach(scope => scope.stop()); vi.restoreAllMocks() })

describe('admin page navigation and filtering', () => {
  it('waits for initial navigation when cookie restoration resolves immediately', async () => {
    const navigation = router.push('/members')
    const root = app()
    vi.spyOn(adminApi, 'restore').mockImplementation(async () => { session.account = { ...account } })
    await Promise.all([navigation, root.restore()])
    expect(root.ready.value).toBe(true)
    expect(router.currentRoute.value.path).toBe('/members')
  })
  it.each(['/members', '/activities', '/activities/example?status=removed&page=2', '/activities/example/registrations', '/circle', '/password', '/analytics', '/engagement', '/content'])('preserves direct %s while restoring a valid cookie', async path => {
    await router.push(path)
    const root = app()
    let resolve!: () => void
    vi.spyOn(adminApi, 'restore').mockImplementation(() => new Promise<void>(done => {
      resolve = () => { session.account = { ...account }; done() }
    }))
    const pending = root.restore()
    expect(root.ready.value).toBe(false)
    expect(router.currentRoute.value.fullPath).toBe(path)
    resolve()
    await pending
    expect(root.ready.value).toBe(true)
    expect(router.currentRoute.value.fullPath).toBe(path)
  })
  it('keeps the target through startup network failure and retry, then guards logout and operator routes', async () => {
    await router.push('/accounts')
    const root = app()
    vi.spyOn(adminApi, 'restore').mockRejectedValueOnce(new Error('网络连接失败'))
      .mockImplementationOnce(async () => { session.account = { ...account } })
    await root.restore()
    expect(root.ready.value).toBe(false)
    expect(root.startupError.value).toBe('网络连接失败')
    expect(router.currentRoute.value.path).toBe('/accounts')
    await root.restore()
    expect(root.ready.value).toBe(true)
    expect(router.currentRoute.value.path).toBe('/analytics')
    clearSession()
    await vue.nextTick()
    await router.push('/members')
    expect(router.currentRoute.value.path).toBe('/login')
  })
  it('redirects an expired cookie to login after restore returns 401', async () => {
    await router.push('/members')
    const root = app()
    vi.spyOn(adminApi, 'restore').mockRejectedValue(new AdminRequestError(401, 'ADMIN_SESSION_REQUIRED', '登录已失效'))
    await root.restore()
    expect(root.ready.value).toBe(true)
    expect(root.startupError.value).toBe('')
    expect(router.currentRoute.value.path).toBe('/login')
  })
  it('retains a super administrator account route and does not show business views after a 403', async () => {
    await router.push('/accounts')
    const root = app()
    vi.spyOn(adminApi, 'restore').mockRejectedValueOnce(new AdminRequestError(403, 'ADMIN_FORBIDDEN', '没有权限'))
      .mockImplementationOnce(async () => { session.account = { ...account, role: 'super_admin' } })
    await root.restore()
    expect(root.ready.value).toBe(false)
    expect(session.initialized).toBe(false)
    expect(root.startupError.value).toBe('没有权限')
    await root.restore()
    expect(root.ready.value).toBe(true)
    expect(router.currentRoute.value.path).toBe('/accounts')
    const redirected = new Promise<void>(resolve => {
      const stop = router.afterEach(to => { if (to.path === '/login') { stop(); resolve() } })
    })
    clearSession()
    await redirected
    expect(router.currentRoute.value.path).toBe('/login')
  })
  it('discards an older dashboard response when the period changes', async () => {
    let finish!: (value: Awaited<ReturnType<typeof adminApi.analytics>>) => void
    const requests = vi.spyOn(adminApi, 'analytics').mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
      .mockResolvedValueOnce({ days: 7, startDate: '2026-09-27', endDate: '2026-10-03', metrics: [], trend: [], behaviors: [], coverageNotes: [] })
    const page = pageScript('../src/modules/analytics/AnalyticsPage.vue', 'days, data, load', {
      '../../services/admin': admin,
      '../../services/request-scope': { useRequestScope },
      'vue-router': { useRouter: () => router },
    }) as { days: vue.Ref<7 | 30>; data: vue.Ref<Awaited<ReturnType<typeof adminApi.analytics>> | null>; load(): Promise<void> }
    const older = page.load()
    page.days.value = 7
    await page.load()
    finish({ days: 30, startDate: '2026-09-04', endDate: '2026-10-03', metrics: [], trend: [], behaviors: [], coverageNotes: [] })
    await older
    expect(page.data.value?.days).toBe(7)
    expect(requests).toHaveBeenLastCalledWith(7)
  })
  it('locks content submission, retains inputs on failure, and loads empty history after success', async () => {
    let finish!: () => void
    const saves = vi.spyOn(adminApi, 'saveContent').mockImplementationOnce(() => new Promise(resolve => { finish = () => resolve({ activityText: '活动', assistantText: '助手', canEdit: true }) }))
      .mockRejectedValueOnce(new Error('保存失败'))
    const history = vi.spyOn(adminApi, 'contentHistory').mockResolvedValue({ items: [], hasMore: false })
    const page = pageScript('../src/modules/content/ContentPage.vue', 'form, save, saving, error', {
      '../../services/admin': admin,
      '../../services/request-scope': { useRequestScope },
      'element-plus': { ElMessage: { success: vi.fn() } },
    }) as { form: vue.Ref<{ activityText: string; assistantText: string }>; saving: vue.Ref<boolean>; error: vue.Ref<string>; save(): Promise<void> }
    page.form.value = { activityText: '活动', assistantText: '助手' }
    const first = page.save()
    await page.save()
    expect(saves).toHaveBeenCalledTimes(1)
    expect(page.saving.value).toBe(true)
    finish()
    await first
    expect(page.saving.value).toBe(false)
    expect(history).toHaveBeenCalledWith(0)
    await page.save()
    expect(page.error.value).toBe('保存失败')
    expect(page.form.value.activityText).toBe('活动')
    expect(page.saving.value).toBe(false)
  })
  it('pages and refreshes applied activity filters until a new query is submitted', async () => {
    const requests = vi.spyOn(adminApi, 'activities').mockResolvedValue({ items: [], total: 60, hasMore: true })
    const replace = vi.fn()
    const page = pageScript('../src/modules/activities/ActivitiesPage.vue', 'keyword, status, load, changePage, offset, listQuery', {
      '../../services/admin': admin,
      '../../services/request-scope': { useRequestScope },
      'vue-router': { useRoute: () => ({ query: { status: 'removed', q: '原关键词', page: '2' } }), useRouter: () => ({ replace }) },
    }) as { keyword: vue.Ref<string>; status: vue.Ref<string>; offset: vue.Ref<number>; load(reset?: boolean): Promise<void>; changePage(back: boolean): void; listQuery(): object }
    await page.load()
    expect(requests).toHaveBeenLastCalledWith({ status: 'removed', q: '原关键词', offset: 20 })
    expect(page.listQuery()).toEqual({ status: 'removed', q: '原关键词', page: '2' })
    expect(replace).toHaveBeenLastCalledWith({ name: 'activity-list', query: page.listQuery() })
    page.status.value = 'all'
    page.keyword.value = '原关键词'
    await page.load(true)
    page.keyword.value = '新关键词'
    page.changePage(false)
    await vue.nextTick()
    expect(requests).toHaveBeenLastCalledWith({ status: 'all', q: '原关键词', offset: 20 })
    await page.load()
    expect(requests).toHaveBeenLastCalledWith({ status: 'all', q: '原关键词', offset: 20 })
    await page.load(true)
    expect(requests).toHaveBeenLastCalledWith({ status: 'all', q: '新关键词', offset: 0 })
    page.changePage(false)
    await vue.nextTick()
    page.status.value = 'removed'
    await page.load(true)
    expect(requests).toHaveBeenLastCalledWith({ status: 'removed', q: '新关键词', offset: 0 })
  })
  function circlePage() {
    return pageScript('../src/modules/circle/CirclePage.vue', 'category, items, offset, load, changePage, error, detail, openDetail, closeDetail, history, historyOffset, loadHistory, openAction, reason, applyAction, dialogError, dialogOpen, submitting', {
      '../../services/admin': admin,
      '../../services/request-scope': { useRequestScope },
      'element-plus': { ElMessage: { success: vi.fn() } },
    }) as {
      category: vue.Ref<admin.CircleCategory>; items: vue.Ref<admin.CirclePost[]>; offset: vue.Ref<number>; error: vue.Ref<string>
      load(reset?: boolean, targetOffset?: number): Promise<void>; changePage(back: boolean): void
      detail: vue.Ref<admin.CirclePost | null>; openDetail(item: admin.CirclePost): void; closeDetail(): void
      history: vue.Ref<admin.CircleOperation[]>; historyOffset: vue.Ref<number>; loadHistory(targetOffset?: number): Promise<void>
      openAction(item: admin.CirclePost): void; reason: vue.Ref<string>; applyAction(): Promise<void>
      dialogError: vue.Ref<string>; dialogOpen: vue.Ref<boolean>; submitting: vue.Ref<boolean>
    }
  }
  const circlePost = (id: string, state = 'open'): admin.CirclePost => ({ id, state, category: 'service', subtype: null, title: '资源帖', body: '内容', location: null, area: null, price: null, validUntil: null, storeName: null, author: null, images: [], removalReason: null, isOwner: false, createdAt: '2026-10-05T00:00:00Z' })
  it('keeps the current circle page after paging failure and resets server-side category filters', async () => {
    const post = circlePost('old')
    const requests = vi.spyOn(adminApi, 'circlePosts').mockResolvedValueOnce({ items: [post], hasMore: true })
      .mockRejectedValueOnce(new Error('加载失败')).mockResolvedValueOnce({ items: [], hasMore: false })
    const page = circlePage()
    await page.load()
    await page.load(false, 20)
    expect(page.offset.value).toBe(0)
    expect(page.items.value).toEqual([post])
    expect(page.error.value).toBe('加载失败')
    page.category.value = 'park'
    await page.load(true)
    expect(requests).toHaveBeenLastCalledWith('park', 0)
    expect(page.items.value).toEqual([])
    expect(page.error.value).toBe('')
    page.changePage(false)
    expect(requests).toHaveBeenCalledTimes(3)
  })
  it('discards a late circle list response after switching category', async () => {
    let finish!: (value: Awaited<ReturnType<typeof adminApi.circlePosts>>) => void
    vi.spyOn(adminApi, 'circlePosts').mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
      .mockResolvedValueOnce({ items: [circlePost('new')], hasMore: false })
    const page = circlePage(), old = page.load()
    page.category.value = 'store'
    await page.load(true)
    finish({ items: [circlePost('old')], hasMore: true })
    await old
    expect(page.items.value[0]?.id).toBe('new')
  })
  it('does not show a late history after changing or closing the circle detail', async () => {
    let finish!: (value: Awaited<ReturnType<typeof adminApi.circleOperations>>) => void
    vi.spyOn(adminApi, 'circleOperations').mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
      .mockResolvedValueOnce({ items: [], hasMore: false })
    const page = circlePage()
    page.openDetail(circlePost('first'))
    page.openDetail(circlePost('second'))
    await vue.nextTick()
    page.closeDetail()
    finish({ items: [{ id: 'old', action: 'remove', reason: '旧原因', actorName: '运营', createdAt: '2026-10-05T00:00:00Z' }], hasMore: false })
    await vue.nextTick()
    expect(page.detail.value).toBeNull()
    expect(page.history.value).toEqual([])
  })
  it('requires a reason, locks repeat moderation, retains failed input, then refreshes server state', async () => {
    const page = circlePage(), post = circlePost('post', 'removed')
    let finish!: (value: { ok: boolean }) => void
    const restores = vi.spyOn(adminApi, 'restoreCirclePost').mockRejectedValueOnce(new Error('操作失败'))
      .mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
    const removes = vi.spyOn(adminApi, 'removeCirclePost')
    vi.spyOn(adminApi, 'circlePosts').mockResolvedValue({ items: [circlePost('post', 'ended')], hasMore: false })
    page.openAction(post)
    await page.applyAction()
    expect(restores).not.toHaveBeenCalled()
    expect(page.dialogError.value).toContain('操作原因')
    page.reason.value = ' 核对后恢复 '
    await page.applyAction()
    expect(page.dialogError.value).toBe('操作失败')
    expect(page.reason.value).toBe(' 核对后恢复 ')
    expect(page.dialogOpen.value).toBe(true)
    const pending = page.applyAction()
    await page.applyAction()
    expect(page.submitting.value).toBe(true)
    expect(restores).toHaveBeenCalledTimes(2)
    expect(restores).toHaveBeenLastCalledWith('post', '核对后恢复')
    expect(removes).not.toHaveBeenCalled()
    finish({ ok: true }); await pending
    expect(page.dialogOpen.value).toBe(false)
    expect(page.submitting.value).toBe(false)
    expect(page.items.value[0]?.state).toBe('ended')
  })
})


describe('pagination and authorization regression coverage', () => {
  function view<T>(path: string, exported: string, network: Record<string, unknown>) {
    return pageScript('../src/modules/' + path + '.vue', exported, {
      '../../services/admin': { ...admin, adminApi: network, isSuperAdmin: { value: true } },
      '../../services/request-scope': { useRequestScope },
      'vue-router': { useRoute: () => ({ query: {}, params: { id: 'activity' } }), useRouter: () => ({ replace: vi.fn() }) },
      'element-plus': { ElMessage: { success: vi.fn() } },
    }) as T
  }
  const tick = () => new Promise(resolve => setTimeout(resolve, 0))
  it.each([
    ['activities/ActivitiesPage', 'activities', 20],
    ['feedback/FeedbackPage', 'feedback', 40],
    ['accounts/AccountsPage', 'accounts', 20],
  ] as const)('%s keeps the displayed page and retries the same failed target', async (path, method, size) => {
    const request = vi.fn().mockResolvedValueOnce({ items: [{ id: 'first' }], total: 100, hasMore: true }).mockRejectedValueOnce(new Error('network')).mockResolvedValue({ items: [{ id: 'second' }], total: 100, hasMore: false })
    const p = view<{ load(): Promise<void>; changePage(back: boolean): void; items: vue.Ref<{id:string}[]>; offset: vue.Ref<number>; hasMore: vue.Ref<boolean> }>(path, 'load,changePage,items,offset,hasMore', { [method]: request })
    await p.load(); p.changePage(false); await tick()
    expect(p.offset.value).toBe(0); expect(p.items.value[0]!.id).toBe('first')
    await p.load()
    const offsets = request.mock.calls.map(args => method === 'activities' ? args[0].offset : method === 'feedback' ? args[2] : args[0])
    expect(offsets).toEqual([0,size,size]); expect(p.offset.value).toBe(size); expect(p.hasMore.value).toBe(false)
  })
  it('validates the feedback hide reason and keeps the confirmation open after a failed request', async () => {
    const hide = vi.fn().mockRejectedValueOnce(new Error('network')).mockResolvedValue({ ok: true })
    const feedback = vi.fn().mockResolvedValue({ items: [], total: 0, hasMore: false })
    const p = view<{
      openHide(item: {id: string; kind: string; hiddenAt: string | null}): void
      hide(): Promise<void>; reason: vue.Ref<string>; dialogError: vue.Ref<string>; dialogOpen: vue.Ref<boolean>
      kind: vue.Ref<'comment' | 'review'>
    }>('feedback/FeedbackPage', 'openHide,hide,reason,dialogError,dialogOpen,kind', { hide, feedback })
    p.openHide({ id: 'already-hidden', kind: 'comment', hiddenAt: '2026-11-19' })
    expect(p.dialogOpen.value).toBe(false)
    p.kind.value = 'review'
    p.openHide({ id: 'review-id', kind: 'review', hiddenAt: null })
    p.reason.value = '   '
    await p.hide()
    expect(p.dialogError.value).toBe('请填写隐藏原因。')
    p.reason.value = '字'.repeat(501)
    await p.hide()
    expect(p.dialogError.value).toBe('隐藏原因最多 500 字。')
    expect(hide).not.toHaveBeenCalled()
    const maxLengthReason = '字'.repeat(500)
    p.reason.value = maxLengthReason
    await p.hide()
    expect(p.dialogOpen.value).toBe(true)
    expect(p.reason.value).toBe(maxLengthReason)
    expect(p.dialogError.value).toBe('network')
    await p.hide()
    expect(hide).toHaveBeenLastCalledWith('review', 'review-id', maxLengthReason)
    expect(p.dialogOpen.value).toBe(false)
    expect(feedback).toHaveBeenCalledWith('review', 'visible', 0)
  })
  it('member query retries failed pages and restores its original search after viewing invitees', async () => {
    const members = vi.fn()
      .mockResolvedValueOnce({ items: [{ id: 'first' }], total: 41, hasMore: true })
      .mockRejectedValueOnce(new Error('network'))
      .mockResolvedValueOnce({ items: [{ id: 'last' }], total: 41, hasMore: false })
      .mockResolvedValue({ items: [{ id: 'invitee' }], total: 1, hasMore: false })
    const member = vi.fn().mockResolvedValue({ id: 'inviter', displayName: '邀请人' })
    const p = view<{
      load(reset?: boolean): Promise<void>; page(back: boolean): void; showMember(id: string): Promise<void>
      invitedMembers(): void; returnToMemberQuery(): void; detailOpen: vue.Ref<boolean>
      query: vue.Ref<string>; profile: vue.Ref<string>; offset: vue.Ref<number>; items: vue.Ref<{id: string}[]>
    }>('members/MembersPage', 'load,page,showMember,invitedMembers,returnToMemberQuery,detailOpen,query,profile,offset,items', { members, member })
    p.query.value = '关键词'
    p.profile.value = 'complete'
    await p.load(true)
    p.page(false); await tick()
    expect(p.offset.value).toBe(0)
    expect(p.items.value).toEqual([{ id: 'first' }])
    await p.load()
    expect(members.mock.calls.map(([query]) => query.offset)).toEqual([0, 40, 40])
    await p.showMember('inviter')
    p.invitedMembers(); await tick()
    expect(p.detailOpen.value).toBe(false)
    expect(members).toHaveBeenLastCalledWith({ q: '', profile: 'all', inviterId: 'inviter', offset: 0 })
    p.returnToMemberQuery(); await tick()
    expect(p.query.value).toBe('关键词')
    expect(p.profile.value).toBe('complete')
    expect(p.offset.value).toBe(40)
    expect(members).toHaveBeenLastCalledWith({ q: '关键词', profile: 'complete', inviterId: undefined, offset: 40 })
  })
  it('engagement and member events retain their committed pages after failed forward loads', async () => {
    const request = () => vi.fn().mockResolvedValueOnce({ items: [{ id:'first' }], total: 100, hasMore: true }).mockRejectedValueOnce(new Error('network')).mockResolvedValue({ items:[{id:'second'}],total:100,hasMore:false })
    const engagement=request(), events=request()
    const p=view<{load():Promise<void>;page(back:boolean):void;loadEvents():Promise<void>;eventPage(back:boolean):void;items:vue.Ref<{id:string}[]>;events:vue.Ref<{id:string}[]>;applied:vue.Ref<{offset:number}>;eventOffset:vue.Ref<number>}>('analytics/EngagementPage','load,page,loadEvents,eventPage,items,events,applied,eventOffset',{engagement,engagementEvents:events})
    await p.load();p.page(false);await tick();expect(p.applied.value.offset).toBe(0);expect(p.items.value[0]!.id).toBe('first');await p.load();expect(engagement.mock.calls.map(a=>a[0].offset)).toEqual([0,40,40])
    await p.loadEvents();p.eventPage(false);await tick();expect(p.eventOffset.value).toBe(0);expect(p.events.value[0]!.id).toBe('first');await p.loadEvents();expect(events.mock.calls.map(a=>a[2])).toEqual([0,40,40])
  })
  it('activity registration and operation lists retain failed pages and retry their targets', async () => {
    const make = () => vi.fn().mockResolvedValueOnce({items:[{id:'first'}],total:100,hasMore:true}).mockRejectedValueOnce(new Error('network')).mockResolvedValue({items:[],total:100,hasMore:false})
    const registrations=make(),history=make()
    const roster = view<{loadRegistrations():Promise<void>;registrationPage(back:boolean):void;registrationOffset:vue.Ref<number>;registrations:vue.Ref<unknown[]>}>('activities/ActivityRegistrationsPage','loadRegistrations,registrationPage,registrationOffset,registrations',{activityRegistrations:registrations})
    const detail = view<{loadHistory():Promise<void>;changeHistory(back:boolean):void;historyOffset:vue.Ref<number>;history:vue.Ref<unknown[]>}>('activities/ActivityDetailPage','loadHistory,changeHistory,historyOffset,history',{activityOperations:history})
    await roster.loadRegistrations();roster.registrationPage(false);await tick();expect(roster.registrationOffset.value).toBe(0);expect(roster.registrations.value).toHaveLength(1);await roster.loadRegistrations();expect(registrations.mock.calls.map(a=>a[1])).toEqual([0,40,40])
    await detail.loadHistory();detail.changeHistory(false);await tick();expect(detail.historyOffset.value).toBe(0);expect(detail.history.value).toHaveLength(1);await detail.loadHistory();expect(history.mock.calls.map(a=>a[1])).toEqual([0,20,20])
  })
  it('content search reflects each successful permission change and both lists refresh', async () => {
    const setContentEditor = vi.fn().mockResolvedValue({ ok: true })
    const contentEditors = vi.fn()
      .mockResolvedValueOnce({ items: [{ memberId: 'member', enabled: true }], hasMore: false })
      .mockResolvedValueOnce({ items: [], hasMore: false })
    const contentHistory = vi.fn().mockResolvedValue({ items: [], hasMore: false })
    const p = view<{
      grant(id: string, enabled: boolean): Promise<void>; editorPermissions: vue.Ref<Map<string, boolean>>
    }>('content/ContentPage', 'grant,editorPermissions', { setContentEditor, contentEditors, contentHistory })
    await p.grant('member', true)
    expect(p.editorPermissions.value.get('member')).toBe(true)
    await p.grant('member', false)
    expect(p.editorPermissions.value.get('member')).toBeFalsy()
    expect(setContentEditor.mock.calls).toEqual([['member', true], ['member', false]])
    expect(contentEditors.mock.calls).toEqual([[0], [0]])
    expect(contentHistory.mock.calls).toEqual([[0], [0]])
  })
  it('content list completion cannot be invalidated by a failed concurrent grant', async () => {
    let finish!: (value: unknown) => void
    const contentEditors=vi.fn(()=>new Promise(resolve=>{finish=resolve})),setContentEditor=vi.fn().mockRejectedValue(new Error('grant failed'))
    const p=view<{loadEditors():Promise<void>;grant(id:string,enabled:boolean):Promise<void>;editorLoading:vue.Ref<boolean>;editorError:vue.Ref<string>;editors:vue.Ref<unknown[]>}>('content/ContentPage','loadEditors,grant,editorLoading,editorError,editors',{contentEditors,setContentEditor})
    const pending=p.loadEditors();await p.grant('member',true);finish({items:[{memberId:'old'}],hasMore:false});await pending
    expect(p.editorLoading.value).toBe(false);expect(p.editorError.value).toBe('grant failed');expect(p.editors.value).toHaveLength(1)
  })
  it.each([['history','loadHistory','history','historyOffset','contentHistory',20],['editors','loadEditors','editors','editorOffset','contentEditors',20],['search','search','candidates','searchOffset','members',40]] as const)('content %s pagination keeps data and retries the failing page',async(kind,loadName,itemsName,offsetName,apiName,size)=>{
    const request=vi.fn().mockResolvedValueOnce({items:[{id:'first'}],hasMore:true}).mockRejectedValueOnce(new Error('network')).mockResolvedValue({items:[],hasMore:false})
    const p=view<{load(reset?:boolean):Promise<void>;page(kind:string,back:boolean):void;items:vue.Ref<unknown[]>;offset:vue.Ref<number>;query:vue.Ref<string>}>('content/ContentPage',`${loadName} as load,page,${itemsName} as items,${offsetName} as offset,query`,{[apiName]:request})
    p.query.value='member';await p.load();p.page(kind,false);await tick();expect(p.offset.value).toBe(0);expect(p.items.value).toHaveLength(1);await p.load(false);expect(request.mock.calls.map(a=>apiName==='members'?a[0].offset:a[0])).toEqual([0,size,size])
  })
})
