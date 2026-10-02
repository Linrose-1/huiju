import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { fileURLToPath, URL } from 'node:url'
import process from 'node:process'
import { validateCleanupTarget } from '../apps/api/scripts/recommendation-cleanup.mjs'

const url = 'mysql://fixture:fake-secret@127.0.0.1:3306/isolated_fixture'
const args = ['--apply', '--database-target=127.0.0.1:3306/isolated_fixture']
test('cleanup requires exact database target and explicit application flag', () => {
  assert.equal(validateCleanupTarget(args, url), '127.0.0.1:3306/isolated_fixture')
  for (const invalid of [[], args.slice(1), ['--apply'], ['--apply=true', args[1]], [...args, '--force'], ['--apply', '--database-target=127.0.0.1:3306/other'], ['--apply', '--apply']]) {
    assert.throws(() => validateCleanupTarget(invalid, url))
  }
  for (const invalid of [undefined, '', url + '?timezone=Z', url + '#fragment', url.replace('mysql:', 'https:'), url.replace('/isolated_fixture', '/')]) {
    assert.throws(() => validateCleanupTarget(args, invalid))
  }
})
test('unacknowledged cleanup exits before loading application or revealing connection details', () => {
  const run = spawnSync(process.execPath, [fileURLToPath(new URL('../apps/api/scripts/recommendation-cleanup.mjs', import.meta.url))],
    { encoding: 'utf8', env: { ...process.env, DATABASE_URL: url } })
  assert.equal(run.status, 1)
  assert.match(run.stderr, /未完成推荐数据清理/)
  assert.doesNotMatch(run.stdout + run.stderr, /fake-secret|mysql:\/\/|ECONNREFUSED|SQL/)
})
