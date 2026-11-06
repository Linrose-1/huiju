import { HttpException, Injectable, Logger } from '@nestjs/common'
import { fail } from './common.js'

type WechatDiagnostic = {
  stage: 'config' | 'token' | 'code'
  reason: 'missing_config' | 'invalid_environment' | 'network' | 'timeout' | 'http' | 'upstream_error' | 'invalid_json' | 'invalid_response' | 'oversized' | 'empty_response' | 'invalid_image'
  httpStatus?: number
  upstreamCode?: number
}
const logger = new Logger('WechatAdapter')
const timeoutError = (error: unknown) => error instanceof Error && ['AbortError', 'TimeoutError'].includes(error.name)

async function readResponse(response: Response, maximumBytes: number, diagnostic: WechatDiagnostic): Promise<Buffer> {
  if (Number(response.headers.get('content-length') || 0) > maximumBytes) {
    diagnostic.reason = 'oversized'; await response.body?.cancel(); throw new Error('wechat_response_rejected')
  }
  if (!response.body) { diagnostic.reason = 'empty_response'; throw new Error('wechat_response_rejected') }
  const reader = response.body.getReader(), chunks: Uint8Array[] = []
  let size = 0
  try {
    while (true) {
      const chunk = await reader.read()
      if (chunk.done) break
      size += chunk.value.byteLength
      if (size > maximumBytes) { diagnostic.reason = 'oversized'; await reader.cancel(); throw new Error('wechat_response_rejected') }
      chunks.push(chunk.value)
    }
  } finally { reader.releaseLock() }
  return Buffer.concat(chunks, size)
}

@Injectable()
export class WechatAdapter {
  private token?: {
    value: string
    until: number
  }
  private tokenRequest?: Promise<string>
  private readonly diagnostics = new WeakMap<object, WechatDiagnostic>()

  private config() {
    const appId = process.env.WECHAT_MINIAPP_APP_ID
    const secret = process.env.WECHAT_MINIAPP_SECRET
    if (!appId || !secret) {
      fail('WECHAT_UNAVAILABLE', '微信登录尚未配置，请稍后再试', 503)
    }
    return {
      appId,
      secret
    }
  }

  private async request(url: string, body?: object, diagnostic?: WechatDiagnostic): Promise<Record<string, unknown>> {
    try {
      const response = await fetch(url, {
        signal: AbortSignal.timeout(10000),
        ...(body ? {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body)
        } : {})
      })
      if (diagnostic) diagnostic.httpStatus = response.status
      if (!response.ok) {
        if (diagnostic) { diagnostic.reason = 'http'; await response.body?.cancel() }
        fail('WECHAT_UNAVAILABLE', '微信服务暂不可用', 503)
      }
      let data: Record<string, unknown>
      if (diagnostic) {
        const buffer = await readResponse(response, 16 * 1024, diagnostic)
        diagnostic.reason = 'invalid_json'
        data = JSON.parse(buffer.toString('utf8')) as Record<string, unknown>
        diagnostic.reason = 'invalid_response'
        if (!data || typeof data !== 'object' || Array.isArray(data)) fail('WECHAT_UNAVAILABLE', '微信服务暂不可用', 503)
      } else data = await response.json() as Record<string, unknown>
      if (data.errcode) {
        if (diagnostic) {
          diagnostic.reason = 'upstream_error'
          if (typeof data.errcode === 'number' && Number.isSafeInteger(data.errcode)) diagnostic.upstreamCode = data.errcode
        }
        fail('WECHAT_AUTH_FAILED', '微信授权已失效，请重新授权', 400)
      }
      return data
    }
    catch (error) {
      const safeError = error && typeof error === 'object' && 'getStatus' in error ? error
        : new HttpException({ code: 'WECHAT_UNAVAILABLE', message: '微信服务暂不可用，请重试' }, 503)
      if (diagnostic) {
        if (timeoutError(error)) diagnostic.reason = 'timeout'
        this.diagnostics.set(safeError, diagnostic)
      }
      throw safeError
    }
  }

  async exchange(code: string) {
    const { appId, secret } = this.config()
    const query = new URLSearchParams({
      appid: appId,
      secret,
      js_code: code,
      grant_type: 'authorization_code'
    })
    const data = await this.request(`https://api.weixin.qq.com/sns/jscode2session?${query}`)
    if (typeof data.openid !== 'string' || !data.openid) {
      fail('WECHAT_AUTH_FAILED', '微信身份识别失败', 400)
    }
    return {
      appId,
      openId: data.openid,
      unionId: typeof data.unionid === 'string' ? data.unionid : null
    }
  }

  private async accessToken(): Promise<string> {
    if (this.token && this.token.until > Date.now()) return this.token.value
    if (this.tokenRequest) return this.tokenRequest
    const { appId, secret } = this.config()
    const diagnostic: WechatDiagnostic = { stage: 'token', reason: 'network' }
    const request = this.request('https://api.weixin.qq.com/cgi-bin/stable_token', {
      grant_type: 'client_credential', appid: appId, secret
    }, diagnostic).then(data => {
      const expiresIn = Number(data.expires_in)
      if (typeof data.access_token !== 'string' || !data.access_token || !Number.isFinite(expiresIn) || expiresIn <= 0) {
        fail('WECHAT_UNAVAILABLE', '微信服务暂不可用', 503)
      }
      this.token = { value: data.access_token, until: Date.now() + Math.max(0, expiresIn - 120) * 1000 }
      return this.token.value
    }).catch(error => {
      if (error && typeof error === 'object') this.diagnostics.set(error, diagnostic)
      throw error
    })
    this.tokenRequest = request
    try { return await request }
    finally { if (this.tokenRequest === request) this.tokenRequest = undefined }
  }

  async activityCode(scene: string): Promise<{ base64: string; mimeType: 'image/png' | 'image/jpeg' }> {
    if (!/^p[a-f0-9]{24}$/.test(scene)) fail('INVALID_POSTER_SCENE', '活动分享码无效', 400)
    const environment = process.env.WECHAT_CODE_ENV_VERSION || 'release'
    if (!['release', 'trial', 'develop'].includes(environment)) {
      logger.warn({ stage: 'config', reason: 'invalid_environment', env_version: 'invalid' })
      fail('WECHAT_CODE_UNAVAILABLE', '活动小程序码暂不可用', 503)
    }
    let diagnostic: WechatDiagnostic = { stage: 'config', reason: 'missing_config' }
    try {
      this.config()
      diagnostic = { stage: 'token', reason: 'invalid_response' }
      const token = await this.accessToken()
      diagnostic = { stage: 'code', reason: 'network' }
      const response = await fetch(`https://api.weixin.qq.com/wxa/getwxacodeunlimit?access_token=${encodeURIComponent(token)}`, {
        method: 'POST', signal: AbortSignal.timeout(10000),
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ scene, page: 'pages/activity/detail', env_version: environment, check_path: environment === 'release', width: 430, is_hyaline: false })
      })
      diagnostic.httpStatus = response.status
      const mimeType = response.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase()
      if (!response.ok) {
        diagnostic.reason = 'http'
        await response.body?.cancel()
        fail('WECHAT_CODE_UNAVAILABLE', '活动小程序码生成失败，请重试', 503)
      }
      const isImage = ['image/png', 'image/jpeg'].includes(mimeType || '')
      const image = await readResponse(response, isImage ? 1024 * 1024 : 16 * 1024, diagnostic)
      if (!isImage) {
        diagnostic.reason = 'invalid_json'
        const data: unknown = JSON.parse(image.toString('utf8'))
        diagnostic.reason = 'invalid_response'
        if (data && typeof data === 'object' && 'errcode' in data && typeof data.errcode === 'number' && Number.isSafeInteger(data.errcode) && data.errcode !== 0) {
          diagnostic.reason = 'upstream_error'; diagnostic.upstreamCode = data.errcode
        }
        fail('WECHAT_CODE_UNAVAILABLE', '活动小程序码生成失败，请重试', 503)
      }
      diagnostic.reason = 'invalid_image'
      const validPng = image.length >= 24 && image.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
      const validJpeg = image.length >= 4 && image[0] === 255 && image[1] === 216 && image[2] === 255 && image[image.length - 2] === 255 && image[image.length - 1] === 217
      if ((mimeType === 'image/png' && validPng) || (mimeType === 'image/jpeg' && validJpeg)) return { base64: image.toString('base64'), mimeType }
      fail('WECHAT_CODE_UNAVAILABLE', '活动小程序码生成失败，请重试', 503)
    } catch (error) {
      const detail = error && typeof error === 'object' ? this.diagnostics.get(error) : undefined
      if (detail) diagnostic = detail
      else if (timeoutError(error)) diagnostic.reason = 'timeout'
      logger.warn({ ...diagnostic, env_version: environment })
      // A manual retry obtains a fresh token; never retry an external call implicitly.
      this.token = undefined
      fail('WECHAT_CODE_UNAVAILABLE', '活动小程序码暂不可用，请稍后重试', 503)
    }
  }

  async phone(code: string) {
    const { appId } = this.config()
    const token = await this.accessToken()
    const data = await this.request(`https://api.weixin.qq.com/wxa/business/getuserphonenumber?access_token=${encodeURIComponent(token)}`, { code })
    const phone = data.phone_info as {
      phoneNumber?: unknown
      watermark?: {
        appid?: unknown
      }
    } | undefined
    if (typeof phone?.phoneNumber !== 'string' || phone.watermark?.appid !== appId
      || !/^\+?[0-9]{6,20}$/.test(phone.phoneNumber)) {
      fail('WECHAT_AUTH_FAILED', '手机号授权无效，请重新授权')
    }
    return phone.phoneNumber
  }
}
