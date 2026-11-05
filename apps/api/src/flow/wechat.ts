import { Injectable } from '@nestjs/common'
import { fail } from './common.js'

@Injectable()
export class WechatAdapter {
  private token?: {
    value: string
    until: number
  }
  private tokenRequest?: Promise<string>

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

  private async request(url: string, body?: object): Promise<Record<string, unknown>> {
    try {
      const response = await fetch(url, {
        signal: AbortSignal.timeout(10000),
        ...(body ? {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body)
        } : {})
      })
      if (!response.ok) {
        fail('WECHAT_UNAVAILABLE', '微信服务暂不可用', 503)
      }
      const data = await response.json() as Record<string, unknown>
      if (data.errcode) {
        fail('WECHAT_AUTH_FAILED', '微信授权已失效，请重新授权', 400)
      }
      return data
    }
    catch (error) {
      if (error && typeof error === 'object' && 'getStatus' in error) {
        throw error
      }
      fail('WECHAT_UNAVAILABLE', '微信服务暂不可用，请重试', 503)
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
    const request = this.request('https://api.weixin.qq.com/cgi-bin/stable_token', {
      grant_type: 'client_credential', appid: appId, secret
    }).then(data => {
      const expiresIn = Number(data.expires_in)
      if (typeof data.access_token !== 'string' || !data.access_token || !Number.isFinite(expiresIn) || expiresIn <= 0) {
        fail('WECHAT_UNAVAILABLE', '微信服务暂不可用', 503)
      }
      this.token = { value: data.access_token, until: Date.now() + Math.max(0, expiresIn - 120) * 1000 }
      return this.token.value
    })
    this.tokenRequest = request
    try { return await request }
    finally { if (this.tokenRequest === request) this.tokenRequest = undefined }
  }

  async activityCode(scene: string): Promise<{ base64: string; mimeType: 'image/png' | 'image/jpeg' }> {
    if (!/^p[a-f0-9]{24}$/.test(scene)) fail('INVALID_POSTER_SCENE', '活动分享码无效', 400)
    const environment = process.env.WECHAT_CODE_ENV_VERSION || 'release'
    if (!['release', 'trial', 'develop'].includes(environment)) fail('WECHAT_CODE_UNAVAILABLE', '活动小程序码暂不可用', 503)
    try {
      const token = await this.accessToken()
      const response = await fetch(`https://api.weixin.qq.com/wxa/getwxacodeunlimit?access_token=${encodeURIComponent(token)}`, {
        method: 'POST', signal: AbortSignal.timeout(10000),
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ scene, page: 'pages/activity/detail', env_version: environment, check_path: environment === 'release', width: 430, is_hyaline: false })
      })
      const mimeType = response.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase()
      const maximumBytes = 1024 * 1024
      if (!response.ok || !['image/png', 'image/jpeg'].includes(mimeType || '') || !response.body
        || Number(response.headers.get('content-length') || 0) > maximumBytes) {
        await response.body?.cancel()
        fail('WECHAT_CODE_UNAVAILABLE', '活动小程序码生成失败，请重试', 503)
      }
      const reader = response.body.getReader(), chunks: Uint8Array[] = []
      let size = 0
      try {
        while (true) {
          const chunk = await reader.read()
          if (chunk.done) break
          size += chunk.value.byteLength
          if (size > maximumBytes) { await reader.cancel(); fail('WECHAT_CODE_UNAVAILABLE', '活动小程序码生成失败，请重试', 503) }
          chunks.push(chunk.value)
        }
      } finally { reader.releaseLock() }
      const image = Buffer.concat(chunks, size)
      const validPng = image.length >= 24 && image.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
      const validJpeg = image.length >= 4 && image[0] === 255 && image[1] === 216 && image[2] === 255 && image[image.length - 2] === 255 && image[image.length - 1] === 217
      if ((mimeType === 'image/png' && validPng) || (mimeType === 'image/jpeg' && validJpeg)) return { base64: image.toString('base64'), mimeType }
      fail('WECHAT_CODE_UNAVAILABLE', '活动小程序码生成失败，请重试', 503)
    } catch {
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
