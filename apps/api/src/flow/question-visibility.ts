import { fail } from './common.js'

// Contact fields are never eligible, including common English labels.
export function contactQuestion(prompt: string) {
  return /手机|电话|联系|微信|微\s*信|二维码|邮箱|邮件|电邮|qq|wechat|weixin|phone|mobile|e[\s-]*mail|qr[\s-]*code|contact/i.test(prompt)
}

export function validateQuestionVisibility(question: { prompt: string; publicToParticipants?: boolean }) {
  if (question.publicToParticipants && contactQuestion(question.prompt)) {
    fail('QUESTION_CONTACT_PRIVATE', '手机号、微信号、二维码等联系方式不能对参与者公开')
  }
}
