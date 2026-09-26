import { Injectable } from '@nestjs/common'
import { fail } from './common.js'

@Injectable()
export class WechatAdapter {
  private token?: {
    value: string
    until: number
  }

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

  async phone(code: string) {
    const { appId, secret } = this.config()
    if (!this.token || this.token.until <= Date.now()) {
      const data = await this.request('https://api.weixin.qq.com/cgi-bin/stable_token', {
        grant_type: 'client_credential',
        appid: appId,
        secret
      })
      if (typeof data.access_token !== 'string') {
        fail('WECHAT_UNAVAILABLE', '微信手机号服务暂不可用', 503)
      }
      this.token = {
        value: data.access_token,
        until: Date.now() + Math.max(0, (Number(data.expires_in) - 120)) * 1000
      }
    }
    const data = await this.request(`https://api.weixin.qq.com/wxa/business/getuserphonenumber?access_token=${encodeURIComponent(this.token.value)}`, { code })
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
