import { randomInt } from 'node:crypto'
import { eq, sql } from 'drizzle-orm'
import { members } from '../database/schema/members.js'
import { fail, type FlowDatabase } from './common.js'

type Transaction = Parameters<Parameters<FlowDatabase['db']['transaction']>[0]>[0]

// Callers hold the platform root row lock through the member insert.
export async function allocateInviteCode(tx: Transaction) {
  for (let attempt = 0; attempt < 8; attempt++) {
    const candidate = String(randomInt(1_000_000)).padStart(6, '0')
    const [used] = await tx.select({ id: members.id }).from(members)
      .where(eq(members.inviteCode, candidate)).limit(1)
    if (!used) return candidate
  }
  // Near capacity, find the first gap (including 000000) rather than retrying indefinitely.
  const [rows] = await tx.execute(sql`
    SELECT LPAD(MIN(used.n + 1), 6, '0') AS available
    FROM (
      SELECT -1 AS n UNION ALL
      SELECT CAST(invite_code AS SIGNED) FROM members WHERE invite_code REGEXP '^[0-9]{6}$'
    ) used
    LEFT JOIN members occupied ON occupied.invite_code = LPAD(used.n + 1, 6, '0')
    WHERE used.n < 999999 AND occupied.id IS NULL
  `)
  const [{ available }] = rows as unknown as [{ available: string | null }]
  if (available === null) fail('INVITE_CODES_EXHAUSTED', '用户邀请码已分配完，请联系平台管理员', 503)
  return available
}
