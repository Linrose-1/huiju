# 共享包

- `api-client`：从 OpenAPI 生成的前端客户端。
- `shared`：不依赖任何应用框架的纯常量与少量类型。
- `config`：TypeScript、ESLint 等工程配置。

`api-client` 已接入从 NestJS OpenAPI 契约生成的类型，并以 `openapi-fetch` 提供薄客户端；当前仅验证健康接口的本地 HTTP 调用。生成命令与边界见[工程基线](../docs/architecture/engineering-baseline.md)。
