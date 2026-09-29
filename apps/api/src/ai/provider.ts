import { Injectable } from '@nestjs/common'
import { fail } from '../flow/common.js'

@Injectable()
export class AgentIsHereDraftProvider {
  async generate(idea: string): Promise<unknown> {
    const apiKey = process.env.AI_API_KEY
    const baseUrl = process.env.AI_BASE_URL
    if (process.env.AI_PROVIDER !== 'agentishere' || !apiKey || !baseUrl || !/^https:\/\/[^\s]+$/.test(baseUrl)) {
      fail('AI_NOT_CONFIGURED', 'AI 草拟暂不可用，请稍后再试', 503)
    }
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 90000)
    try {
      const response = await fetch(`${baseUrl.replace(/\/$/, '')}/chat/completions`, {
        method: 'POST',
        headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
        body: JSON.stringify({
          model: 'gpt-5.5',
          temperature: 0,
          messages: [
            { role: 'system', content: `你是活动信息草拟器。今天是 ${new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Shanghai' })}（北京时间）。只使用用户明确提供的事实，不能编造时间、地点、人数、费用、联系方式。相对日期和缺少年份的日期一律置 null，不根据今天推算。只输出 JSON 对象，键必须为 title, description, startsAt, endsAt, location, capacity, feeType, feeAmountCents, registrationDeadline, questions。日期须带时区的 ISO8601 字符串；无从确定则 null。免费 feeType=free 且金额 null；收费但金额未知时 feeType=paid 且金额 null。questions 为数组，每项为 prompt, type, required, options；不明确的 type、required、options 为 null。标题和介绍可基于活动内容润色，但不得添加事实。不要生成封面、咨询联系方式或其他键。` },
            { role: 'user', content: idea },
          ],
        }),
        signal: controller.signal,
      })
      if (!response.ok) fail('AI_GENERATION_FAILED', '生成失败，请稍后手动重试', 502)
      const payload = await response.json() as { choices?: { message?: { content?: unknown } }[] }
      const content = payload.choices?.[0]?.message?.content
      if (typeof content !== 'string' || content.length > 50000) fail('AI_GENERATION_FAILED', '生成失败，请稍后手动重试', 502)
      return JSON.parse(content) as unknown
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') fail('AI_TIMEOUT', '生成超时，请手动重试', 504)
      // Provider errors and response bodies must never reach the client or logs.
      fail('AI_GENERATION_FAILED', '生成失败，请稍后手动重试', 502)
    } finally {
      clearTimeout(timeout)
    }
  }
}
