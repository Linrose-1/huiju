import { execFile } from 'node:child_process'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve, join } from 'node:path'
import process from 'node:process'
import { fileURLToPath, pathToFileURL, URL } from 'node:url'
import { promisify } from 'node:util'
import openapiTS, { astToString, COMMENT_HEADER } from 'openapi-typescript'

const projectRoot = fileURLToPath(new URL('../', import.meta.url))
const runFile = promisify(execFile)
const normalize = (text) => text.replace(/\r\n/g, '\n')

export async function findContractDrift(artifacts) {
  const changed = []
  for (const { path, expected } of artifacts) {
    let actual
    try {
      actual = await readFile(path, 'utf8')
    } catch (error) {
      if (error.code !== 'ENOENT') throw error
    }
    if (actual === undefined || normalize(actual) !== normalize(expected)) {
      changed.push(path)
    }
  }
  return changed
}

async function main() {
  const tempDirectory = await mkdtemp(join(tmpdir(), 'huiju-api-contract-'))
  try {
    const openApiPath = join(tempDirectory, 'openapi.json')
    await runFile(process.execPath, [
      resolve(projectRoot, 'apps/api/scripts/export-openapi.mjs'),
      openApiPath,
    ], { cwd: projectRoot })
    const document = await readFile(openApiPath, 'utf8')
    const client = COMMENT_HEADER + astToString(await openapiTS(JSON.parse(document)))
    const changed = await findContractDrift([
      { path: resolve(projectRoot, 'docs/api/openapi.json'), expected: document },
      { path: resolve(projectRoot, 'packages/api-client/src/generated.ts'), expected: client },
    ])
    if (changed.length) {
      process.stderr.write(`API contract drift detected:\n${changed.join('\n')}\nRun pnpm api:generate, review the generated changes, then rerun pnpm api:check.\n`)
      process.exitCode = 1
    } else {
      process.stdout.write('OpenAPI and API client match the built API.\n')
    }
  } finally {
    await rm(tempDirectory, { recursive: true, force: true })
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((error) => {
    process.stderr.write(`API contract check failed: ${error.message}\nRun pnpm --filter @huiju/api build before this check.\n`)
    process.exitCode = 1
  })
}
