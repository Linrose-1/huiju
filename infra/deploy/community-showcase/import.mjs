import { createHash, randomInt, randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { communityUserNumber } from '../../../apps/api/dist/flow/member-number.js'
import { batchActivityId, populate } from './populate.mjs'
import { prepareMedia, refreshAds } from './media.mjs'

const require = createRequire(new URL('../../../apps/api/package.json', import.meta.url))
const content = JSON.parse(await readFile(new URL('./content.json', import.meta.url)))
const phones = [process.env.SHOWCASE_PRIMARY_PHONE, process.env.SHOWCASE_SECONDARY_PHONE]
const url = new URL(process.env.DATABASE_URL)
const mode = process.argv[2]
if (process.argv.length !== 3 || !['--apply', '--check'].includes(mode) ||
  url.protocol !== 'mysql:' || !['127.0.0.1', 'localhost'].includes(url.hostname) ||
  (url.port || '3306') !== '3306' || url.pathname !== '/huiju' ||
  phones.some(phone => !/^1\d{10}$/.test(phone || '')) || phones[0] === phones[1]) {
  throw Error('请核对执行模式、目标本机 huiju 数据库和两个不同的手机号')
}
const c = await require('mysql2/promise').createConnection({uri: url.href, timezone:'Z'})
const rows = async (sql, params = []) => (await c.query(sql, params))[0]
const insert = (table, value) => c.query('INSERT INTO ' + c.escapeId(table) + ' SET ?', value)
const businessTables = [
  'activity_recommendation_conversions', 'activity_recommendation_events', 'activity_recommendation_reservations',
  'activity_recommendation_searches', 'ai_activity_draft_reservations', 'ai_activity_draft_usages',
  'ai_poster_reservations', 'ai_poster_usages', 'activity_poster_shares','activity_poster_copies',
  'activity_invite_codes', 'notifications', 'feedback_moderation_logs', 'activity_reviews', 'activity_comments',
  'reading_events', 'reading_visitors', 'registration_operations', 'registration_answers', 'registrations',
  'registration_questions', 'activity_operations', 'activities', 'circle_post_read_events', 'circle_operations',
  'circle_intents', 'circle_post_images', 'circle_posts', 'circle_images'
]
async function verifySchema() {
  const dir = new URL('../../../apps/api/drizzle/', import.meta.url)
  const {entries} = JSON.parse(await readFile(new URL('meta/_journal.json', dir)))
  const ledger = await rows('SELECT hash,created_at FROM __drizzle_migrations ORDER BY created_at')
  if (entries.length !== 27 || ledger.length !== entries.length) throw Error('迁移范围应为 0000 至 0026')
  for (const [index, entry] of entries.entries()) {
    const sql = await readFile(new URL(entry.tag + '.sql', dir), 'utf8')
    const hashes = [sql, sql.replace(/\r\n/g,'\n'), sql.replace(/\r?\n/g,'\r\n')].map(s => createHash('sha256').update(s).digest('hex'))
    if (!hashes.includes(ledger[index].hash) || Number(ledger[index].created_at) !== entry.when) throw Error('迁移不匹配 ' + entry.tag)
  }
}
async function stats() {
  return (await rows(`SELECT (SELECT COUNT(*) FROM activities) gatherings,
    (SELECT COUNT(*) FROM circle_posts) posts,(SELECT COUNT(*) FROM members WHERE kind='member') members,
    (SELECT COUNT(*) FROM registrations) registrations,(SELECT SUM(attended) FROM registrations) attended,
    (SELECT COUNT(*) FROM circle_post_read_events) post_reads,(SELECT COUNT(*) FROM reading_events) gathering_reads,
    (SELECT COUNT(*) FROM activities a WHERE a.active_registration_count <>
      (SELECT COUNT(*) FROM registrations r WHERE r.activity_id=a.id AND r.status='active')) inconsistent`))[0]
}
let media, committing = false
try {
  await verifySchema()
  if ((await rows("SELECT GET_LOCK('huiju_showcase_20261115',0) ok"))[0].ok !== 1) throw Error('另一个导入正在执行')
  await c.beginTransaction()
  const accounts = []
  for (const phone of phones) {
    const found = await rows(`SELECT m.id,m.bound_phone phone,m.display_name name,m.inviter_member_id,
      cm.user_number,cm.is_registered,cm.is_admin,w.app_id FROM members m
      LEFT JOIN community_members cm ON cm.member_id=m.id AND cm.community_id='xuejia'
      LEFT JOIN wechat_identities w ON w.member_id=m.id WHERE m.kind='member' AND m.bound_phone=? FOR UPDATE`, [phone])
    if (found.length !== 1 || !found[0].user_number) throw Error('账号或社群归属缺失或重复，尾号 ' + phone.slice(-4))
    // A local development profile is usable through the simulator without a live WeChat identity.
    const localSimulator = process.platform === 'win32' && process.env.SHOWCASE_LOCAL_SIMULATOR === '1'
    if (!localSimulator && (!process.env.WECHAT_MINIAPP_APP_ID || found[0].app_id !== process.env.WECHAT_MINIAPP_APP_ID)) throw Error('账号缺少当前小程序绑定，尾号 ' + phone.slice(-4))
    accounts.push(found[0])
  }
  const before = await stats()
  const applied = (await rows('SELECT id FROM activities WHERE id=?',[batchActivityId])).length > 0
  console.log(JSON.stringify({before, applied, accounts:accounts.map(a=>({suffix:a.phone.slice(-4), registered:a.is_registered, admin:a.is_admin}))}))
  if (mode === '--apply' && !applied) {
    const [community] = await rows("SELECT * FROM communities WHERE id='xuejia' FOR UPDATE")
    if ((await rows('SELECT COUNT(*) n FROM communities'))[0].n !== 1) throw Error('检测到其他社群，请先复核清理范围')
    media = await prepareMedia({avatarDir:process.env.LOCAL_AVATAR_DIRECTORY, coverDir:process.env.LOCAL_COVER_DIRECTORY, circleDir:process.env.LOCAL_CIRCLE_DIRECTORY})
    // Preserve the two users, their original invitation chains and platform editors.
    const keep = new Set(accounts.map(a=>a.id))
    for (const row of await rows("SELECT id FROM members WHERE kind='platform_root' UNION SELECT member_id FROM platform_editors")) keep.add(row.id)
    for (const id of keep) {
      const [m] = await rows('SELECT inviter_member_id FROM members WHERE id=?',[id])
      if (m?.inviter_member_id) keep.add(m.inviter_member_id)
    }
    const ids = [...keep]
    for (const table of businessTables) await c.query('DELETE FROM ' + c.escapeId(table))
    for (const table of ['member_sessions','wechat_identities','member_visibilities','community_members','legal_consents']) {
      await c.query('DELETE FROM ' + c.escapeId(table) + ' WHERE member_id NOT IN (?)',[ids])
    }
    const [root] = await rows("SELECT id FROM members WHERE kind='platform_root'")
    await c.query("UPDATE members SET inviter_member_id=? WHERE kind='member' AND id NOT IN (?)",[root.id,ids])
    await c.query("DELETE FROM members WHERE kind='member' AND id NOT IN (?)",[ids])
    const actors = [...accounts], now = new Date()
    const codes = new Set((await rows('SELECT invite_code FROM members')).map(r=>r.invite_code))
    for (const [i,p] of content.people.entries()) {
      const id = randomUUID(), seq = ++community.last_sequence
      const joined = new Date(+now - (90-i)*86400000)
      const number = communityUserNumber(community.number_prefix,joined,seq)
      let invite
      do { invite = String(randomInt(100000,1000000)) } while (codes.has(invite))
      codes.add(invite)
      const phone = '1000000300' + (i+1)
      await insert('members',{id,member_number:number,invite_code:invite,inviter_member_id:accounts[i%2].id,
        display_name:p.name,bound_phone:phone,avatar_url:await media.avatar(p.name),avatar_set_by_user:1,name_set_by_user:1,
        industry:p.industry,hometown:p.hometown,hometown_city_code:p.city,schools:JSON.stringify([p.school]),bio:p.bio,
        resources:p.resources,needs:p.needs,created_at:joined})
      await insert('community_members',{member_id:id,community_id:'xuejia',sequence_no:seq,user_number:number,joined_at:joined,is_registered:i<6})
      await insert('member_visibilities',{member_id:id,show_bio:1,show_hometown:1,show_resources:1,show_needs:1})
      actors.push({id,name:p.name,phone})
    }
    await c.query("UPDATE communities SET last_sequence=? WHERE id='xuejia'",[community.last_sequence])
    await populate({c,actors,now,media})
    await refreshAds(c)
    const after = await stats()
    if (after.gatherings !== content.gatherings.length || after.posts !== content.posts.length || after.inconsistent || !after.attended) throw Error('导入数量核对失败')
    for (const a of accounts) {
      const [r] = await rows('SELECT (SELECT COUNT(*) FROM activities WHERE organizer_member_id=?) hosted, COUNT(*) joined, SUM(attended) attended FROM registrations WHERE member_id=?',[a.id,a.id])
      if (!r.hosted || !r.joined || !r.attended) throw Error('账号个人活动核对失败')
      console.log(JSON.stringify({suffix:a.phone.slice(-4),...r}))
    }
    committing = true
    await c.commit()
    console.log(JSON.stringify({committed:after}))
  } else {
    await c.rollback()
    console.log(applied ? '本批已存在，未重复导入' : '预检通过')
  }
} catch (e) {
  if (!committing) {
    await c.rollback()
    await media?.rollback()
  }
  console.error(e.code || e.message, e.sqlMessage?.match(/Check constraint '([a-zA-Z0-9_]+)'/)?.[1] || '')
  process.exitCode = 1
} finally {
  await c.end()
}
