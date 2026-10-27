import 'reflect-metadata'
import { describe, expect, it, vi } from 'vitest'
import { MySqlDialect } from 'drizzle-orm/mysql-core'
import { OrganizerService } from '../src/flow/organizer.js'
import type { FlowDatabase } from '../src/flow/common.js'
import type { IdentityService } from '../src/flow/identity.js'

const dialect = new MySqlDialect()
const member = { id: 'current-owner', boundPhone: '00000000000', avatarUrl: '/avatar.png', displayName: 'Owner', avatarSetByUser: true, nameSetByUser: true }
function fixture(rows: unknown[] = [], identityMember: unknown = member) {
  const calls: { method: string; args: unknown[] }[] = []
  const chain: Record<string, unknown> = { then: (resolve: (value: unknown[]) => unknown) => Promise.resolve(rows).then(resolve) }
  for (const method of ['from','innerJoin','where','groupBy','orderBy','limit','offset']) chain[method] = (...args: unknown[]) => { calls.push({method,args}); return chain }
  const db = { select: vi.fn<(selection: Record<string, unknown>) => typeof chain>(() => chain) }
  const identity = { require: vi.fn(async () => identityMember) }
  return { service: new OrganizerService({db} as unknown as FlowDatabase, identity as unknown as IdentityService), db, identity, calls }
}
function sql(value: unknown) { return dialect.sqlToQuery(value as Parameters<MySqlDialect['sqlToQuery']>[0]) }

describe('personal activity question history', () => {
  it('rejects unauthenticated and incomplete identities before any history query', async () => {
    const f = fixture()
    f.identity.require.mockRejectedValueOnce(new Error('SESSION_REQUIRED'))
    await expect(f.service.questionHistory()).rejects.toThrow('SESSION_REQUIRED')
    expect(f.db.select).not.toHaveBeenCalled()
    const incomplete = fixture([], {...member, boundPhone: null})
    await expect(incomplete.service.questionHistory('token')).rejects.toThrow('请先绑定手机号')
    expect(incomplete.db.select).not.toHaveBeenCalled()
  })
  it('filters the owner and deduplicates the complete configuration before pagination', async () => {
    const f = fixture()
    await f.service.questionHistory('token', {offset:20,limit:20})
    expect(f.identity.require).toHaveBeenCalledWith('token')
    const where = sql(f.calls.find(c=>c.method==='where')!.args[0])
    expect(where.sql).toContain('`activities`.`organizer_member_id` = ?')
    expect(where.params).toEqual(['current-owner'])
    const group = sql(f.calls.find(c=>c.method==='groupBy')!.args[0]).sql
    expect(group).toContain('sha2(cast(json_array(')
    for (const column of ['prompt','type','options']) expect(group).toContain('`registration_questions`.`'+column+'`')
    expect(group).not.toMatch(/required|answers/)
    expect(f.calls.findIndex(c=>c.method==='groupBy')).toBeLessThan(f.calls.findIndex(c=>c.method==='limit'))
    const order = f.calls.find(c=>c.method==='orderBy')!.args.map(arg=>sql(arg).sql)
    expect(order).toEqual(['max(`activities`.`updated_at`) desc','max(`registration_questions`.`id`) desc'])
    expect(f.calls).toContainEqual({method:'limit',args:[21]})
    expect(f.calls).toContainEqual({method:'offset',args:[20]})
  })
  it('returns only reusable configuration fields, with an extra row detecting the next page', async () => {
    const f = fixture([{prompt:'姓名',type:'short_text',options:null,required:true,answer:'private',memberId:'private'}, {prompt:'选择',type:'single',options:['甲','乙']}, {prompt:'后页',type:'short_text',options:null}])
    expect(await f.service.questionHistory('token',{offset:0,limit:2})).toEqual({items:[{prompt:'姓名',type:'short_text',options:null},{prompt:'选择',type:'single',options:['甲','乙']}],hasMore:true})
  })
  it('supports empty and final pages without a further-page signal', async () => {
    expect(await fixture().service.questionHistory('token')).toEqual({items:[],hasMore:false})
    expect(await fixture([{prompt:'公司',type:'short_text',options:null}]).service.questionHistory('token')).toEqual({items:[{prompt:'公司',type:'short_text',options:null}],hasMore:false})
  })
  it('decodes aggregate JSON options returned by MySQL as text', async () => {
    const f = fixture()
    await f.service.questionHistory('token')
    const selection = f.db.select.mock.calls[0][0]
    const options = selection.options as { decoder: { mapFromDriverValue(value: string): unknown } }
    expect(options.decoder.mapFromDriverValue('["甲","乙"]')).toEqual(['甲','乙'])
  })
})
