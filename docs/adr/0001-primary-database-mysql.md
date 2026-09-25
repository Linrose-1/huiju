# ADR-0001：首期主数据库采用 MySQL

- 状态：Accepted
- 日期：2026-09-25

## 背景

首期技术基线最初使用 PostgreSQL。当前项目尚未建立正式业务表、SQL migration 或业务数据，数据库引擎仍可低成本调整。

## 决策

会聚首期主数据库改为 MySQL，并继续使用 Drizzle ORM 管理 TypeScript schema 和可审查的 SQL migration。API 使用 `mysql2` Promise 连接池和 `drizzle-orm/mysql2` 适配器。

## 约束

- MySQL 是报名、名额、邀请关系、权限和状态流转的业务事实来源。
- 并发报名通过事务、唯一约束和条件更新保证，不能依赖客户端或进程内计数。
- 所有 schema 变更通过 Drizzle migration 留痕并审查 SQL。
- 在真实 MySQL 上验证依赖事务、锁和唯一约束的集成测试。

## 影响

- 移除 `pg` 和 `@types/pg`，增加 `mysql2`。
- `DATABASE_URL` 使用 `mysql://` 连接串。
- 后续 schema 使用 Drizzle 的 MySQL column builders 和索引能力。
- 当前无表、无 migration、无数据，因此不需要数据迁移。
