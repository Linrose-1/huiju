import { drizzle } from 'drizzle-orm/mysql2'
import { createPool } from 'mysql2'

export function createDatabase(connectionString: string) {
  const callbackPool = createPool({ uri: connectionString, timezone: 'Z' })
  const acquireConnection = callbackPool.getConnection.bind(callbackPool)

  // Initialize before handing out a connection, including reused/reset sessions.
  // The driver's timezone option alone does not set MySQL's session time_zone.
  callbackPool.getConnection = (callback) => {
    acquireConnection((error, connection) => {
      if (error) {
        callback(error, connection)
        return
      }
      connection.query("SET SESSION time_zone = '+00:00'", (initError) => {
        if (initError) connection.destroy()
        callback(initError, connection)
      })
    })
  }

  const pool = callbackPool.promise()
  return { db: drizzle(pool), pool }
}
