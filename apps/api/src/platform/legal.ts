import { fail } from '../common/errors.js'
import { randomUUID } from 'node:crypto'
import type { AdminTransaction } from '../admin/service.js'
import { legalConsents } from '../database/schema/platform.js'

export const LEGAL_VERSION = 'development-2026-10-04'
export const legalDocuments = {
  development: true,
  terms: { version: LEGAL_VERSION, title: '用户协议（开发占位）', body: '当前仅供开发验收，非正式用户协议。运营主体、联系方式及正式协议正文待补充和审核。正式上线前必须替换此占位内容。' },
  privacy: { version: LEGAL_VERSION, title: '隐私政策（开发占位）', body: '当前仅供开发验收，非正式隐私政策。运营主体、联系方式、个人信息处理说明及正式正文待补充和审核。正式上线前必须替换此占位内容。' },
}
export function requireLegalConsent(consent?: { termsVersion: string; privacyVersion: string }) {
  if (!consent || consent.termsVersion !== LEGAL_VERSION || consent.privacyVersion !== LEGAL_VERSION) {
    fail('LEGAL_CONSENT_REQUIRED', '请阅读并同意当前版本的用户协议和隐私政策后登录', 403)
  }
}
export async function recordLegalConsent(tx: AdminTransaction, memberId: string, consent: { termsVersion: string; privacyVersion: string }) {
  requireLegalConsent(consent)
  await tx.insert(legalConsents).values({ id: randomUUID(), memberId, ...consent })
}
