import { getTableName, type SQL } from 'drizzle-orm'
import { MySqlDialect } from 'drizzle-orm/mysql-core'
import { FlowDatabase } from '../src/flow/common.js'
import { members } from '../src/database/schema/members.js'
import { activities } from '../src/database/schema/activities.js'
import { recommendationConversions, recommendationEvents, recommendationReservations, recommendationSearches } from '../src/database/schema/recommendations.js'

type Row = Record<string, unknown>
const dialect = new MySqlDialect()
const key = (name: string) => name.replace(/_([a-z])/g, (_match, letter: string) => letter.toUpperCase())
const time = (value: unknown) => value instanceof Date ? value.getTime() : new Date(String(value).replace(' ', 'T') + (String(value).includes('Z') ? '' : 'Z')).getTime()

// A rollback-capable serialized repository substitute: exercises actual service decisions
// and SQL scope, not MySQL locks, constraints or query execution.
export function recommendationRepository(memberIds = ['member']) {
  const tables = [members, activities, recommendationSearches, recommendationReservations, recommendationEvents, recommendationConversions]
  let rows = new Map(tables.map(table => [getTableName(table), [] as Row[]]))
  rows.set(getTableName(members), memberIds.map(id => ({ id, kind: 'member' })))
  let activeTransactions = 0, tail = Promise.resolve()
  const locks: string[] = []
  const values = (table: unknown) => rows.get(getTableName(table as typeof members))!
  const filter = (where?: SQL) => {
    if (!where) return () => true
    const query = dialect.sqlToQuery(where)
    let index = 0
    const predicates = [...query.sql.matchAll(/`\w+`\.`(\w+)`\s*(is not null|=|>=|<=|<|>)\s*(\?)?/g)].map(match => {
      const property = key(match[1]), operator = match[2], expected = match[3] ? query.params[index++] : undefined
      return (row: Row) => {
        const actual = row[property]
        if (operator === 'is not null') return actual != null
        if (actual == null) return false
        const left = actual instanceof Date ? time(actual) : actual
        const right = actual instanceof Date ? time(expected) : expected
        if (operator === '=') return left === right
        if (operator === '>=') return left! >= right!
        if (operator === '<=') return left! <= right!
        if (operator === '<') return left! < right!
        return left! > right!
      }
    })
    if (!predicates.length || index !== query.params.length) throw new Error(`Unsupported fixture predicate: ${query.sql}`)
    return (row: Row) => predicates.every(predicate => predicate(row))
  }
  const db = {
    select: (fields?: Row) => ({ from: (table: unknown) => {
      let where: SQL | undefined
      const read = () => {
        const found = values(table).filter(filter(where))
        return fields && 'total' in fields ? [{ total: found.length }] : structuredClone(found)
      }
      const builder = {
        where: (condition: SQL) => { where = condition; return builder },
        for: async () => { locks.push(getTableName(table as typeof members)); return read() },
        then: (resolve: (result: unknown) => unknown, reject: (error: unknown) => unknown) => Promise.resolve().then(read).then(resolve, reject),
      }
      return builder
    } }),
    insert: (table: unknown) => ({ values: (input: Row) => {
      const write = (set?: Row) => {
        const list = values(table), row: Row = { createdAt: new Date(), tokenHash: null, ...structuredClone(input) }
        const existing = list.find(item => table === recommendationReservations ? item.memberId === row.memberId
          : table === recommendationEvents ? item.searchId === row.searchId && item.activityId === row.activityId && item.kind === row.kind
            : table === recommendationConversions ? item.registrationOperationId === row.registrationOperationId : item.id === row.id)
        if (existing) { if (!set) throw new Error('Duplicate key'); Object.assign(existing, structuredClone(set)) }
        else list.push(row)
      }
      return { onDuplicateKeyUpdate: async ({ set }: { set: Row }) => write(set),
        then: (resolve: (result: unknown) => unknown, reject: (error: unknown) => unknown) => Promise.resolve().then(() => write()).then(resolve, reject) }
    } }),
    update: (table: unknown) => ({ set: (set: Row) => ({ where: async (where: SQL) => {
      for (const row of values(table).filter(filter(where))) Object.assign(row, structuredClone(set))
    } }) }),
    delete: (table: unknown) => ({ where: async (where: SQL) => { rows.set(getTableName(table as typeof members), values(table).filter(row => !filter(where)(row))) } }),
    transaction: async <T>(work: (tx: unknown) => Promise<T>) => {
      const before = tail
      let release!: () => void
      tail = new Promise<void>(resolve => { release = resolve })
      await before
      activeTransactions++
      const snapshot = structuredClone(rows)
      try { return await work(db) }
      catch (error) { rows = snapshot; throw error }
      finally { activeTransactions--; release() }
    },
  }
  return { database: { db } as unknown as FlowDatabase, rows: values, locks, get activeTransactions() { return activeTransactions } }
}
