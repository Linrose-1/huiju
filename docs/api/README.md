# API 契约

`openapi.json` 从 NestJS 实际路由生成，`packages/api-client/src/generated.ts` 由该文件生成。执行仓库根目录的 `corepack pnpm api:generate`；不要手工修改生成文件。运行步骤与当前验证范围见[本地工程基线](../architecture/engineering-baseline.md)。

日常检查使用 `corepack pnpm api:check`：构建 API 后在临时目录导出并比较两份产物，忽略 CRLF 行尾差异，有漂移或缺失时返回非零，不覆盖当前改动。确认接口变更后再执行生成命令。相关消费者边界见 [api-client 规则](../../packages/api-client/AGENTS.md)。
