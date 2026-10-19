import { describe, expect, it, vi } from 'vitest'
import { ActivityReportService } from '../src/admin/activity-report-service.js'
import { ActivityRegistrationQuery } from '../src/admin/activity-report-dto.js'
import type { AdminTransaction } from '../src/admin/service.js'

function transaction(results: unknown[][]) {
  let index = 0
  const tx = { select: vi.fn(()=> {
    const result = results[index++]
    const chain: Record<string, unknown> = { then:(resolve:(value:unknown)=>void)=>resolve(result) }
    for (const method of ['from','where','limit','innerJoin','leftJoin','orderBy','offset']) chain[method]=vi.fn(()=>chain)
    return chain
  }) }
  return tx as unknown as AdminTransaction
}
describe('admin activity report',()=> {
  it('returns null conversion and average with no readers or reviews, and never counts cancelled activity attendance',async()=> {
    const tx = transaction([[{ id:'activity',title:'title',consultationContact:'contact',activeRegistrationCount:3,lifecycle:'cancelled' }],
      [{ views:0,visitors:0 }],[{ total:2 }],[{ total:0,average:null }]])
    expect(await new ActivityReportService().report(tx,'activity')).toMatchObject({ activeRegistrations:3,attendedMembers:0,conversionRate:null,averageScore:null })
  })
  it('returns current valid count and visible review aggregation',async()=> {
    const tx = transaction([[{ id:'activity',title:'title',consultationContact:'contact',activeRegistrationCount:2,lifecycle:'published' }],
      [{ views:9,visitors:4 }],[{ total:1 }],[{ total:2,average:'4.5' }]])
    expect(await new ActivityReportService().report(tx,'activity')).toMatchObject({ views:9,visitors:4,attendedMembers:1,conversionRate:50,reviewCount:2,averageScore:4.5 })
  })
  it('paginates full registration contacts and associates dynamic answers by registration',async()=> {
    const tx = transaction([[{ id:'activity' }],[{ value:41 }],[{ registration:{ id:'r',memberId:'m',status:'cancelled',contactPhone:'13800000000',currentRegisteredAt:new Date('2026-10-01T01:00:00Z'),cancelledAt:new Date('2026-10-02T01:00:00Z'),attended:false,attendedAt:null },memberNumber:'HJ1',displayName:'member' }],
      [{ registrationId:'r',questionId:'q',prompt:'skills',type:'multiple',answer:['one','two'] }]])
    const result = await new ActivityReportService().registrations(tx,'activity',Object.assign(new ActivityRegistrationQuery(),{ offset:40 }))
    expect(result).toMatchObject({ total:41,hasMore:false,items:[{ contactPhone:'13800000000',status:'cancelled',answers:[{ prompt:'skills',answer:['one','two'] }] }] })
  })
  it('rejects absent activities rather than returning an empty report',async()=> {
    await expect(new ActivityReportService().report(transaction([[]]),'missing')).rejects.toThrow('活动不存在')
  })
})
