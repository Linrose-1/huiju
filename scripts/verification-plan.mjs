import path from 'node:path'
import process from 'node:process'
import { pathToFileURL } from 'node:url'

// Only recommend checks. Never execute commands, inspect credentials or start services.
export function verificationPlan(files) {
  const commands = new Set()
  const manual = new Set()
  const uncovered = []
  for (const input of files) {
    const file = input.replaceAll('\\', '/')
    if (path.posix.isAbsolute(file) || /^[A-Za-z]:/.test(file) || file.split('/').includes('..')) {
      throw new Error('请使用仓库相对路径，不允许绝对路径或上级目录。')
    }
    if (file === 'docs/api/openapi.json') {
      commands.add('corepack pnpm api:check')
    } else if (/^(docs\/|设计稿\/)|\.md$/.test(file)) {
      commands.add('git diff --check')
      manual.add('核对文档与当前实现；设计稿变更需逐页人工验收。')
    } else if (/^apps\/api\//.test(file)) {
      commands.add('corepack pnpm --filter @huiju/api type-check')
      commands.add('corepack pnpm --filter @huiju/api test')
      commands.add('corepack pnpm api:check')
      if (/\/(drizzle\/|database\/)|drizzle\.config/.test(file)) {
        commands.add('corepack pnpm --filter @huiju/api db:check')
        manual.add('数据库变更需在授权目标上验证迁移、事务与并发；本计划不连接数据库。')
      }
    } else if (/^apps\/miniapp\//.test(file)) {
      commands.add('corepack pnpm --filter @huiju/miniapp type-check')
      commands.add('corepack pnpm --filter @huiju/miniapp build')
      manual.add('核对 pages.json 原生标题、页面入口和状态；微信能力需开发者工具或真机验收。')
    } else if (/^apps\/admin\//.test(file)) {
      commands.add('corepack pnpm --filter @huiju/admin test')
      commands.add('corepack pnpm --filter @huiju/admin build')
      manual.add('后台 build 已含类型检查；无测试文件不等于业务测试通过，需按改动验收浏览器流程。')
    } else if (/^packages\/api-client\//.test(file)) {
      commands.add('corepack pnpm api:check')
      commands.add('corepack pnpm type-check')
      commands.add('corepack pnpm --filter @huiju/api test')
      manual.add('生成类型一致不代表微信传输层可用；客户端封装变化需验证实际消费者。')
    } else if (/^scripts\//.test(file)) {
      commands.add('corepack pnpm test:scripts')
      manual.add('按脚本说明核对副作用，使用有效与失败输入验证退出码。')
    } else if (/^packages\/|^(package\.json|pnpm-lock\.yaml|pnpm-workspace\.yaml|tsconfig.*\.json|eslint\.config\..*|\.npmrc|\.node-version)$/.test(file)) {
      commands.add('corepack pnpm verify')
    } else if (/^infra\/|^\.env\.example$/.test(file)) {
      manual.add('配置变更需定向静态检查；安装、启动、迁移和部署不由本计划授权或执行。')
    } else {
      uncovered.push(file)
    }
  }
  if (commands.has('corepack pnpm verify')) {
    commands.clear()
    commands.add('corepack pnpm verify')
  } else if (files.some((file) => /\.(?:[cm]?[jt]sx?|vue)$/.test(file))) {
    commands.add('corepack pnpm lint')
  }
  return { commands: [...commands], manual: [...manual], uncovered }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    const files = process.argv.slice(2)
    if (!files.length) throw new Error('用法：corepack pnpm verify:plan <本次修改的仓库相对路径...>')
    const plan = verificationPlan(files)
    process.stdout.write(`${JSON.stringify({ mode: 'plan-only', files, ...plan }, null, 2)}\n`)
    if (plan.uncovered.length) process.exitCode = 1
  } catch (error) {
    process.stderr.write(`${error.message}\n`)
    process.exitCode = 1
  }
}
