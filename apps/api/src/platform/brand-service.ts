import { Injectable } from '@nestjs/common'
import { eq, inArray } from 'drizzle-orm'
import { randomUUID } from 'node:crypto'
import sharp from 'sharp'
import type { AdminTransaction } from '../admin/service.js'
import { platformBrand, platformBrandAudit, platformBrandImages, type BrandAppearance, type BrandSnapshot } from '../database/schema/platform-brand.js'
import { fail, FlowDatabase } from '../flow/common.js'
import { maxBrandImageBytes, type BrandDto, type BrandImageInput, type BrandInput, type PublicBrandAppearanceDto, type PublicBrandDto } from './brand-dto.js'

export const defaultBrand: BrandDto = { displayName: '有聚点', visible: true, version: 0 }
const defaultTabNames = { circle: '商友圈', activity: '友聚会', assistant: 'i 助手', mine: '我世界' }
const tabKeys = Object.keys(defaultTabNames) as (keyof typeof defaultTabNames)[]
const imageUrl = (id: string | null) => id ? '/api/v1/platform/appearance/images/' + id : null
type BrandReader = AdminTransaction | FlowDatabase['db']

function snapshot(row: BrandSnapshot & { appearance?: BrandAppearance | null }): BrandSnapshot {
  const { displayName, visible, version, appearance } = row
  return { displayName, visible, version, ...(appearance ? { appearance } : {}) }
}

@Injectable()
export class BrandService {
  constructor(private readonly database: FlowDatabase) {}

  async read(tx: BrandReader = this.database.db): Promise<BrandDto> {
    const [row] = await tx.select().from(platformBrand).where(eq(platformBrand.id, 'main')).limit(1)
    return row ? snapshot({ ...row, appearance: row.appearance ?? undefined }) : { ...defaultBrand }
  }

  async publicBrand(): Promise<PublicBrandDto> {
    const { displayName, visible } = await this.read()
    return { displayName, visible }
  }

  async publicAppearance(): Promise<PublicBrandAppearanceDto> {
    const { displayName, visible, appearance } = await this.read()
    const tabNames = { ...defaultTabNames }
    for (const key of tabKeys) tabNames[key] = appearance?.tabNames[key] || defaultTabNames[key]
    const partners = (appearance?.partners ?? []).filter(partner => partner.visible && partner.codeImageId)
      .sort((first, second) => first.sortOrder - second.sortOrder)
      .map(partner => ({ name: partner.name, description: partner.description, logoUrl: imageUrl(partner.logoImageId), codeUrl: imageUrl(partner.codeImageId)! }))
    return { displayName, visible, tabNames, logoUrl: visible ? imageUrl(appearance?.logoImageId ?? null) : null, partners }
  }

  async uploadImage(tx: AdminTransaction, input: BrandImageInput, actorId: string) {
    const bytes = Buffer.from(input.base64, 'base64')
    if (!bytes.length || bytes.length > maxBrandImageBytes || bytes.toString('base64') !== input.base64)
      fail('INVALID_BRAND_IMAGE', '请上传 2 MB 以内的 PNG 或 JPG 图片', 400)
    try {
      const image = sharp(bytes, { limitInputPixels: 4096 * 4096, failOn: 'warning' })
      const metadata = await image.metadata()
      if (metadata.format !== (input.mimeType === 'image/png' ? 'png' : 'jpeg')
        || (metadata.pages ?? 1) !== 1 || !metadata.width || !metadata.height || Math.max(metadata.width, metadata.height) > 4096) throw new Error('invalid image')
      await image.stats()
    } catch { fail('INVALID_BRAND_IMAGE', '图片无法读取，请使用长宽不超过 4096 像素的 PNG 或 JPG', 400) }
    const id = randomUUID()
    await tx.insert(platformBrandImages).values({ id, purpose: input.purpose, mimeType: input.mimeType, base64: input.base64, uploadedBy: actorId })
    return { id }
  }

  async readImage(id: string, tx: BrandReader = this.database.db, admin = false) {
    if (!admin) {
      const url = imageUrl(id), current = await this.publicAppearance()
      if (current.logoUrl !== url && !current.partners.some(partner => partner.logoUrl === url || partner.codeUrl === url))
        fail('BRAND_IMAGE_NOT_FOUND', '找不到该图片', 404)
    }
    const [row] = await tx.select({ mimeType: platformBrandImages.mimeType, base64: platformBrandImages.base64 })
      .from(platformBrandImages).where(eq(platformBrandImages.id, id)).limit(1)
    if (!row) fail('BRAND_IMAGE_NOT_FOUND', '找不到该图片', 404)
    return { bytes: Buffer.from(row.base64, 'base64'), mimeType: row.mimeType }
  }

  private async validateAppearance(tx: AdminTransaction, appearance: BrandAppearance) {
    const ids = new Map<string, 'logo' | 'code'>()
    function include(id: string | null, purpose: 'logo' | 'code') {
      if (!id) return
      if (ids.has(id) && ids.get(id) !== purpose) fail('INVALID_BRAND_IMAGE_REFERENCE', 'Logo 与小程序码须使用对应的图片', 400)
      ids.set(id, purpose)
    }
    include(appearance.logoImageId, 'logo')
    for (const partner of appearance.partners) {
      if (partner.visible && !partner.codeImageId) fail('PARTNER_CODE_REQUIRED', '启用合作小程序前，请先上传小程序码', 400)
      include(partner.logoImageId, 'logo')
      include(partner.codeImageId, 'code')
    }
    if (!ids.size) return
    const rows = await tx.select({ id: platformBrandImages.id, purpose: platformBrandImages.purpose })
      .from(platformBrandImages).where(inArray(platformBrandImages.id, [...ids.keys()]))
    if (rows.length !== ids.size || rows.some(row => ids.get(row.id) !== row.purpose))
      fail('INVALID_BRAND_IMAGE_REFERENCE', '图片不存在或用途不匹配，请重新上传', 400)
  }

  async save(tx: AdminTransaction, input: BrandInput, actorId: string): Promise<BrandDto> {
    const displayName = input.displayName.trim()
    if (!displayName || [...displayName].length > 30) fail('INVALID_BRAND_NAME', '品牌名称须为1至30字', 400)
    // Version zero is an unconfigured singleton, inserted only inside this transaction.
    // Concurrent first saves lock the same row and cannot both accept version zero.
    await tx.insert(platformBrand).values({ id: 'main', ...defaultBrand }).onDuplicateKeyUpdate({ set: { id: 'main' } })
    const [row] = await tx.select().from(platformBrand).where(eq(platformBrand.id, 'main')).for('update')
    if (!row || row.version !== input.version) fail('BRAND_VERSION_CONFLICT', '品牌配置已被更新，请重新加载后再保存', 409)
    if (input.appearance) await this.validateAppearance(tx, input.appearance)
    const before = snapshot({ ...row, appearance: row.appearance ?? undefined })
    const after = snapshot({ displayName, visible: input.visible, version: row.version + 1, appearance: input.appearance ?? before.appearance })
    await tx.update(platformBrand).set(after).where(eq(platformBrand.id, 'main'))
    await tx.insert(platformBrandAudit).values({ id: randomUUID(), actorId, before, after })
    return after
  }
}
