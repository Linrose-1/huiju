import { createHash, randomUUID } from 'node:crypto'
import { mkdir, open, readFile, unlink } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { isAbsolute, join } from 'node:path'

const require = createRequire(new URL('../../../apps/api/package.json', import.meta.url))
const sharp = require('sharp')
const assets = new URL('../demo-20261019/assets/', import.meta.url)
const checksums = JSON.parse(await readFile(new URL('../demo-20261019/asset-checksums.json', import.meta.url), 'utf8'))

export async function prepareMedia({ avatarDir, coverDir, circleDir }) {
  for (const directory of [avatarDir, coverDir, circleDir]) {
    if (!directory || !isAbsolute(directory)) throw Error('请提供已核对的媒体绝对目录')
    await mkdir(directory, { recursive: true })
  }
  const images = new Map()
  for (const [name, expected] of Object.entries(checksums)) {
    const image = await readFile(new URL(name + '.jpg', assets))
    if (createHash('sha256').update(image).digest('hex') !== expected) throw Error('素材校验失败：' + name)
    images.set(name, image)
  }
  function imageFor(name) {
    const image = images.get(name)
    if (!image) throw Error('未知素材：' + name)
    return image
  }

  const created = new Set()
  async function save(directory, filename, bytes) {
    const path = join(directory, filename)
    const handle = await open(path, 'wx', 0o644)
    created.add(path)
    try {
      await handle.writeFile(bytes)
    } finally {
      await handle.close()
    }
  }
  return {
    async cover(actorId, assetBasename) {
      if (!/^[a-f0-9-]{36}$/.test(actorId)) throw Error('封面所属用户编号无效')
      const bytes = await sharp(imageFor(assetBasename)).rotate().resize(1000, 800, { fit: 'cover' }).jpeg({ quality: 88 }).toBuffer()
      const filename = actorId + '_' + randomUUID() + '.jpg'
      await save(coverDir, filename, bytes)
      return '/api/v1/media/covers/' + filename
    },
    async circle(assetBasename) {
      const id = randomUUID()
      const filename = id + '.jpg'
      await save(circleDir, filename, imageFor(assetBasename))
      return { id, filename }
    },
    async avatar(name) {
      const bytes = createHash('sha256').update(name).digest()
      const color = ['#487568', '#946548', '#486781', '#746188', '#9B7560', '#517278'][bytes[0] % 6]
      const shapes = []
      // Mirrored tiles make each portrait readable at list size and require no installed fonts.
      for (let row = 0; row < 5; row++) {
        for (let col = 0; col < 3; col++) {
          if ((bytes[row + 1] & (1 << col)) === 0) continue
          for (const x of new Set([col, 4 - col])) {
            shapes.push(`<rect x="${30 + x * 20}" y="${30 + row * 20}" width="19" height="19" rx="5" fill="#fff7e5"/>`)
          }
        }
      }
      const artwork = `<svg width="160" height="160" xmlns="http://www.w3.org/2000/svg"><rect width="160" height="160" fill="${color}"/>${shapes.join('')}</svg>`
      const filename = randomUUID() + '.png'
      await save(avatarDir, filename, await sharp(Buffer.from(artwork)).png().toBuffer())
      return '/api/v1/media/avatars/' + filename
    },
    async rollback() {
      const errors = []
      for (const path of created) {
        try {
          await unlink(path)
          created.delete(path)
        } catch (error) {
          if (error.code !== 'ENOENT') errors.push(error)
        }
      }
      if (errors.length) throw new AggregateError(errors, '未能回收本次创建的部分媒体文件')
    },
  }
}

const campaigns = [
  ['禾仓园运营中心', '走进禾仓园的首层空间', '从卸货区走到工作室，实地看一间首层空间的采光、通行与日常使用。'],
  ['榕影空间', '在长桌上摊开一张平面图', '带上手绘草图和卷尺，聊聊一间工作室的陈列、材料和走动路线。'],
  ['南窗共读社', '周末留一把椅子给读书人', '围坐长桌，每个人带一本书和一段想分享的话，交换下个月想读的书目。'],
]

// Called within the same transaction as the new posts and activities.
export async function refreshAds(c) {
  const [ads] = await c.query(`SELECT a.id, a.introduction_id, a.placements, a.status,
      wide.purpose AS wide_purpose, tall.purpose AS tall_purpose,
      intro.status AS intro_status, cover.purpose AS cover_purpose, intro.blocks,
      a.title, intro.name, intro.company_name, intro.contact_name, intro.summary, intro.phone, intro.wechat_id
    FROM advertising_ads a
    JOIN advertising_introductions intro ON intro.id = a.introduction_id
    LEFT JOIN advertising_images wide ON wide.id = a.wide_image_id
    LEFT JOIN advertising_images tall ON tall.id = a.tall_image_id
    LEFT JOIN advertising_images cover ON cover.id = intro.cover_image_id
    ORDER BY a.sort_order, a.id FOR UPDATE`)
  const contentByIntro = new Map()
  const attachedContacts = new Set()
  const placeholder = /测试|验收|演示|示例|联调|\b(?:test|demo)\b/i
  for (const ad of ads) {
    if (!ad.phone && !ad.wechat_id) continue
    const existingText = [ad.title, ad.name, ad.company_name, ad.contact_name,
      ad.summary, ad.phone, ad.wechat_id, JSON.stringify(ad.blocks)].join(' ')
    // Keep the advertiser and its actual public contact together.
    if (!placeholder.test(existingText)) attachedContacts.add(ad.introduction_id)
  }
  // One introduction can be linked to multiple placements; check every title.
  for (const ad of ads) {
    if (placeholder.test(ad.title)) attachedContacts.delete(ad.introduction_id)
  }
  for (const ad of ads) {
    const placements = typeof ad.placements === 'string' ? JSON.parse(ad.placements) : ad.placements
    if (ad.status === 'published' && (ad.intro_status !== 'published' || ad.cover_purpose !== 'tall'
      || !placements.length || placements.includes('circle') && ad.wide_purpose !== 'wide'
      || placements.some(item => item !== 'circle') && ad.tall_purpose !== 'tall')) {
      throw Error('现有已发布广告缺少对应介绍或媒体，请核对广告配置')
    }
    if (attachedContacts.has(ad.introduction_id)) continue
    if (!contentByIntro.has(ad.introduction_id)) {
      const campaign = campaigns[contentByIntro.size % campaigns.length]
      contentByIntro.set(ad.introduction_id, campaign)
      const [company, title, summary] = campaign
      const existing = typeof ad.blocks === 'string' ? JSON.parse(ad.blocks) : ad.blocks
      const blocks = [{ type: 'text', text: summary }, ...existing.filter(block => block.type === 'image')]
      await c.query(`UPDATE advertising_introductions SET name=?, company_name=?, contact_name=?,
        summary=?, blocks=?, phone='', wechat_id='', version=version+1 WHERE id=?`,
      [title, company, company + '运营组', summary, JSON.stringify(blocks), ad.introduction_id])
    }
    const [, title] = contentByIntro.get(ad.introduction_id)
    await c.query('UPDATE advertising_ads SET title=?, version=version+1 WHERE id=?', [title, ad.id])
  }
  return ads.length
}
