import { Injectable } from '@nestjs/common'
import { and, asc, desc, eq, like, or, sql } from 'drizzle-orm'
import { randomUUID } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import sharp from 'sharp'
import type { AdminTransaction } from '../admin/service.js'
import { advertisingAds as ads, advertisingAudit as audit, advertisingBackground as backgrounds, advertisingImages as images, advertisingIntroductions as introductions } from '../database/schema/advertising.js'
import { fail, FlowDatabase } from '../flow/common.js'
import { AdvertisingAdDto, AdvertisingAdInput, AdvertisingAdminQuery, AdvertisingBackgroundDto, AdvertisingBackgroundInput, AdvertisingImageDto, AdvertisingImageInput, AdvertisingIntroductionDto, AdvertisingIntroductionInput, AdvertisingPublicQuery, AdvertisingStatusInput } from './dto.js'
type Db = AdminTransaction | FlowDatabase['db']
type Introduction = typeof introductions.$inferSelect
type Ad = typeof ads.$inferSelect
const sourceUrl = (id: string|null) => id ? `/api/v1/admin/advertising/images/${id}` : null
const imageUrl = (id: string|null) => id ? `/api/v1/advertising/images/${id}` : null
export function checkVersion(actual: number, expected: number) { if (actual !== expected) fail('ADVERTISING_CONFLICT', '内容已被其他管理员修改，请重新加载后再保存', 409) }
export function introductionValues(input: AdvertisingIntroductionInput) {
  const { name, companyName, contactName, phone, wechatId, summary, coverImageId } = input
  if (!name.trim()) fail('ADVERTISING_INVALID', '请填写项目名称')
  const blocks = input.blocks.map(block => {
    if (block.type === 'text') {
      if (!block.text?.trim() || block.imageId !== undefined) fail('ADVERTISING_INVALID', '文字段落不能为空或同时包含图片')
      return { type: 'text' as const, text: block.text.trim() }
    }
    if (!block.imageId || block.text !== undefined) fail('ADVERTISING_INVALID', '图片段落须选择已上传图片')
    return { type: 'image' as const, imageId: block.imageId }
  })
  if (phone && !/^[+\d][\d ()-]{4,39}$/.test(phone)) fail('ADVERTISING_INVALID', '联系电话格式不正确')
  return { name: name.trim(), companyName: companyName.trim(), contactName: contactName.trim(), phone: phone.trim(), wechatId: wechatId.trim(), summary: summary.trim(), coverImageId, blocks }
}
export function requireIntroductionReady(row: AdvertisingIntroductionInput) {
  if (!row.name || !row.companyName || !row.contactName || (!row.phone && !row.wechatId) || !row.coverImageId || !row.blocks.length) fail('ADVERTISING_INCOMPLETE', '请补齐名称、企业、联系人、联系方式、封面与介绍内容后上架')
}
export function requireAdReady(row: AdvertisingAdInput) {
  if (!row.title.trim() || !row.placements.length || (row.placements.some(p => p !== 'circle') && !row.tallImageId) || (row.placements.includes('circle') && !row.wideImageId)) fail('ADVERTISING_INCOMPLETE', '请填写标题并为所选位置上传对应比例图片')
}
export async function decodeAdvertisingImage(input: AdvertisingImageInput) {
  const encoded = input.base64
  if (encoded.length > 6990508) fail('ADVERTISING_IMAGE_INVALID', '图片不能超过5MB')
  if (!encoded.length || encoded.length % 4 !== 0) fail('ADVERTISING_IMAGE_INVALID', '图片编码不正确')
  const padding = encoded.endsWith('==') ? 2 : encoded.endsWith('=') ? 1 : 0
  // Scan once: repeated regex groups can overflow V8's stack for valid multi-MB uploads.
  for (let i = 0; i < encoded.length - padding; i++) {
    const c = encoded.charCodeAt(i)
    if (!((c >= 65 && c <= 90) || (c >= 97 && c <= 122) || (c >= 48 && c <= 57) || c === 43 || c === 47)) fail('ADVERTISING_IMAGE_INVALID', '图片编码不正确')
  }
  const bytes = Buffer.from(input.base64, 'base64')
  if (!bytes.length || bytes.length > 5 * 1024 * 1024) fail('ADVERTISING_IMAGE_INVALID', '图片不能超过5MB')
  try {
    const decoder = sharp(bytes, { failOn: 'warning', limitInputPixels: 8192 * 8192 })
    const meta = await decoder.metadata()
    if (!meta.width || !meta.height || (meta.pages ?? 1) !== 1 || !['png','jpeg'].includes(meta.format || '') || (input.mimeType === 'image/png') !== (meta.format === 'png')) fail('ADVERTISING_IMAGE_INVALID', '仅支持有效的静态PNG/JPG图片')
    // Normalize orientation and strip metadata before storing public images.
    const normalized = await decoder.rotate().toBuffer({ resolveWithObject: true })
    const { width, height } = normalized.info
    const ratio = input.purpose === 'wide' ? 3 : input.purpose === 'tall' ? 2 : null
    if (ratio && width !== height * ratio) fail('ADVERTISING_IMAGE_RATIO', `图片须裁剪为${ratio}:1比例`)
    if (normalized.data.length > 5 * 1024 * 1024) fail('ADVERTISING_IMAGE_INVALID', '处理后的图片不能超过5MB')
    return { bytes: normalized.data, width, height, extension: meta.format === 'png' ? 'png' : 'jpg' }
  } catch (e) {
    if (e && typeof e === 'object' && 'getStatus' in e) throw e
    fail('ADVERTISING_IMAGE_INVALID', '图片无法读取，请重新选择PNG/JPG图片')
  }
}
@Injectable()
export class AdvertisingService {
  constructor(private readonly database: FlowDatabase) {}
  private directory() { return resolve(process.env.LOCAL_ADVERTISING_DIRECTORY || '.local-uploads/advertising') }
  private async record(tx: AdminTransaction, actorId: string, targetId: string, action: string, before: unknown, after: unknown) {
    await tx.insert(audit).values({ id: randomUUID(), actorId, targetId, action, before, after })
  }
  private async image(tx: Db, id: string|null, purpose?: string) {
    if (!id) return null
    const [row] = await tx.select().from(images).where(eq(images.id, id)).limit(1)
    if (!row || (purpose && row.purpose !== purpose)) fail('ADVERTISING_IMAGE_INVALID', '图片不存在或裁剪比例不匹配')
    return row
  }
  private async source(tx: Db, id: string|null) {
    const row = await this.image(tx, id)
    return { id: row?.sourceImageId ?? null, url: sourceUrl(row?.sourceImageId ?? null) }
  }
  async uploadImage(tx: AdminTransaction, actorId: string, input: AdvertisingImageInput): Promise<AdvertisingImageDto> {
    if (input.sourceImageId) {
      if (!['wide','tall'].includes(input.purpose)) fail('ADVERTISING_IMAGE_INVALID', '仅裁剪图片可关联原图')
      await this.image(tx, input.sourceImageId, 'source')
    }
    const decoded = await decodeAdvertisingImage(input), id = randomUUID(), file = `${id}.${decoded.extension}`
    await mkdir(this.directory(), { recursive: true })
    await writeFile(resolve(this.directory(), file), decoded.bytes, { flag: 'wx' })
    await tx.insert(images).values({ id, file, uploadedBy: actorId, purpose: input.purpose, sourceImageId: input.sourceImageId ?? null, width: decoded.width, height: decoded.height })
    await this.record(tx, actorId, id, 'image_upload', null, { purpose: input.purpose, width: decoded.width, height: decoded.height })
    return { id, url: (input.purpose === 'source' ? sourceUrl(id) : imageUrl(id))!, width: decoded.width, height: decoded.height, purpose: input.purpose, sourceImageId: input.sourceImageId ?? null, sourceImageUrl: sourceUrl(input.sourceImageId ?? null) }
  }
  async readImage(id: string, tx: Db = this.database.db, includeSource = false) {
    const [row] = await tx.select().from(images).where(eq(images.id,id)).limit(1)
    if (!row || (!includeSource && row.purpose === 'source') || !/^[a-f0-9-]{36}\.(png|jpg)$/.test(row.file)) fail('NOT_FOUND', '图片不存在', 404)
    try { return { bytes: await readFile(resolve(this.directory(), row.file)), mimeType: row.file.endsWith('.png') ? 'image/png' : 'image/jpeg' } }
    catch { fail('NOT_FOUND', '图片不存在', 404) }
  }
  private async presentIntroduction(tx: Db, row: Introduction): Promise<AdvertisingIntroductionDto> {
    const source = await this.source(tx, row.coverImageId)
    return { ...row, coverImageUrl: imageUrl(row.coverImageId), coverSourceImageId: source.id, coverSourceImageUrl: source.url,
      blocks: row.blocks.map(b=>b.type === 'image' ? {...b,imageUrl:imageUrl(b.imageId!)!} : b), createdAt:row.createdAt.toISOString(),updatedAt:row.updatedAt.toISOString() }
  }
  private async presentAd(tx: Db, row: Ad): Promise<AdvertisingAdDto> {
    const wide = await this.source(tx,row.wideImageId), tall = await this.source(tx,row.tallImageId)
    return { ...row,wideImageUrl:imageUrl(row.wideImageId),tallImageUrl:imageUrl(row.tallImageId),wideSourceImageId:wide.id,wideSourceImageUrl:wide.url,tallSourceImageId:tall.id,tallSourceImageUrl:tall.url,createdAt:row.createdAt.toISOString(),updatedAt:row.updatedAt.toISOString() }
  }
  async introduction(tx: Db, id: string, publicOnly = false) {
    const [row] = await tx.select().from(introductions).where(and(eq(introductions.id,id),publicOnly ? eq(introductions.status,'published') : undefined)).limit(1)
    if (!row) fail('NOT_FOUND', '该介绍暂不可查看', 404)
    return this.presentIntroduction(tx,row)
  }
  async publicIntroduction(id: string) {
    const row = await this.introduction(this.database.db,id,true)
    const { name, companyName, contactName, phone, wechatId, summary, coverImageUrl } = row
    return { id, name, companyName, contactName, phone, wechatId, summary, coverImageUrl, blocks: row.blocks.map(b=>b.type==='image'?{type:b.type,imageUrl:b.imageUrl}:{type:b.type,text:b.text}) }
  }
  async listIntroductions(tx: Db, query: AdvertisingAdminQuery) {
    const condition = and(query.status === 'all' ? undefined : eq(introductions.status,query.status),query.q ? or(like(introductions.name,`%${query.q}%`),like(introductions.companyName,`%${query.q}%`)) : undefined)
    const [count] = await tx.select({ value: sql<number>`count(*)` }).from(introductions).where(condition)
    const rows = await tx.select().from(introductions).where(condition).orderBy(desc(introductions.createdAt),introductions.id).offset(query.offset).limit(query.limit)
    const total = Number(count.value)
    return {items:await Promise.all(rows.map(row=>this.presentIntroduction(tx,row))),total,hasMore:query.offset+rows.length<total}
  }
  private async validateIntroductionImages(tx: Db, value: AdvertisingIntroductionInput) {
    await this.image(tx,value.coverImageId,'tall')
    for (const block of value.blocks) if (block.type==='image') await this.image(tx,block.imageId!,'detail')
  }
  async saveIntroduction(tx: AdminTransaction, actorId: string, input: AdvertisingIntroductionInput, id?: string, version?: number) {
    const values=introductionValues(input)
    await this.validateIntroductionImages(tx,values)
    const [before]=id ? await tx.select().from(introductions).where(eq(introductions.id,id)).for('update') : []
    if (id && !before) fail('NOT_FOUND','介绍不存在',404)
    if (before) { checkVersion(before.version,version!); if(before.status==='published') requireIntroductionReady(values) }
    const target=id??randomUUID(),after={...values,version:(before?.version??0)+1,updatedAt:new Date()}
    if(before) await tx.update(introductions).set(after).where(eq(introductions.id,target))
    else await tx.insert(introductions).values({id:target,...after})
    await this.record(tx,actorId,target,before?'introduction_update':'introduction_create',before??null,after)
    return this.introduction(tx,target)
  }
  async introductionStatus(tx: AdminTransaction,actorId:string,id:string,input:AdvertisingStatusInput) {
    const [row]=await tx.select().from(introductions).where(eq(introductions.id,id)).for('update')
    if(!row) fail('NOT_FOUND','介绍不存在',404)
    checkVersion(row.version,input.version)
    if(input.status==='published'){requireIntroductionReady(row);await this.validateIntroductionImages(tx,row)}
    await tx.update(introductions).set({status:input.status,version:row.version+1,updatedAt:new Date()}).where(eq(introductions.id,id))
    await this.record(tx,actorId,id,'introduction_status',{status:row.status,version:row.version},{status:input.status,version:row.version+1})
    return this.introduction(tx,id)
  }
  async ad(tx:Db,id:string) {
    const [row]=await tx.select().from(ads).where(eq(ads.id,id)).limit(1)
    if(!row) fail('NOT_FOUND','广告不存在',404)
    return this.presentAd(tx,row)
  }
  private placementCondition(placement:string) { return sql`JSON_CONTAINS(${ads.placements}, ${JSON.stringify(placement)})` }
  async listAds(tx:Db,query:AdvertisingAdminQuery) {
    const condition=and(query.status==='all'?undefined:eq(ads.status,query.status),query.placement==='all'?undefined:this.placementCondition(query.placement),query.q?or(like(ads.title,`%${query.q}%`),like(introductions.companyName,`%${query.q}%`)):undefined)
    const [count]=await tx.select({value:sql<number>`count(*)`}).from(ads).innerJoin(introductions,eq(ads.introductionId,introductions.id)).where(condition)
    const rows=await tx.select({ad:ads}).from(ads).innerJoin(introductions,eq(ads.introductionId,introductions.id)).where(condition).orderBy(asc(ads.sortOrder),asc(ads.createdAt),ads.id).offset(query.offset).limit(query.limit)
    const total=Number(count.value)
    return {items:await Promise.all(rows.map(row=>this.presentAd(tx,row.ad))),total,hasMore:query.offset+rows.length<total}
  }
  async publicAds(query:AdvertisingPublicQuery) {
    const db=this.database.db,condition=and(eq(ads.status,'published'),eq(introductions.status,'published'),this.placementCondition(query.placement))
    const [count]=await db.select({value:sql<number>`count(*)`}).from(ads).innerJoin(introductions,eq(ads.introductionId,introductions.id)).where(condition)
    const rows=await db.select({id:ads.id,title:ads.title,introductionId:ads.introductionId,imageId:query.placement==='circle'?ads.wideImageId:ads.tallImageId}).from(ads).innerJoin(introductions,eq(ads.introductionId,introductions.id)).where(condition).orderBy(asc(ads.sortOrder),asc(ads.createdAt),ads.id).offset(query.offset).limit(query.limit)
    const total=Number(count.value)
    return {items:rows.map(({imageId,...row})=>({...row,imageUrl:imageUrl(imageId)!})),total,hasMore:query.offset+rows.length<total}
  }
  private async validateAd(tx:Db,value:AdvertisingAdInput,published:boolean) {
    await this.image(tx,value.wideImageId,'wide');await this.image(tx,value.tallImageId,'tall')
    const [intro]=await tx.select().from(introductions).where(eq(introductions.id,value.introductionId)).limit(1)
    if(!intro) fail('ADVERTISING_INVALID','请选择有效的介绍内容')
    if(published){requireAdReady(value);if(intro.status!=='published')fail('ADVERTISING_INCOMPLETE','请先上架关联介绍内容')}
  }
  async saveAd(tx:AdminTransaction,actorId:string,input:AdvertisingAdInput,id?:string,version?:number) {
    const [before]=id?await tx.select().from(ads).where(eq(ads.id,id)).for('update'):[]
    if(id&&!before)fail('NOT_FOUND','广告不存在',404)
    if(before)checkVersion(before.version,version!)
    await this.validateAd(tx,input,before?.status==='published')
    if(!input.title.trim())fail('ADVERTISING_INVALID','请填写广告标题')
    const {title,introductionId,placements,wideImageId,tallImageId,sortOrder}=input
    const target=id??randomUUID(),after={title:title.trim(),introductionId,placements,wideImageId,tallImageId,sortOrder,version:(before?.version??0)+1,updatedAt:new Date()}
    if(before)await tx.update(ads).set(after).where(eq(ads.id,target));else await tx.insert(ads).values({id:target,...after})
    await this.record(tx,actorId,target,before?'ad_update':'ad_create',before??null,after)
    return this.ad(tx,target)
  }
  async adStatus(tx:AdminTransaction,actorId:string,id:string,input:AdvertisingStatusInput) {
    const [row]=await tx.select().from(ads).where(eq(ads.id,id)).for('update')
    if(!row)fail('NOT_FOUND','广告不存在',404)
    checkVersion(row.version,input.version)
    if(input.status==='published')await this.validateAd(tx,row,true)
    await tx.update(ads).set({status:input.status,version:row.version+1,updatedAt:new Date()}).where(eq(ads.id,id))
    await this.record(tx,actorId,id,'ad_status',{status:row.status,version:row.version},{status:input.status,version:row.version+1})
    return this.ad(tx,id)
  }
  async background(tx:Db=this.database.db):Promise<AdvertisingBackgroundDto> {
    const [row]=await tx.select().from(backgrounds).where(eq(backgrounds.id,'mine')).limit(1),source=await this.source(tx,row?.imageId??null)
    return {imageId:row?.imageId??null,imageUrl:imageUrl(row?.imageId??null),version:row?.version??0,sourceImageId:source.id,sourceImageUrl:source.url}
  }
  async saveBackground(tx:AdminTransaction,actorId:string,input:AdvertisingBackgroundInput) {
    await this.image(tx,input.imageId,'wide')
    await tx.insert(backgrounds).values({id:'mine',imageId:null,version:0}).onDuplicateKeyUpdate({set:{id:'mine'}})
    const [row]=await tx.select().from(backgrounds).where(eq(backgrounds.id,'mine')).for('update')
    checkVersion(row.version,input.version)
    await tx.update(backgrounds).set({imageId:input.imageId,version:row.version+1,updatedAt:new Date()}).where(eq(backgrounds.id,'mine'))
    await this.record(tx,actorId,'mine','background',row,{imageId:input.imageId,version:row.version+1})
    return this.background(tx)
  }
}
