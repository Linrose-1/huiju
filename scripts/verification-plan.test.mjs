import assert from 'node:assert/strict'
import { test } from 'node:test'
import { verificationPlan } from './verification-plan.mjs'

test('API schema changes recommend contract and database checks without migration', () => {
  const plan = verificationPlan(['apps/api/src/database/schema/members.ts'])
  assert.ok(plan.commands.includes('corepack pnpm api:check'))
  assert.ok(plan.commands.includes('corepack pnpm --filter @huiju/api db:check'))
  assert.ok(plan.commands.every((command) => !/migrate|install|dev:/.test(command)))
  assert.ok(plan.manual.some((item) => item.includes('授权目标')))
})

test('mixed frontend changes select both apps and deduplicate lint', () => {
  const plan = verificationPlan(['apps/miniapp/src/pages/mine/index.vue', 'apps/admin/src/App.vue'])
  assert.ok(plan.commands.includes('corepack pnpm --filter @huiju/miniapp build'))
  assert.ok(plan.commands.includes('corepack pnpm --filter @huiju/admin build'))
  assert.equal(plan.commands.filter((command) => command.endsWith(' lint')).length, 1)
})

test('documentation-only changes do not select application tests', () => {
  assert.deepEqual(verificationPlan(['docs/README.md']).commands, ['git diff --check'])
  assert.deepEqual(verificationPlan(['docs/api/openapi.json']).commands, ['corepack pnpm api:check'])
})

test('global changes select verify once and retain database caveats', () => {
  const plan = verificationPlan(['package.json', 'apps/api/drizzle/0002.sql'])
  assert.deepEqual(plan.commands, ['corepack pnpm verify'])
  assert.ok(plan.manual.some((item) => item.includes('数据库')))
})

test('unknown paths are reported and paths outside the repository are rejected', () => {
  assert.deepEqual(verificationPlan(['unknown.cfg']).uncovered, ['unknown.cfg'])
  for (const file of ['../secret', 'C:\\outside', '/outside']) {
    assert.throws(() => verificationPlan([file]), /相对路径/)
  }
  assert.ok(verificationPlan(['apps\\miniapp\\src\\pages.json']).commands.length > 0)
})
