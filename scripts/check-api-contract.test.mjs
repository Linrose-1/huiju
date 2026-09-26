import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { findContractDrift } from './check-api-contract.mjs'

test('detects changed and missing artifacts without rewriting them', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'huiju-contract-test-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const changedPath = join(directory, 'generated.ts')
  const missingPath = join(directory, 'openapi.json')
  await writeFile(changedPath, 'old contract\n')
  assert.deepEqual(await findContractDrift([
    { path: changedPath, expected: 'new contract\n' },
    { path: missingPath, expected: '{}\n' },
  ]), [changedPath, missingPath])
  assert.deepEqual(await findContractDrift([
    { path: changedPath, expected: 'old contract\n' },
  ]), [])
})

test('ignores CRLF differences while checking both generated artifacts', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'huiju-contract-test-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const document = join(directory, 'openapi.json')
  const client = join(directory, 'generated.ts')
  await writeFile(document, '{\r\n}\r\n')
  await writeFile(client, 'export {};\n')
  assert.deepEqual(await findContractDrift([
    { path: document, expected: '{\n}\n' },
    { path: client, expected: 'export {};\r\n' },
  ]), [])
})
