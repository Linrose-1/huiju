# api

会聚业务 API，技术栈为 Node.js 24 LTS + NestJS + TypeScript + MySQL + Drizzle ORM。

首期采用模块化单体，一个服务进程承载身份、会员、活动、报名、统计、通知、内容配置和 AI 适配模块。

本地环境、MySQL 8.4 LTS、迁移命令与 OpenAPI 客户端生成见[工程基线](../../docs/architecture/engineering-baseline.md)。当前真实 HTTP 测试仅覆盖健康接口。
