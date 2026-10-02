// Explicit maintenance only. This module does not load .env or connect on import.
import process from 'node:process'
import { pathToFileURL, URL } from 'node:url'

export function validateCleanupTarget(args, databaseUrl) {
  if (args.length !== 2 || args.filter(arg => arg === '--apply').length !== 1) throw new Error('arguments')
  const targetArg = args.find(arg => arg.startsWith('--database-target='))
  if (!targetArg) throw new Error('target required')
  const url = new URL(databaseUrl || '')
  const target = `${url.hostname}:${url.port || '3306'}${url.pathname}`
  if (url.protocol !== 'mysql:' || url.search || url.hash || !url.hostname || !/^\/[^/]+$/.test(url.pathname)
    || targetArg.slice('--database-target='.length) !== target) throw new Error('target mismatch')
  return target
}

async function main() {
  let app
  try {
    validateCleanupTarget(process.argv.slice(2), process.env.DATABASE_URL)
    // Import built code only after an explicit, exact target acknowledgement.
    const [{ NestFactory }, { RecommendationRecordsModule }, { RecommendationRecordsService }] = await Promise.all([
      import('@nestjs/core'), import('../dist/recommendations/records.module.js'), import('../dist/recommendations/records.js'),
    ])
    app = await NestFactory.createApplicationContext(RecommendationRecordsModule, { logger: false })
    await app.get(RecommendationRecordsService).cleanup()
    process.stdout.write('推荐过期结果及到期效果明细清理完成。\n')
  } catch {
    process.stderr.write('未完成推荐数据清理。请核对授权目标、--apply、--database-target、构建及迁移状态。\n')
    process.exitCode = 1
  } finally {
    try { await app?.close() } catch { process.exitCode = 1 }
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main()
