import 'reflect-metadata'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Logger } from '@nestjs/common'
import { WechatAdapter } from '../src/flow/wechat.js'

const scene = 'p1234567890abcdef12345678'
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aXZkAAAAASUVORK5CYII=', 'base64')
const jpeg = Buffer.from([255, 216, 255, 224, 0, 16, 255, 217])
const token = () => Response.json({ access_token: 'test-token', expires_in: 7200 })
const picture = (body = png, type = 'image/png') => new Response(body, { headers: { 'content-type': type } })

describe('activity mini-program code adapter', () => {
  beforeEach(() => {
    vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined)
    vi.stubEnv('WECHAT_MINIAPP_APP_ID', 'test-app')
    vi.stubEnv('WECHAT_MINIAPP_SECRET', 'test-secret')
    vi.stubEnv('WECHAT_CODE_ENV_VERSION', '')
  })
  afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.useRealTimers(); vi.restoreAllMocks() })

  it('requests the fixed public detail destination, release path check and validated PNG', async () => {
    const network = vi.fn().mockResolvedValueOnce(token()).mockResolvedValueOnce(picture())
    vi.stubGlobal('fetch', network)
    expect(await new WechatAdapter().activityCode(scene)).toEqual({ base64: png.toString('base64'), mimeType: 'image/png' })
    expect(network.mock.calls[0]![0]).toBe('https://api.weixin.qq.com/cgi-bin/stable_token')
    const [url, options] = network.mock.calls[1]!
    expect(url).toBe('https://api.weixin.qq.com/wxa/getwxacodeunlimit?access_token=test-token')
    expect(JSON.parse(options.body)).toEqual({ scene, page: 'pages/activity/detail', env_version: 'release', check_path: true, width: 430, is_hyaline: false })
    expect(options.signal).toBeInstanceOf(AbortSignal)
  })

  it.each(['trial', 'develop'])('uses explicitly configured %s and permits the not-yet-released page', async environment => {
    vi.stubEnv('WECHAT_CODE_ENV_VERSION', environment)
    const network = vi.fn().mockResolvedValueOnce(token()).mockResolvedValueOnce(picture(jpeg, 'image/jpeg; charset=binary'))
    vi.stubGlobal('fetch', network)
    expect((await new WechatAdapter().activityCode(scene)).mimeType).toBe('image/jpeg')
    expect(JSON.parse(network.mock.calls[1]![1].body)).toMatchObject({ env_version: environment, check_path: false })
  })

  it('rejects invalid scenes and configuration before any external request', async () => {
    const network = vi.fn(); vi.stubGlobal('fetch', network)
    const adapter = new WechatAdapter()
    for (const value of ['', 'pages/admin?id=1', 'p' + 'a'.repeat(25), 'p' + 'A'.repeat(24), scene + '&inviteCode=x']) {
      await expect(adapter.activityCode(value)).rejects.toThrow('活动分享码无效')
    }
    vi.stubEnv('WECHAT_CODE_ENV_VERSION', 'production')
    await expect(adapter.activityCode(scene)).rejects.toThrow('活动小程序码暂不可用')
    expect(network).not.toHaveBeenCalled()
  })

  it('shares one in-flight token request with simultaneous phone and code calls', async () => {
    let release!: (value: Response) => void
    const tokenWait = new Promise<Response>(resolve => { release = resolve })
    const network = vi.fn(async (url: string) => {
      if (url.includes('stable_token')) return tokenWait
      if (url.includes('getuserphonenumber')) return Response.json({ phone_info: { phoneNumber: '13800000000', watermark: { appid: 'test-app' } } })
      return picture()
    })
    vi.stubGlobal('fetch', network)
    const adapter = new WechatAdapter(), first = adapter.activityCode(scene), second = adapter.phone('test-code')
    expect(network).toHaveBeenCalledTimes(1)
    release(token())
    expect(await second).toBe('13800000000')
    await first
    await adapter.activityCode(scene)
    expect(network.mock.calls.filter(([url]) => url.includes('stable_token'))).toHaveLength(1)
  })

  it('refreshes the token before expiry and does not cache invalid expiry metadata', async () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date('2026-11-05T00:00:00Z'))
    const network = vi.fn().mockResolvedValueOnce(token()).mockResolvedValueOnce(picture())
      .mockResolvedValueOnce(token()).mockResolvedValueOnce(picture())
      .mockResolvedValueOnce(Response.json({ access_token: 'bad', expires_in: 'invalid' }))
    vi.stubGlobal('fetch', network)
    const adapter = new WechatAdapter()
    await adapter.activityCode(scene)
    vi.setSystemTime(new Date('2026-11-05T01:58:01Z'))
    await adapter.activityCode(scene)
    expect(network).toHaveBeenCalledTimes(4)
    vi.setSystemTime(new Date('2026-11-05T03:58:01Z'))
    await expect(adapter.activityCode(scene)).rejects.toThrow('活动小程序码暂不可用')
    expect(network).toHaveBeenCalledTimes(5)
  })

  it.each([
    ['JSON upstream error', () => Response.json({ errcode: 40001, errmsg: 'secret upstream test-token' })],
    ['HTTP error', () => new Response('private upstream details', { status: 502 })],
    ['signature mismatch', () => picture(Buffer.from('not an image'), 'image/png')],
    ['PNG in JPEG envelope', () => picture(png, 'image/jpeg')],
    ['truncated JPEG', () => picture(jpeg.subarray(0, 6), 'image/jpeg')],
    ['declared oversized', () => new Response(png, { headers: { 'content-type': 'image/png', 'content-length': '1048577' } })],
    ['streamed oversized', () => picture(Buffer.alloc(1048577), 'image/png')],
    ['missing body', () => new Response(null, { headers: { 'content-type': 'image/png' } })]
  ])('rejects %s safely without retrying', async (_, createResponse) => {
    const network = vi.fn().mockResolvedValueOnce(token()).mockResolvedValueOnce(createResponse())
    vi.stubGlobal('fetch', network)
    const error = await new WechatAdapter().activityCode(scene).catch(value => value)
    expect(error.getStatus()).toBe(503)
    expect(error.getResponse()).toMatchObject({ code: 'WECHAT_CODE_UNAVAILABLE' })
    expect(JSON.stringify(error.getResponse())).not.toMatch(/secret|test-token|upstream/)
    expect(network).toHaveBeenCalledTimes(2)
  })

  it('masks timeout errors, releases failed token fetch and permits explicit retry', async () => {
    const network = vi.fn().mockRejectedValueOnce(new Error('timeout: test-secret'))
      .mockResolvedValueOnce(token()).mockResolvedValueOnce(picture())
    vi.stubGlobal('fetch', network)
    const adapter = new WechatAdapter()
    await expect(adapter.activityCode(scene)).rejects.toThrow('活动小程序码暂不可用')
    expect(network).toHaveBeenCalledTimes(1)
    expect(await adapter.activityCode(scene)).toMatchObject({ mimeType: 'image/png' })
  })

  it('keeps the phone watermark protection when reusing a cached code token', async () => {
    const network = vi.fn().mockResolvedValueOnce(token()).mockResolvedValueOnce(picture())
      .mockResolvedValueOnce(Response.json({ phone_info: { phoneNumber: '13800000000', watermark: { appid: 'other-app' } } }))
    vi.stubGlobal('fetch', network)
    const adapter = new WechatAdapter()
    await adapter.activityCode(scene)
    await expect(adapter.phone('test-code')).rejects.toThrow('手机号授权无效')
    expect(network).toHaveBeenCalledTimes(3)
  })

  it.each([
    ['token', () => Response.json({ errcode: 40164, errmsg: 'secret test-token private address' }), { reason: 'upstream_error', httpStatus: 200, upstreamCode: 40164 }],
    ['code', () => Response.json({ errcode: 41030, errmsg: `secret test-token ${scene}` }), { reason: 'upstream_error', httpStatus: 200, upstreamCode: 41030 }],
    ['token', () => new Response('secret', { status: 502 }), { reason: 'http', httpStatus: 502 }],
    ['code', () => new Response('secret', { status: 503 }), { reason: 'http', httpStatus: 503 }],
    ['token', () => Response.json({ access_token: 'secret', expires_in: 'invalid' }), { reason: 'invalid_response', httpStatus: 200 }],
    ['code', () => Response.json({ errcode: 'secret', errmsg: 'private' }), { reason: 'invalid_response', httpStatus: 200 }],
    ['token', () => new Response('secret malformed JSON'), { reason: 'invalid_json', httpStatus: 200 }],
    ['code', () => new Response('secret malformed JSON'), { reason: 'invalid_json', httpStatus: 200 }],
    ['code', () => picture(Buffer.from('secret'), 'image/png'), { reason: 'invalid_image', httpStatus: 200 }],
    ['code', () => new Response(null, { headers: { 'content-type': 'image/png' } }), { reason: 'empty_response', httpStatus: 200 }],
    ['code', () => picture(Buffer.alloc(1048577)), { reason: 'oversized', httpStatus: 200 }],
  ])('logs only safe diagnostic fields for %s response failures', async (stage, response, details) => {
    const network = vi.fn()
    if (stage === 'code') network.mockResolvedValueOnce(token())
    network.mockResolvedValueOnce(response())
    vi.stubGlobal('fetch', network)
    const error = await new WechatAdapter().activityCode(scene).catch(value => value)
    expect(error.getResponse()).toEqual({ code: 'WECHAT_CODE_UNAVAILABLE', message: '活动小程序码暂不可用，请稍后重试' })
    expect(Logger.prototype.warn).toHaveBeenCalledExactlyOnceWith({ stage, ...details, env_version: 'release' })
    expect(JSON.stringify(vi.mocked(Logger.prototype.warn).mock.calls)).not.toMatch(/secret|test-token|private|https|p1234567890/)
    expect(network).toHaveBeenCalledTimes(stage === 'token' ? 1 : 2)
  })

  it.each(['token', 'code'])('bounds and cancels oversized JSON in the %s stage', async stage => {
    const cancelled = vi.fn()
    const body = new ReadableStream<Uint8Array>({
      start(controller) { controller.enqueue(new TextEncoder().encode('x'.repeat(16385))) },
      cancel: cancelled
    })
    const network = vi.fn()
    if (stage === 'code') network.mockResolvedValueOnce(token())
    network.mockResolvedValueOnce(new Response(body, { headers: { 'content-type': 'application/json' } }))
    vi.stubGlobal('fetch', network)
    await expect(new WechatAdapter().activityCode(scene)).rejects.toThrow('活动小程序码暂不可用')
    expect(cancelled).toHaveBeenCalledTimes(1)
    expect(Logger.prototype.warn).toHaveBeenCalledExactlyOnceWith({ stage, reason: 'oversized', httpStatus: 200, env_version: 'release' })
    expect(network).toHaveBeenCalledTimes(stage === 'token' ? 1 : 2)
  })

  it.each([
    ['token', 'TimeoutError', 'timeout'], ['code', 'AbortError', 'timeout'],
    ['token', 'TypeError', 'network'], ['code', 'TypeError', 'network']
  ])('classifies %s %s without logging exception contents or retrying', async (stage, name, reason) => {
    const network = vi.fn()
    if (stage === 'code') network.mockResolvedValueOnce(token())
    network.mockRejectedValueOnce(Object.assign(new Error('secret URL https://private.test?access_token=test-token'), { name }))
    vi.stubGlobal('fetch', network)
    await expect(new WechatAdapter().activityCode(scene)).rejects.toThrow('活动小程序码暂不可用')
    expect(Logger.prototype.warn).toHaveBeenCalledExactlyOnceWith({ stage, reason, env_version: 'release' })
    expect(network).toHaveBeenCalledTimes(stage === 'token' ? 1 : 2)
  })

  it('logs invalid configuration without disclosing environment contents or making requests', async () => {
    const network = vi.fn(); vi.stubGlobal('fetch', network)
    vi.stubEnv('WECHAT_CODE_ENV_VERSION', 'private-secret-value')
    await expect(new WechatAdapter().activityCode(scene)).rejects.toThrow('活动小程序码暂不可用')
    expect(Logger.prototype.warn).toHaveBeenLastCalledWith({ stage: 'config', reason: 'invalid_environment', env_version: 'invalid' })
    vi.stubEnv('WECHAT_CODE_ENV_VERSION', 'trial'); vi.stubEnv('WECHAT_MINIAPP_SECRET', '')
    await expect(new WechatAdapter().activityCode(scene)).rejects.toThrow('活动小程序码暂不可用')
    expect(Logger.prototype.warn).toHaveBeenLastCalledWith({ stage: 'config', reason: 'missing_config', env_version: 'trial' })
    expect(network).not.toHaveBeenCalled()
  })

  it('retains token diagnostics when a phone call started the shared request', async () => {
    let finish!: (response: Response) => void
    const network = vi.fn(() => new Promise<Response>(resolve => { finish = resolve }))
    vi.stubGlobal('fetch', network)
    const adapter = new WechatAdapter()
    const phone = adapter.phone('test-code').catch(error => error)
    const code = adapter.activityCode(scene).catch(error => error)
    finish(Response.json({ errcode: 40013, errmsg: 'secret upstream' }))
    expect((await phone).getResponse()).toEqual({ code: 'WECHAT_AUTH_FAILED', message: '微信授权已失效，请重新授权' })
    expect((await code).getResponse()).toMatchObject({ code: 'WECHAT_CODE_UNAVAILABLE' })
    expect(Logger.prototype.warn).toHaveBeenCalledExactlyOnceWith({ stage: 'token', reason: 'upstream_error', httpStatus: 200, upstreamCode: 40013, env_version: 'release' })
    expect(network).toHaveBeenCalledTimes(1)
  })
})
