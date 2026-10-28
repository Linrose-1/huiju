import 'reflect-metadata'
import { ValidationPipe } from '@nestjs/common'
import { describe, expect, it, vi } from 'vitest'
import sharp from 'sharp'
import { randomBytes } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { getTableConfig } from 'drizzle-orm/mysql-core'
import * as advertisingSchema from '../src/database/schema/advertising.js'
import { AdvertisingAdInput, AdvertisingAdUpdateInput, AdvertisingImageInput, AdvertisingIntroductionInput, AdvertisingPublicQuery } from '../src/advertising/dto.js'
import { checkVersion, decodeAdvertisingImage, introductionValues, requireAdReady, requireIntroductionReady, AdvertisingService } from '../src/advertising/service.js'
import { AdminAdvertisingController } from '../src/advertising/controller.js'
import type { AdminService, AdminTransaction } from '../src/admin/service.js'
import type { FlowDatabase } from '../src/flow/common.js'
const pipe=new ValidationPipe({transform:true,whitelist:true,forbidNonWhitelisted:true})
const id='00000000-0000-4000-8000-000000000001'
const introduction={name:'项目',companyName:'公司',contactName:'联系人',phone:'',wechatId:'company_wechat',summary:'简介',coverImageId:id,blocks:[{type:'text' as const,text:'介绍'}]}
const ad={title:'广告',introductionId:id,placements:['activity' as const],wideImageId:null,tallImageId:id,sortOrder:10}
const validate=(metatype: new()=>object,value:unknown)=>pipe.transform(value,{type:'body',metatype})
const png=async(width:number,height:number)=>({base64:(await sharp({create:{width,height,channels:3,background:'#166443'}}).png().toBuffer()).toString('base64'),mimeType:'image/png' as const})
function fixture(rows:unknown[][]){
  const query:Record<string,unknown>={};for(const n of ['from','where','limit','for'])query[n]=()=>query
  query.then=(resolve:(x:unknown)=>unknown)=>Promise.resolve(rows.shift()??[]).then(resolve)
  const db={select:vi.fn(()=>query),update:vi.fn(),insert:vi.fn()}
  return {db,service:new AdvertisingService({db} as unknown as FlowDatabase)}
}
describe('advertising contracts and publication rules',()=>{
  it('accepts explicit placements, nullable draft images and a valid introduction',async()=>{
    expect(await validate(AdvertisingAdInput,ad)).toMatchObject(ad)
    expect(await validate(AdvertisingIntroductionInput,introduction)).toMatchObject(introduction)
  })
  it('rejects duplicates, unknown placement, forged field, invalid image ID and absent update version',async()=>{
    for(const value of [{...ad,placements:['activity','activity']},{...ad,placements:['mine']},{...ad,ownerId:id},{...ad,wideImageId:'../../secret'}])await expect(validate(AdvertisingAdInput,value)).rejects.toThrow()
    await expect(validate(AdvertisingAdUpdateInput,ad)).rejects.toThrow()
  })
  it('public paging has bounded page size and a required supported placement',async()=>{
    expect(await pipe.transform({placement:'circle',offset:'20',limit:'20'},{type:'query',metatype:AdvertisingPublicQuery})).toMatchObject({placement:'circle',offset:20,limit:20})
    await expect(validate(AdvertisingPublicQuery,{placement:'mine'})).rejects.toThrow()
    await expect(validate(AdvertisingPublicQuery,{placement:'circle',limit:101})).rejects.toThrow()
  })
  it('draft accepts incomplete contact while publishing requires contact and content',()=>{
    expect(introductionValues({...introduction,phone:'',wechatId:'',companyName:''}).companyName).toBe('')
    expect(()=>requireIntroductionReady({...introduction,phone:'',wechatId:''})).toThrow()
    expect(()=>requireIntroductionReady({...introduction,blocks:[]})).toThrow()
    expect(()=>requireIntroductionReady(introduction)).not.toThrow()
  })
  it('requires appropriate assets for every chosen placement',()=>{
    expect(()=>requireAdReady(ad)).not.toThrow()
    expect(()=>requireAdReady({...ad,placements:['activity','circle']})).toThrow()
    expect(()=>requireAdReady({...ad,tallImageId:null})).toThrow()
    expect(()=>requireAdReady({...ad,placements:['circle'],wideImageId:id,tallImageId:null})).not.toThrow()
    expect(()=>requireAdReady({...ad,placements:['assistant'],wideImageId:id,tallImageId:null})).toThrow()
    expect(()=>requireAdReady({...ad,placements:['assistant']})).not.toThrow()
  })
  it('rejects ambiguous blocks, blank text and invalid telephone without treating text as HTML',()=>{
    expect(()=>introductionValues({...introduction,blocks:[{type:'text',text:'正文',imageId:id}]})).toThrow()
    expect(()=>introductionValues({...introduction,blocks:[{type:'text',text:'  '}]})).toThrow()
    expect(()=>introductionValues({...introduction,phone:'javascript:alert(1)'})).toThrow()
    expect(introductionValues({...introduction,blocks:[{type:'text',text:'<b>原样文本</b>'}]}).blocks[0]).toEqual({type:'text',text:'<b>原样文本</b>'})
  })
  it('rejects stale version before performing a database write',async()=>{
    expect(()=>checkVersion(2,1)).toThrow()
    const {service,db}=fixture([[{...ad,id,version:2,status:'draft'}]])
    await expect(service.saveAd(db as unknown as AdminTransaction,id,ad,id,1)).rejects.toThrow()
    expect(db.update).not.toHaveBeenCalled();expect(db.insert).not.toHaveBeenCalled()
  })
  it('admin writes delegate authenticated CSRF transaction, reads do not request write mode',async()=>{
    const withSession=vi.fn(async(_ctx,callback,options)=>({options,callback:typeof callback}))
    const controller=new AdminAdvertisingController({} as AdvertisingService,{withSession} as unknown as AdminService)
    const request={headers:{cookie:'local',origin:'http://localhost','x-csrf-token':'csrf'}}
    await controller.createAd(ad,request)
    expect(withSession.mock.calls[0][0]).toEqual({cookie:'local',origin:'http://localhost',csrfToken:'csrf'})
    expect(withSession.mock.calls[0][2]).toEqual({write:true})
  })
  it('public introduction excludes versions and source metadata',async()=>{
    const {service}=fixture([])
    vi.spyOn(service,'introduction').mockResolvedValue({...introduction,id,version:8,status:'published',coverImageUrl:'/cover',coverSourceImageId:'private',coverSourceImageUrl:'/admin/private',blocks:[{type:'image',imageId:'internal',imageUrl:'/detail'},{type:'text',text:'正文'}],createdAt:'now',updatedAt:'now'})
    const result=await service.publicIntroduction(id)
    expect(result).not.toHaveProperty('version');expect(result).not.toHaveProperty('coverSourceImageUrl')
    expect(result.blocks).toEqual([{type:'image',imageUrl:'/detail'},{type:'text',text:'正文'}])
  })
  it('source files cannot be read from the unauthenticated media method',async()=>{
    const {service}=fixture([[{id,file:`${id}.png`,purpose:'source'}]])
    await expect(service.readImage(id)).rejects.toThrow('图片不存在')
  })
})
describe('advertising image decoding',()=>{
  it('enforces actual wide and tall ratios, not metadata supplied by client',async()=>{
    expect(await decodeAdvertisingImage({...await png(30,10),purpose:'wide'})).toMatchObject({width:30,height:10,extension:'png'})
    expect(await decodeAdvertisingImage({...await png(20,10),purpose:'tall'})).toMatchObject({width:20,height:10})
    await expect(decodeAdvertisingImage({...await png(20,10),purpose:'wide'})).rejects.toThrow('3:1')
  })
  it('accepts original/detail arbitrary proportions but rejects mismatched MIME',async()=>{
    const image=await png(13,11)
    expect(await decodeAdvertisingImage({...image,purpose:'detail'})).toMatchObject({width:13,height:11})
    await expect(decodeAdvertisingImage({...image,mimeType:'image/jpeg',purpose:'source'})).rejects.toThrow()
  })
  it('decodes a real PNG larger than 4MB without a regex stack overflow',async()=>{
    const bytes=await sharp(randomBytes(1200*1200*3),{raw:{width:1200,height:1200,channels:3}}).png({compressionLevel:0}).toBuffer()
    expect(bytes.length).toBeGreaterThan(4*1024*1024)
    expect(bytes.length).toBeLessThan(5*1024*1024)
    expect(await decodeAdvertisingImage({base64:bytes.toString('base64'),mimeType:'image/png',purpose:'detail'})).toMatchObject({width:1200,height:1200,extension:'png'})
  })
  it('returns a stable business error for malformed padding, corrupt and oversized input',async()=>{
    for(const base64 of ['','no binary!','YWJj','a===','=AAA','AA=A','AAA','AAAA====',Buffer.alloc(5*1024*1024+1).toString('base64'),Buffer.alloc(5*1024*1024+10).toString('base64')]) {
      const error=await decodeAdvertisingImage({base64,mimeType:'image/png',purpose:'detail'}).catch(error=>error)
      expect(error.getStatus()).toBe(400)
      expect(error.getResponse()).toMatchObject({code:'ADVERTISING_IMAGE_INVALID'})
    }
  })
  it('does not allow a client to submit filename or purpose outside the contract',async()=>{
    await expect(validate(AdvertisingImageInput,{...await png(3,1),purpose:'avatar'})).rejects.toThrow()
    await expect(validate(AdvertisingImageInput,{...await png(3,1),purpose:'wide',file:'../../private'})).rejects.toThrow()
  })
})


describe('advertising migration identifiers',()=>{
  const tables=Object.values(advertisingSchema).map(getTableConfig)
  it('keeps every table, index and foreign key within MySQL identifier limits',()=>{
    const names=tables.flatMap(t=>[t.name,...t.indexes.map(i=>i.config.name),...t.foreignKeys.map(f=>f.getName())])
    expect(tables.length).toBeGreaterThan(0)
    for(const name of names) {
      expect(name, `empty MySQL identifier`).not.toBe('')
      expect([...name].length, `MySQL identifier exceeds 64 characters: ${name}`).toBeLessThanOrEqual(64)
    }
    const foreignKeyNames=tables.flatMap(t=>t.foreignKeys.map(f=>f.getName()))
    expect(new Set(foreignKeyNames).size).toBe(foreignKeyNames.length)
  })
  it('matches generated snapshot and SQL names to schema foreign key relationships',()=>{
    const snapshot=JSON.parse(readFileSync(new URL('../drizzle/meta/0014_snapshot.json',import.meta.url),'utf8'))
    const migration=readFileSync(new URL('../drizzle/0014_advertising.sql',import.meta.url),'utf8')
    for(const table of tables) {
      const saved=snapshot.tables[table.name]
      expect(saved.name).toBe(table.name)
      expect(migration).toContain('CREATE TABLE `'+table.name+'`')
      expect(Object.keys(saved.indexes).sort()).toEqual(table.indexes.map(i=>i.config.name).sort())
      expect(Object.keys(saved.foreignKeys).sort()).toEqual(table.foreignKeys.map(f=>f.getName()).sort())
      for(const index of table.indexes) expect(migration).toContain('INDEX `'+index.config.name+'`')
      for(const foreignKey of table.foreignKeys) {
        const reference=foreignKey.reference()
        expect(saved.foreignKeys[foreignKey.getName()]).toMatchObject({
          name:foreignKey.getName(),tableFrom:table.name,tableTo:getTableConfig(reference.foreignTable).name,
          columnsFrom:reference.columns.map(c=>c.name),columnsTo:reference.foreignColumns.map(c=>c.name),
          onDelete:foreignKey.onDelete??'no action',onUpdate:foreignKey.onUpdate??'no action',
        })
        expect(migration).toContain('ADD CONSTRAINT `'+foreignKey.getName()+'`')
      }
    }
  })
})
