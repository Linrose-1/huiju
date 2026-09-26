# 工程脚本

只保存可重复执行的开发、生成和校验脚本。一次性人工命令不沉淀到这里。

| 根目录命令 | 用途与副作用 |
| --- | --- |
| `corepack pnpm verify:plan <文件...>` | 按显式相对路径输出建议检查及人工验收项，不执行检查、不读环境文件、不连接外部服务；未知路径非零退出 |
| `corepack pnpm api:check` | 构建 API、导出临时 OpenAPI、生成临时客户端文本并比较现有产物；漂移非零退出，不覆盖仓库产物 |
| `corepack pnpm api:generate` | 构建 API 并覆盖正式 OpenAPI、客户端生成文件；仅在契约确实需要同步时执行并审阅 diff |
| `corepack pnpm test:scripts` | Node 内置测试；包含临时文件测试，完成后清理自身文件 |
| `corepack pnpm verify` | lint、类型检查、脚本和应用测试、构建、迁移静态检查、契约比较；不会自动安装、迁移或部署 |

示例：`corepack pnpm verify:plan apps/api/src/database/db.ts docs/architecture/database.md`。

计划器是轻量建议器，不扫描 Git、不证明所选文件已修改，也不自动识别完整依赖影响；调用前核对本次文件范围。输入路径只用于选择检查类别，推荐命令可能扫描整个模块或仓库，例如根 lint 和 `git diff --check`；其他脏文件导致的失败应单独注明归属。数据库实际验证、真机与页面视觉仍按[验证矩阵](../docs/testing/README.md)进行。

`api:check` 从当前源码先构建，避免直接比对陈旧 dist；完整 `verify` 已构建 API，内部直接调用比较脚本以避免重复构建。契约导出组装 Nest 应用但不监听端口，模块初始化必须保持无数据库写入和外部调用副作用。
