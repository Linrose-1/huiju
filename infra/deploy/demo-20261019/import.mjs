import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { createRequire } from 'node:module'
import { readFile, writeFile, mkdir, stat, unlink, open } from 'node:fs/promises'
import { dirname, resolve, isAbsolute } from 'node:path'
import { fileURLToPath, pathToFileURL, URL } from 'node:url'
import { parseArgs } from 'node:util'
import { userInfo } from 'node:os'
import process from 'node:process'
import console from 'node:console'

const here = dirname(fileURLToPath(import.meta.url))
const root = resolve(here, '../../..')
const uuidPattern = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/
export const hash = bytes => createHash('sha256').update(bytes).digest('hex')
const idFor = (batch, owner, key) => {
  const h = hash(`${batch}:${owner}:${key}`).slice(0, 32)
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-5${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20)}`
}
function requireValue(condition, message) {
  if (!condition) throw Object.assign(new Error(message), { safeMessage: message })
}
export function buildPlan(content, ownerId, baseDate) {
  requireValue(uuidPattern.test(ownerId), 'member-id必须为明确核对的会员UUID')
  requireValue(/^\d{4}-\d{2}-\d{2}$/.test(baseDate), 'base-date必须为YYYY-MM-DD')
  const anchor = Date.parse(`${baseDate}T00:00:00+08:00`)
  requireValue(Number.isFinite(anchor) && new Date(anchor + 8 * 3600000).toISOString().slice(0, 10) === baseDate, '日期无效')
  requireValue(content.batchId === 'huiju-demo-20261019-v1', '批次不匹配')
  requireValue(content.activities.length === 12 && content.posts.length === 8, '内容数量不匹配')
  requireValue(content.activityNotice.includes('仅供') && content.postNotice.includes('仅供'), '必须保留演示说明')
  const assets = new Map(content.assets.map(a => [a.key, a]))
  requireValue(assets.size === 6, '素材应为六张独立照片')
  for (const a of assets.values()) {
    requireValue(a.file === `assets/${a.key}.jpg` && /^[a-z]+$/.test(a.key), '素材路径无效')
    requireValue(a.source.startsWith('https://unsplash.com/photos/') && a.license === 'https://unsplash.com/license', '素材来源缺失')
  }
  const note = key => `场景配图：${assets.get(key).photographer} / Unsplash，非本活动或资源实拍，图中人物不代表参与者或推荐者。`
  const activities = content.activities.map(a => {
    requireValue(assets.has(a.image), '活动图片不存在')
    requireValue(Number.isInteger(a.dayOffset) && a.dayOffset >= 2 && /^\d{2}:\d{2}$/.test(a.time), '活动须安排在导入日两天之后')
    const [hour, minute] = a.time.split(':').map(Number)
    requireValue(hour < 24 && minute < 60 && a.durationMinutes > 0, '活动时间无效')
    const startsAt = new Date(anchor + a.dayOffset * 86400000 + hour * 3600000 + minute * 60000)
    const descriptionDelta = { ops: [] }
    for (const [heading, body] of a.sections) {
      descriptionDelta.ops.push({ insert: heading + '\n', attributes: { bold: true } }, { insert: body + '\n\n' })
    }
    descriptionDelta.ops.push({ insert: '体验说明\n', attributes: { bold: true } }, { insert: content.activityNotice + '\n' + note(a.image) + '\n' })
    const description = descriptionDelta.ops.map(op => op.insert).join('').trim()
    const questions = a.questions.map((q, i) => ({ ...q, options: q.options ?? null, id: idFor(content.batchId, ownerId, `${a.key}:question:${i}`) }))
    return { key: a.key, image: a.image, id: idFor(content.batchId, ownerId, `activity:${a.key}`), input: {
      title: a.title, description, descriptionDelta, registrationNotice: content.activityNotice,
      coverUrl: `/api/v1/media/covers/${ownerId}_${idFor(content.batchId, ownerId, `cover:${a.image}`)}.jpg`,
      location: a.location, consultationContact: content.consultationContact,
      startsAt: startsAt.toISOString(), endsAt: new Date(startsAt.getTime() + a.durationMinutes * 60000).toISOString(),
      registrationDeadline: new Date(startsAt.getTime() - 6 * 3600000).toISOString(),
      capacity: a.capacity, feeType: a.feeAmountCents == null ? 'free' : 'paid', feeAmountCents: a.feeAmountCents, questions,
    } }
  })
  const posts = content.posts.map(p => {
    requireValue(assets.has(p.image) && ['park', 'operation', 'service', 'store'].includes(p.category), '帖子类别或图片无效')
    const body = `${p.body}\n\n体验说明\n${content.postNotice}\n${note(p.image)}`
    return { key: p.key, image: p.image, id: idFor(content.batchId, ownerId, `post:${p.key}`), input: {
      requestId: idFor(content.batchId, ownerId, `request:${p.key}`), category: p.category, subtype: p.subtype,
      title: p.title, body, location: p.location, area: p.area ?? null, price: p.price ?? null,
      validUntil: p.category === 'park' ? new Date(anchor + 30 * 86400000 + 8 * 3600000).toISOString().slice(0, 10) : null,
      storeName: p.storeName ?? null, imageIds: [idFor(content.batchId, ownerId, `circle-image:${p.image}`)],
    } }
  })
  const ids = [...activities, ...posts].map(x => x.id)
  requireValue(new Set(ids).size === ids.length, '内容ID重复')
  return { batchId: content.batchId, ownerId, baseDate, activities, posts }
}

export function verifyEnvironment(env, options, platform) {
  requireValue(platform === 'linux' && env.NODE_ENV === 'production', '仅允许服务器Linux生产进程显式执行，不在本机开发库运行')
  const target = new URL(env.DATABASE_URL || 'invalid:')
  const actual = `${target.hostname}:${target.port || '3306'}${target.pathname}`
  requireValue(target.protocol === 'mysql:' && target.search === '' && actual === options['database-target'] && actual === '127.0.0.1:3306/huiju', '数据库目标不匹配')
  requireValue(env.ADMIN_ORIGIN === 'https://106.55.240.34:8443', '服务器入口不匹配')
  requireValue(/^HJ\d{14}$/.test(options['member-number'] || ''), '必须显式提供核对后的会员编号')
  for (const key of ['backup-file', 'receipt-file']) requireValue(isAbsolute(options[key] || ''), `${key}须为服务器绝对路径`)
  requireValue(!resolve(options['receipt-file']).startsWith(root + '/') && !resolve(options['backup-file']).startsWith(root + '/'), '备份和回执必须放在仓库外')
  for (const key of ['LOCAL_COVER_DIRECTORY', 'LOCAL_CIRCLE_DIRECTORY']) requireValue(isAbsolute(env[key] || ''), `${key}须配置持久绝对路径`)
}

export async function applyPlan(plan, content, options, env) {
  const require = createRequire(resolve(root, 'apps/api/package.json'))
  const mysql = require('mysql2/promise')
  const { validAvatar, complete } = await import(pathToFileURL(resolve(root, 'apps/api/dist/flow/identity.js')))
  const { activityValues } = await import(pathToFileURL(resolve(root, 'apps/api/dist/flow/organizer.js')))
  const { postValues } = await import(pathToFileURL(resolve(root, 'apps/api/dist/circle/service.js')))
  const backup = await stat(options['backup-file'])
  requireValue(backup.isFile() && backup.size > 100 && Date.now() - backup.mtimeMs < 7200000, '须提供两小时内完成并已校验的数据库备份')
  const bytes = new Map()
  const checksums = JSON.parse(await readFile(resolve(here, 'asset-checksums.json'), 'utf8'))
  for (const asset of content.assets) {
    const image = await readFile(resolve(here, asset.file))
    requireValue(hash(image) === checksums[asset.key], '素材校验和不匹配')
    await validAvatar({ base64: image.toString('base64'), mimeType: 'image/jpeg' })
    bytes.set(asset.key, image)
  }
  for (const a of plan.activities) {
    activityValues(a.input)
    requireValue(new Date(a.input.startsAt) > new Date(), '演示活动开始时间已过，请先检查基准日期')
  }
  for (const p of plan.posts) postValues(p.input)
  await mkdir(dirname(options['receipt-file']), { recursive: true, mode: 0o700 })
  const receipt = await open(options['receipt-file'], 'wx', 0o600)
  const stamp = async value => { await receipt.write(JSON.stringify(value) + '\n'); await receipt.sync() }
  const newFiles = []
  let db, committed = false, commitAttempted = false
  const result = { activitiesInserted: 0, postsInserted: 0, activitiesSkipped: 0, postsSkipped: 0 }
  try {
    await stamp({ event: 'prepared', batchId: plan.batchId, ownerId: plan.ownerId, memberNumber: options['member-number'], baseDate: plan.baseDate,
      contentHash: hash(await readFile(resolve(here, 'content.json'))), backupFile: options['backup-file'], ids: [...plan.activities, ...plan.posts].map(x => x.id) })
    const url = new URL(env.DATABASE_URL)
    db = await mysql.createConnection({ host: url.hostname, port: Number(url.port || 3306), database: url.pathname.slice(1),
      user: decodeURIComponent(url.username), password: decodeURIComponent(url.password), timezone: 'Z' })
    await db.execute("SET SESSION time_zone = '+00:00'")
    const [[lock]] = await db.execute('SELECT GET_LOCK(?, 5) AS acquired', [`${plan.batchId}:${plan.ownerId}`])
    requireValue(lock.acquired === 1, '同一批次正在执行，请稍后核对，不要并发导入')
    await db.beginTransaction()
    const [[member]] = await db.execute('SELECT * FROM members WHERE id = ? FOR UPDATE', [plan.ownerId])
    requireValue(member?.kind === 'member' && member.member_number === options['member-number'], '目标会员身份不匹配')
    requireValue(complete({ avatarUrl: member.avatar_url, displayName: member.display_name, boundPhone: member.bound_phone,
      avatarSetByUser: Boolean(member.avatar_set_by_user), nameSetByUser: Boolean(member.name_set_by_user) }), '目标账号须先本人完成头像、名称和手机号，不代补资料')
    const [[identity]] = await db.execute('SELECT COUNT(*) AS total FROM wechat_identities WHERE member_id = ? AND app_id = ?', [plan.ownerId, 'wx0797ad5030ad418e'])
    requireValue(Number(identity.total) === 1, '目标账号不是当前小程序已建立的真实微信身份')
    const beforeMemberHash = hash(JSON.stringify(member))
    const media = async (directory, name, image) => {
      await mkdir(directory, { recursive: true })
      const path = resolve(directory, name)
      try { await writeFile(path, bytes.get(image), { flag: 'wx', mode: 0o640 }); newFiles.push(path) }
      catch (e) { if (e.code !== 'EEXIST') throw e; requireValue(hash(await readFile(path)) === checksums[image], '已有媒体内容不同，停止而不覆盖') }
    }
    for (const a of plan.activities) {
      const [[existing]] = await db.execute('SELECT organizer_member_id FROM activities WHERE id = ?', [a.id])
      if (existing) { requireValue(existing.organizer_member_id === plan.ownerId, '已有活动归属冲突'); result.activitiesSkipped++; continue }
      const v = activityValues(a.input)
      await media(env.LOCAL_COVER_DIRECTORY, a.input.coverUrl.split('/').at(-1), a.image)
      await db.execute(`INSERT INTO activities (id,organizer_member_id,title,description,description_delta,registration_notice,cover_url,location,consultation_contact,
        starts_at,ends_at,registration_deadline,capacity,fee_type,fee_amount_cents,lifecycle,moderation,published_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,'published','normal',?)`,
      [a.id,plan.ownerId,v.title,v.description,JSON.stringify(v.descriptionDelta),v.registrationNotice,v.coverUrl,v.location,v.consultationContact,
        v.startsAt,v.endsAt,v.registrationDeadline,v.capacity,v.feeType,v.feeAmountCents,new Date()])
      for (const [i,q] of a.input.questions.entries()) await db.execute(
        'INSERT INTO registration_questions (id,activity_id,type,prompt,required,sort_order,options) VALUES (?,?,?,?,?,?,?)',
        [q.id,a.id,q.type,q.prompt,q.required,i,q.options == null ? null : JSON.stringify(q.options)])
      await db.execute('INSERT INTO activity_operations (id,activity_id,actor_type,actor_member_id,action,reason,change_summary) VALUES (?,?,\'member\',?,\'publish\',?,?)',
        [idFor(plan.batchId,plan.ownerId,`${a.key}:publish`),a.id,plan.ownerId,'用户明确授权的演示内容导入',JSON.stringify({ batchId: plan.batchId, source: 'demo-import' })])
      result.activitiesInserted++
    }
    for (const p of plan.posts) {
      const [[existing]] = await db.execute('SELECT author_id FROM circle_posts WHERE id = ?', [p.id])
      if (existing) { requireValue(existing.author_id === plan.ownerId, '已有帖子归属冲突'); result.postsSkipped++; continue }
      const v = postValues(p.input), imageId = p.input.imageIds[0], filename = `${imageId}.jpg`
      await media(env.LOCAL_CIRCLE_DIRECTORY, filename, p.image)
      const [[image]] = await db.execute('SELECT owner_id,filename FROM circle_images WHERE id = ?', [imageId])
      if (image) requireValue(image.owner_id === plan.ownerId && image.filename === filename, '已有图片归属冲突')
      else await db.execute('INSERT INTO circle_images (id,owner_id,filename) VALUES (?,?,?)', [imageId,plan.ownerId,filename])
      await db.execute(`INSERT INTO circle_posts (id,author_id,request_id,category,subtype,title,body,location,area,price,valid_until,store_name)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`, [p.id,plan.ownerId,p.input.requestId,v.category,v.subtype,v.title,v.body,v.location,v.area,v.price,v.validUntil,v.storeName])
      await db.execute('INSERT INTO circle_post_images (id,post_id,image_id,position) VALUES (?,?,?,0)', [idFor(plan.batchId,plan.ownerId,`${p.key}:image`),p.id,imageId])
      result.postsInserted++
    }
    const [[afterMember]] = await db.execute('SELECT * FROM members WHERE id = ?', [plan.ownerId])
    assert.equal(hash(JSON.stringify(afterMember)), beforeMemberHash, '账号资料发生变化')
    await stamp({ event: 'ready-to-commit', ...result, newFiles })
    if (options.rehearse) {
      await db.rollback()
      for (const path of newFiles) await unlink(path)
      await stamp({ event: 'rehearsed-rolled-back', ...result })
      return result
    }
    commitAttempted = true
    await db.commit(); committed = true
    await stamp({ event: 'committed', ...result, at: new Date().toISOString() })
    return result
  } catch (error) {
    if (!commitAttempted) {
      await db?.rollback().catch(() => {})
      for (const path of newFiles) await unlink(path).catch(() => {})
      await stamp({ event: 'rolled-back' }).catch(() => {})
    } else {
      await stamp({ event: committed ? 'committed-receipt-error' : 'commit-outcome-unknown' }).catch(() => {})
      console.error('已尝试提交；请按批次ID核对数据库结果，不要自动重试、删除媒体或恢复旧库。')
    }
    throw error
  } finally {
    await db?.end().catch(() => {})
    await receipt.close()
  }
}

async function main() {
  const { values } = parseArgs({ options: {
    apply: { type: 'boolean', default: false }, rehearse: { type: 'boolean', default: false }, 'member-id': { type: 'string' }, 'member-number': { type: 'string' },
    'database-target': { type: 'string' }, 'base-date': { type: 'string' }, 'backup-file': { type: 'string' }, 'receipt-file': { type: 'string' },
  } })
  const content = JSON.parse(await readFile(resolve(here, 'content.json'), 'utf8'))
  const baseDate = values['base-date'] || new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Shanghai' }).format(new Date())
  requireValue(!(values.apply && values.rehearse), 'apply与rehearse不能同时指定')
  if (values.apply || values.rehearse) verifyEnvironment(process.env, values, process.platform)
  if (values.apply || values.rehearse) requireValue(userInfo().username === 'huiju', '请以huiju服务用户执行，确保媒体归属和权限正确')
  const plan = buildPlan(content, values['member-id'] || '00000000-0000-5000-a000-000000000001', baseDate)
  if (!values.apply && !values.rehearse) {
    console.log(JSON.stringify({ mode: 'plan-only-no-database', ownerConfirmed: Boolean(values['member-id']), ...plan }, null, 2))
    return
  }
  requireValue(values['member-id'], '必须显式提供会员UUID')
  console.log(JSON.stringify({ batchId: plan.batchId, status: values.rehearse ? 'rehearsed-rolled-back' : 'committed', ...await applyPlan(plan, content, values, process.env) }))
}
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  main().catch(error => {
    const safe = error.safeMessage || (error.code ? `错误码：${error.code}` : '请核对执行参数、账号完整度、备份与服务器配置')
    console.error(`演示批次导入未正常结束；${safe}。禁止输出连接串或原始SQL错误；按回执和批次ID核对状态。`)
    process.exitCode = 1
  })
}
