# 本地工程基线与迁移流程

状态：2026-09-25 可重复运行基线。当前只验证健康接口，不代表微信登录、业务 API 或 MySQL 事务已经跑通。

## 环境配置

在仓库根目录把 `.env.example` 复制为 `.env`，仅在本机填写实际值；`.env` 已被 Git 忽略。API 的 `dev`、`start` 命令和 Drizzle 的 `db:generate`、`db:migrate` 命令从根目录 `.env` 读取变量。已有进程环境变量优先于文件值。

| 变量 | 当前用途 |
| --- | --- |
| `NODE_ENV`、`PORT` | API 运行模式与监听端口；`PORT` 必须为 1–65535 的整数，默认 3000 |
| `DATABASE_URL` | Drizzle 迁移和后续业务数据库连接；当前健康接口不连接数据库 |
| `MYSQL_DEV_PORT`、`MYSQL_DEV_PASSWORD`、`MYSQL_DEV_ROOT_PASSWORD` | 本地 Compose MySQL；示例仅供本地开发，不能用于共享或生产环境 |
| `WECHAT_MINIAPP_*`、`AI_*`、`OBJECT_STORAGE_*` | 对应功能实现时再启用；当前健康接口不读取 |

`.env.example` 的数据库地址与 Compose 的默认账号、端口一致。若修改数据库密码，也要同步调整 `DATABASE_URL`；连接串中的特殊字符需要 URL 编码。生产环境由部署系统注入变量，不复制本地示例密码。

## MySQL 版本与本地启动

首期固定 **MySQL 8.4 LTS**，本地镜像明确使用 `mysql:8.4.11`，不使用浮动 `latest`。8.4 属于 MySQL 官方的 [LTS 系列](https://dev.mysql.com/doc/refman/8.4/en/mysql-releases.html)；8.4.11 是 [Docker 官方镜像列出的固定标签](https://hub.docker.com/_/mysql?ta=tags&tab=tags)。更换补丁版本时更新 Compose 文件并在真实实例上重跑迁移与集成测试。

本机安装 Docker Compose 后，在仓库根目录执行：

```powershell
Copy-Item .env.example .env
docker-compose --env-file .env -f infra/docker/compose.yaml up -d
docker-compose --env-file .env -f infra/docker/compose.yaml ps
```

Compose 只将 MySQL 端口绑定到 `127.0.0.1:3307`，使用命名卷保存本地数据。`down` 不删除卷；不要在有需要保留的数据时使用 `down -v`。这组启动命令仅用于个人本地数据库，不能指向共享或生产实例。

## Schema 与迁移

Drizzle 的 schema 位于 `apps/api/src/database/schema`，迁移文件输出到 `apps/api/drizzle`。先修改 schema，再生成、审查、应用迁移；不使用 `db push` 绕过审查。首批身份、会员、邀请、活动、报名和通知 schema 已生成两步 migration：业务建表（含报名一致性约束）和平台根节点种子。2026-09-25 已在隔离的空白 MySQL 8.4.11 实例执行并重复运行迁移，得到 13 张业务表、1 张 Drizzle 迁移表、2 条迁移记录和 1 个平台根节点；该结果不代表共享或生产数据库已经迁移。

所有时间列统一使用毫秒精度。`updated_at` 的默认值由 MySQL 写入，后续更新时间由 Drizzle 的更新语句显式写入；首批迁移不使用数据库端 `ON UPDATE` 子句。绕过 Drizzle 的原生 SQL 更新必须自行同步写入 `updated_at`。

```powershell
corepack pnpm --filter @huiju/api db:generate
corepack pnpm --filter @huiju/api db:check
# 人工审查 apps/api/drizzle 内新生成的 SQL、外键、索引与数据影响
corepack pnpm --filter @huiju/api db:migrate
```

`db:generate` 只写迁移文件；`db:migrate` 会连接 `DATABASE_URL` 并改写目标数据库，必须在确认目标环境和获得该环境的迁移授权后执行。修改既有表时先评估数据保留、回填与前向修复路径。MySQL DDL 不应假定可以整体事务回滚；失败后检查迁移日志与实际表结构，再生成修复迁移。Drizzle 官方将 [generate](https://orm.drizzle.team/docs/drizzle-kit-generate) 与 [migrate](https://orm.drizzle.team/docs/drizzle-kit-migrate) 分为两个步骤。

当前用户提供的本地开发库位于 `127.0.0.1:3306/huiju`，实测服务版本为 MySQL 8.0.36，首批迁移和约束验证已通过。它与项目固定的 MySQL 8.4.11 交付基线存在版本差异；开发阶段可以继续使用，但发布前仍需在 8.4.11 上保持迁移和集成测试通过。数据库密码只通过本机环境提供，不写入仓库文档或示例文件。

### 2026-09-26 修正迁移（本地主机开发库已执行）

以上首批迁移结果为 2026-09-25 的历史验证。2026-09-26 13:34 +08:00 已重新核对 `127.0.0.1:3306/huiju`，版本为 MySQL 8.0.36；历史两步迁移哈希与仓库一致，身份表为空。经用户授权执行新增迁移并重复运行，迁移记录保持 3 条，三个身份列均为 `utf8mb4_0900_bin`。新增 `0002_wechat_identity_case_sensitive.sql` 只将微信身份三列改为 `utf8mb4_0900_bin`，保留既有字段长度、空值规则和索引；`0000`、`0001` 不改写。其他环境执行可能重建相关索引，仍需确认目标数据库、备份及迁移授权后运行。该迁移不修复历史错误身份合并；若发现已有异常须单独核验处理。

应用数据库入口在每次借出连接前设置 UTC 会话时区，失败时销毁该连接；驱动时区同时固定为 `Z`。此设置适用于应用连接池，不修改数据库全局时区，也不自动校正历史数据。本地主机真实验收已覆盖默认时间与应用写入时间一致、新连接/复用连接/事务的 UTC 时区，以及大小写不同的 app_id、open_id、union_id 分别保存和精确查询；完全重复的身份仍被唯一键拒绝。测试事务已回滚，验证前后均为 1 个平台根节点、0 条微信身份。MySQL 8.4.11、共享及生产环境未执行本次修正验收。

优先前向修复。回退字段排序规则前必须检查在原大小写不敏感规则下的身份碰撞；新规则可能已允许两条仅大小写不同的合法身份，不能直接回退或合并记录。停止应用修复时也不能简单恢复非 UTC 写入，需先评估已写入时间的语义。

## API、客户端与验证

```powershell
corepack pnpm api:generate
corepack pnpm --filter @huiju/api test
corepack pnpm verify
```

`api:generate` 先构建 API，再从 NestJS 实际路由导出 `docs/api/openapi.json`，最后生成 `packages/api-client/src/generated.ts`。手写的薄封装在 `packages/api-client/src/index.ts`；生成文件不得手改。每次改动接口响应或路径后重新生成，并检查契约与客户端差异。当前 E2E 测试启动真实本地 HTTP 服务，由生成客户端调用 `GET /api/v1/health` 并断言 `{"status":"ok"}`；它不覆盖数据库、微信和业务流程。

当前 `openapi-fetch` 只在 Node 本地 HTTP 测试验证；管理后台浏览器和 uni-app 微信运行时尚未接入。小程序接入时需核对其网络 API 并适配传输层，不能从这次 Node 测试推断真机可用。

`verify` 顺序运行 lint、类型检查、脚本与应用测试、三端构建、迁移静态检查和契约漂移比较。`api:check` 可单独从源码构建 API 后检查两份生成产物，不覆盖仓库文件；`verify:plan <文件...>` 只预览建议检查。具体命令副作用见[验证与验收](../testing/README.md)。第一批身份、邀请、活动与报名功能落地时，分别增加权限、状态与 MySQL 并发集成测试；健康接口测试不能代替这些业务测试。
