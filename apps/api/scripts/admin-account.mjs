// Explicit maintenance entry point. Never imported during API startup or tests.
import { randomBytes, randomUUID, scrypt } from 'node:crypto'
import process from 'node:process'
import console from 'node:console'
import { URL } from 'node:url'
import { emitKeypressEvents } from 'node:readline'
import mysql from 'mysql2/promise'

async function readPassword(prompt) {
  if (!process.stdin.isTTY || !process.stdout.isTTY) throw new Error('interactive terminal required')
  process.stdout.write(prompt)
  emitKeypressEvents(process.stdin)
  process.stdin.setRawMode(true)
  process.stdin.resume()
  return new Promise((resolve, reject) => {
    let value = ''
    const finish = () => {
      process.stdin.removeListener('keypress', listener)
      process.stdin.setRawMode(false)
      process.stdin.pause()
      process.stdout.write('\n')
    }
    const listener = (text, key = {}) => {
      if (key.ctrl && key.name === 'c') { finish(); reject(new Error('cancelled')); return }
      if (key.name === 'return' || key.name === 'enter') { finish(); resolve(value); return }
      if (key.name === 'backspace') value = value.slice(0, -1)
      else if (!key.ctrl && !key.meta && text && [...text].every(char => char.charCodeAt(0) >= 32 && char.charCodeAt(0) !== 127) && value.length < 128) value += text
    }
    process.stdin.on('keypress', listener)
  })
}

const flags = new Map(process.argv.slice(2).map((item) => {
  const [key, ...value] = item.split('=')
  return [key, value.join('=')]
}))
const mode = flags.get('--mode')
const username = flags.get('--username')
const displayName = flags.get('--display-name')
let connection
try {
  if (!flags.has('--apply') || !['bootstrap', 'recover'].includes(mode) || !username || !/^[a-z0-9][a-z0-9_.-]{2,63}$/.test(username)) throw new Error('arguments')
  if (mode === 'bootstrap' && (!displayName?.trim() || displayName.length > 100)) throw new Error('displayName')
  const url = new URL(process.env.DATABASE_URL ?? '')
  const target = `${url.hostname}:${url.port || '3306'}${url.pathname}`
  if (flags.get('--database-target') !== target || url.protocol !== 'mysql:' || url.search || url.hash) throw new Error('target')
  const password = await readPassword('输入密码（不回显）：')
  if (password.length < 12 || password.length > 128 || !/[a-zA-Z]/.test(password) || !/[0-9]/.test(password)) throw new Error('password')
  if (password !== await readPassword('再次输入密码（不回显）：')) throw new Error('password mismatch')
  const salt = randomBytes(16).toString('hex')
  const key = await new Promise((resolve, reject) => scrypt(password, salt, 64, { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 }, (error, derived) => error ? reject(error) : resolve(derived)))
  const hash = `scrypt-v1$${salt}$${key.toString('hex')}`
  connection = await mysql.createConnection({ uri: process.env.DATABASE_URL, timezone: 'Z' })
  await connection.query("SET SESSION time_zone = '+00:00'")
  // Serialize maintenance bootstrap, including an initially empty credentials table.
  const [locks] = await connection.execute("SELECT GET_LOCK('huiju_admin_maintenance', 10) AS acquired")
  if (locks[0]?.acquired !== 1) throw new Error('lock')
  await connection.beginTransaction()
  let id
  if (mode === 'bootstrap') {
    const [existing] = await connection.execute("SELECT admin_account_id FROM admin_credentials WHERE role = 'super_admin' FOR UPDATE")
    if (existing.length) throw new Error('already initialized')
    id = randomUUID()
    await connection.execute('INSERT INTO admin_accounts (id, display_name) VALUES (?, ?)', [id, displayName.trim()])
    await connection.execute("INSERT INTO admin_credentials (admin_account_id, username, role, password_hash, must_change_password) VALUES (?, ?, 'super_admin', ?, false)", [id, username, hash])
  } else {
    const [rows] = await connection.execute("SELECT a.id FROM admin_accounts a INNER JOIN admin_credentials c ON c.admin_account_id = a.id WHERE c.username = ? AND c.role = 'super_admin' FOR UPDATE", [username])
    if (rows.length !== 1) throw new Error('not found')
    id = rows[0].id
    await connection.execute("UPDATE admin_accounts SET status = 'active' WHERE id = ?", [id])
    await connection.execute('UPDATE admin_credentials SET password_hash = ?, must_change_password = false, failed_attempts = 0, locked_until = NULL WHERE admin_account_id = ?', [hash, id])
    await connection.execute('UPDATE admin_sessions SET revoked_at = CURRENT_TIMESTAMP(3) WHERE admin_account_id = ? AND revoked_at IS NULL', [id])
  }
  await connection.execute('INSERT INTO admin_account_audit (id, actor_id, target_id, action) VALUES (?, NULL, ?, ?)', [randomUUID(), id, mode])
  await connection.commit()
  console.log('管理员维护完成；账号可直接使用已设置的密码登录。')
} catch {
  await connection?.rollback().catch(() => {})
  console.error('未完成管理员维护。核对授权目标、迁移状态、参数和密码要求；不输出凭据或数据库错误。')
  process.exitCode = 1
} finally {
  await connection?.end()
}
