import { drizzle } from 'drizzle-orm/mysql2'
import { createPool } from 'mysql2/promise'

export function createDatabase(connectionString: string) {
  const pool = createPool(connectionString)
  return { db: drizzle(pool), pool }
}
