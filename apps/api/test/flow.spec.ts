import 'reflect-metadata'
import type { AddressInfo } from 'node:net'
import type { INestApplication } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { AppModule } from '../src/app.module.js'
import { ActivityService, registrationState, validateAnswers } from '../src/flow/activity.js'
import { FlowDatabase } from '../src/flow/common.js'
import { complete, tokenHash, validAvatar } from '../src/flow/identity.js'
import { WechatAdapter } from '../src/flow/wechat.js'
import type { activities, registrationQuestions } from '../src/database/schema/activities.js'
import type { members } from '../src/database/schema/members.js'

type Activity = typeof activities.$inferSelect
type Question = typeof registrationQuestions.$inferSelect
const base = {lifecycle:'published',moderation:'normal',startsAt:new Date('2030-01-02'),registrationDeadline:new Date('2030-01-01'),capacity:1,activeRegistrationCount:0} as Activity
const now = new Date('2029-12-31')
describe('registration eligibility and answers', () => {
  it('prioritizes removal and cancellation and applies exact deadline/capacity', () => {
    expect(registrationState(base,now)).toBe('open')
    expect(registrationState({...base,activeRegistrationCount:1},now)).toBe('full')
    expect(registrationState(base,new Date('2030-01-01'))).toBe('closed')
    expect(registrationState({...base,registrationDeadline:null},new Date('2030-01-02'))).toBe('closed')
    expect(registrationState({...base,lifecycle:'cancelled'},now)).toBe('cancelled')
    expect(registrationState({...base,lifecycle:'cancelled',moderation:'removed'},now)).toBe('removed')
  })
  it('rejects foreign/duplicate questions and missing required or invalid option answers', () => {
    const questions = [{id:'a',type:'multiple',required:true,options:['甲','乙']},{id:'b',type:'short_text',required:false,options:null}] as Question[]
    expect(() => validateAnswers(questions,[{questionId:'a',value:['甲']}])).not.toThrow()
    for (const answers of [[],[{questionId:'a',value:[]}],[{questionId:'a',value:['丙']}],[{questionId:'a',value:['甲','甲']}],[{questionId:'a',value:'甲'}],[{questionId:'a',value:['甲']},{questionId:'x',value:'x'}],[{questionId:'a',value:['甲']},{questionId:'a',value:['乙']}],[{questionId:'a',value:['甲']},{questionId:'b',value:[]}]] ) {
      expect(() => validateAnswers(questions,answers)).toThrow()
    }
  })
  it('requires active user choices for avatar and name and a verified bound phone', () => {
    const member = {boundPhone:'13800000000',avatarUrl:'/a.png',displayName:'甲',avatarSetByUser:true,nameSetByUser:true} as typeof members.$inferSelect
    expect(complete(member)).toBe(true)
    expect(complete({...member,nameSetByUser:false})).toBe(false)
    expect(complete({...member,boundPhone:null})).toBe(false)
    expect(complete({...member,avatarSetByUser:false})).toBe(false)
    expect(tokenHash('secret')).toHaveLength(64)
    expect(tokenHash('secret')).not.toContain('secret')
  })
  it('rejects malformed image data including a truncated PNG without parser errors', () => {
    expect(() => validAvatar({mimeType:'image/png',base64:Buffer.from([137,80,78,71,13,10,26,10]).toString('base64')})).toThrow('请选择')
    expect(() => validAvatar({mimeType:'image/jpeg',base64:Buffer.from('<svg/>').toString('base64')})).toThrow('请选择')
  })
})
describe('real HTTP validation without database or WeChat calls', () => {
  let app: INestApplication
  let url: string
  const list = vi.fn().mockResolvedValue({items:[]})
  const write = vi.fn().mockResolvedValue({status:'active'})
  beforeAll(async () => {
    const module = await Test.createTestingModule({imports:[AppModule]}).overrideProvider(FlowDatabase).useValue({get db(){throw new Error('Database access forbidden in isolated test')}}).overrideProvider(ActivityService).useValue({list,write}).compile()
    app = module.createNestApplication({logger:false})
    app.setGlobalPrefix('api/v1')
    await app.listen(0,'127.0.0.1')
    url = `http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}/api/v1`
  })
  afterAll(async () => { await app?.close() })
  it('public browsing remains available without a session', async () => {
    const response = await fetch(`${url}/activities`)
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({items:[]})
  })
  it('rejects absent/forged auth before any database access', async () => {
    const response = await fetch(`${url}/auth/session`,{headers:{authorization:'Bearer fake'}})
    expect(response.status).toBe(401)
    expect(await response.json()).toMatchObject({code:'SESSION_REQUIRED'})
  })
  it('rejects manual phone binding and invite mutation fields rather than stripping them', async () => {
    const response = await fetch(`${url}/members/me/phone`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({phone:'13800000000',inviteCode:'x'})})
    expect(response.status).toBe(400)
    expect(await response.json()).toMatchObject({code:'INVALID_INPUT'})
  })
  it('does not expose database error details', async () => {
    const response = await fetch(`${url}/auth/session`,{headers:{authorization:`Bearer ${'a'.repeat(43)}`}})
    expect(response.status).toBe(500)
    expect(JSON.stringify(await response.json())).not.toContain('Database access')
  })
  it('supports the WeChat POST profile alias with the same required authentication', async () => {
    for (const method of ['POST','PATCH']) {
      const response = await fetch(`${url}/members/me/profile`,{method,headers:{'Content-Type':'application/json'},body:JSON.stringify({displayName:'会员'})})
      expect(response.status).toBe(401)
      expect(await response.json()).toMatchObject({code:'SESSION_REQUIRED'})
    }
  })
  it('routes the WeChat POST answer alias through the same edit action and DTO', async () => {
    const id = '4b5809df-6fef-42b9-800f-c4d5c4383cfe'
    const questionId = '4b5809df-6fef-42b9-800f-c4d5c4383cff'
    for (const [method,path] of [['POST','/answers'],['PATCH','']]) {
      const response = await fetch(`${url}/activities/${id}/registrations/me${path}`,{method,headers:{'Content-Type':'application/json',authorization:'Bearer test'},body:JSON.stringify({answers:[{questionId,value:'回答'}]})})
      expect(response.status).toBe(200)
      expect(write).toHaveBeenLastCalledWith(id,'Bearer test','edit',{answers:[{questionId,value:'回答'}]})
    }
    const invalid = await fetch(`${url}/activities/${id}/registrations/me/answers`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({answers:[],contactPhone:'13800000000'})})
    expect(invalid.status).toBe(400)
  })
})
describe('WeChat adapter', () => {
  afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals() })
  it('fails explicitly with missing config and performs no external request', async () => {
    vi.stubEnv('WECHAT_MINIAPP_APP_ID','')
    vi.stubEnv('WECHAT_MINIAPP_SECRET','')
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch',fetchMock)
    await expect(new WechatAdapter().exchange('code')).rejects.toThrow('微信登录尚未配置')
    expect(fetchMock).not.toHaveBeenCalled()
  })
  it('does not return session keys and checks phone watermark', async () => {
    vi.stubEnv('WECHAT_MINIAPP_APP_ID','app')
    vi.stubEnv('WECHAT_MINIAPP_SECRET','private')
    vi.stubGlobal('fetch',vi.fn().mockResolvedValueOnce(Response.json({openid:'openid',session_key:'sensitive'})).mockResolvedValueOnce(Response.json({access_token:'private-token',expires_in:7200})).mockResolvedValueOnce(Response.json({phone_info:{phoneNumber:'13800000000',watermark:{appid:'other'}}})))
    const adapter = new WechatAdapter()
    expect(await adapter.exchange('code')).toEqual({appId:'app',openId:'openid',unionId:null})
    await expect(adapter.phone('phone-code')).rejects.toThrow('手机号授权无效')
  })
})
