import { Injectable } from '@nestjs/common'
import { eq } from 'drizzle-orm'
import { randomUUID } from 'node:crypto'
import type { AdminTransaction } from '../admin/service.js'
import { platformBrand, platformBrandAudit } from '../database/schema/platform-brand.js'
import { fail, FlowDatabase } from '../flow/common.js'
import type { BrandDto, BrandInput, PublicBrandDto } from './brand-dto.js'

export const defaultBrand: BrandDto = { displayName: '有聚点', visible: true, version: 0 }

@Injectable()
export class BrandService {
  constructor(private readonly database: FlowDatabase) {}

  async read(tx: AdminTransaction | FlowDatabase['db'] = this.database.db): Promise<BrandDto> {
    const [row] = await tx.select().from(platformBrand).where(eq(platformBrand.id, 'main')).limit(1)
    return row ? { displayName: row.displayName, visible: row.visible, version: row.version } : { ...defaultBrand }
  }

  async publicBrand(): Promise<PublicBrandDto> {
    const { displayName, visible } = await this.read()
    return { displayName, visible }
  }

  async save(tx: AdminTransaction, input: BrandInput, actorId: string): Promise<BrandDto> {
    const displayName = input.displayName.trim()
    if (!displayName || [...displayName].length > 30) fail('INVALID_BRAND_NAME', '品牌名称须为1至30字', 400)
    // Version zero is an unconfigured singleton, inserted only inside this transaction.
    // Concurrent first saves lock the same row and cannot both accept version zero.
    await tx.insert(platformBrand).values({ id: 'main', ...defaultBrand }).onDuplicateKeyUpdate({ set: { id: 'main' } })
    const [row] = await tx.select().from(platformBrand).where(eq(platformBrand.id, 'main')).for('update')
    if (!row || row.version !== input.version) fail('BRAND_VERSION_CONFLICT', '品牌配置已被更新，请重新加载后再保存', 409)
    const before = { displayName: row.displayName, visible: row.visible, version: row.version }
    const after = { displayName, visible: input.visible, version: row.version + 1 }
    await tx.update(platformBrand).set(after).where(eq(platformBrand.id, 'main'))
    await tx.insert(platformBrandAudit).values({ id: randomUUID(), actorId, before, after })
    return after
  }
}
