import { createConnection } from 'mysql2/promise'
import { drizzle } from 'drizzle-orm/mysql2'
import { migrate } from 'drizzle-orm/mysql2/migrator'
import { spawn } from 'node:child_process'
import { resolve } from 'node:path'
import { fileURLToPath, URL } from 'node:url'
import process from 'node:process'
const apiRoot = fileURLToPath(new URL('../', import.meta.url))
async function main() {
  if (process.argv[2] !== '--prepare-and-run') throw new Error('Explicit --prepare-and-run required')
  const source = new URL(process.env.DATABASE_URL || '')
  if (source.protocol !== 'mysql:' || source.hostname !== '127.0.0.1' || source.port !== '3306' || source.pathname !== '/huiju' || source.search) throw new Error('Only authorized local credentials accepted')
  const isolated = new URL(source), name = 'huiju_circle_test_20260930'
  isolated.pathname = '/' + name
  const adminUrl = new URL(source); adminUrl.pathname = '/mysql'
  const admin = await createConnection({ uri: adminUrl.href, timezone: 'Z' })
  let connection
  const snapshot = async () => {
    const [tables] = await admin.query('SELECT TABLE_NAME AS name FROM information_schema.TABLES WHERE TABLE_SCHEMA=? AND TABLE_TYPE=? ORDER BY TABLE_NAME', ['huiju', 'BASE TABLE'])
    const result = []
    for (const { name: table } of tables) {
      if (!/^[a-zA-Z0-9_]+$/.test(table)) throw new Error('Unexpected table')
      const [rows] = await admin.query('SELECT COUNT(*) AS count FROM `huiju`.`' + table + '`')
      const [hashes] = await admin.query('CHECKSUM TABLE `huiju`.`' + table + '`')
      result.push([table, rows[0].count, hashes[0].Checksum])
    }
    return JSON.stringify(result)
  }
  try {
    const [existing] = await admin.query('SELECT SCHEMA_NAME FROM information_schema.SCHEMATA WHERE SCHEMA_NAME=?', [name])
    if (existing.length) throw new Error('Test database exists; refusing to replace or reuse automatically')
    const before = await snapshot()
    await admin.query('CREATE DATABASE `huiju_circle_test_20260930` CHARACTER SET utf8mb4 COLLATE utf8mb4_bin')
    connection = await createConnection({ uri: isolated.href, timezone: 'Z' })
    await connection.query("SET SESSION time_zone='+00:00'")
    await migrate(drizzle(connection), { migrationsFolder: resolve(apiRoot, 'drizzle') })
    const [migrations] = await connection.query('SELECT COUNT(*) AS count FROM __drizzle_migrations')
    process.stdout.write(`Prepared 127.0.0.1:3306/${name}; migrations=${migrations[0].count}\n`)
    const code = await new Promise((yes, no) => {
      const child = spawn(process.execPath, [resolve(apiRoot, 'node_modules/vitest/vitest.mjs'), 'run', 'test/circle-database.spec.ts'], { cwd: apiRoot, stdio: 'inherit', windowsHide: true,
        env: { ...process.env, DATABASE_URL: '', TEST_DATABASE_URL: isolated.href, HUIJU_DB_TEST: 'circle-isolated' } })
      child.on('error', no); child.on('exit', code => yes(code ?? 1))
    })
    if (before !== await snapshot()) throw new Error('Development huiju snapshot changed during test')
    const [left] = await connection.query('SELECT (SELECT COUNT(*) FROM circle_posts)+(SELECT COUNT(*) FROM circle_images)+(SELECT COUNT(*) FROM circle_intents)+(SELECT COUNT(*) FROM circle_operations) AS count')
    process.stdout.write(`Development huiju counts/checksums unchanged; circle test rows=${left[0].count}; isolated database retained.\n`)
    process.exitCode = code
  } finally { await connection?.end(); await admin.end() }
}
main().catch(error => { process.stderr.write((error.code ? `Isolated preparation failed (${error.code})` : error.message) + '\n'); process.exitCode = 1 })
