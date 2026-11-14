import { eq } from 'drizzle-orm'
import { communities } from '../database/schema/communities.js'
import { fail, type FlowDatabase } from './common.js'

export const DEFAULT_COMMUNITY_ID = 'xuejia'
type Transaction = Parameters<Parameters<FlowDatabase['db']['transaction']>[0]>[0]
const shanghaiMonth = new Intl.DateTimeFormat('en', {
  timeZone: 'Asia/Shanghai', year: 'numeric', month: 'numeric',
})

export function communityUserNumber(prefix: string, joinedAt: Date, sequenceNo: number) {
  if (!Number.isInteger(sequenceNo) || sequenceNo < 1 || sequenceNo > 999999) {
    fail('MEMBER_NUMBER_EXHAUSTED', '该社群的用户编号已分配完，请联系管理员', 503)
  }
  const parts = shanghaiMonth.formatToParts(joinedAt)
  const year = parts.find(part => part.type === 'year')!.value.slice(-2)
  const month = Number(parts.find(part => part.type === 'month')!.value)
  const yearCode = [...year].map(digit => 'JABCDEFGHI'[Number(digit)]).join('')
  return prefix + yearCode + 'ABCDEFGHIJKL'[month - 1] + String(sequenceNo).padStart(6, '0')
}

// The caller inserts the member and membership in this same transaction.
export async function allocateCommunityNumber(tx: Transaction, communityId: string, joinedAt: Date) {
  const [community] = await tx.select().from(communities)
    .where(eq(communities.id, communityId)).limit(1).for('update')
  if (!community) fail('COMMUNITY_NOT_READY', '社群尚未初始化，请联系管理员', 503)
  const sequenceNo = community.lastSequence + 1
  const userNumber = communityUserNumber(community.numberPrefix, joinedAt, sequenceNo)
  await tx.update(communities).set({ lastSequence: sequenceNo }).where(eq(communities.id, communityId))
  return { communityId, sequenceNo, userNumber, joinedAt }
}
