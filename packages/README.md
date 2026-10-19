# 共享包

- `api-client`：从 NestJS OpenAPI 契约生成的类型及 `openapi-fetch` 薄客户端。维护与生成约定见 [AGENTS](api-client/AGENTS.md) 和 [API 文档](../docs/api/README.md)。
- `shared`：不依赖应用框架的纯常量与少量类型，不承载服务端业务规则。
- `config`：预留包，目前仅有 `package.json`，尚未承载共享配置。根目录已有 [tsconfig.base.json](../tsconfig.base.json) 与 [eslint.config.js](../eslint.config.js)；各应用按实际工具链配置。

当前前端仍通过源码相对路径使用 `api-client`，尚未在应用依赖清单中声明对应 workspace 依赖。本次仅说明现状；依赖接线与包入口调整另行实施。具体业务验证记录见[实现日志](../docs/implementation-log/README.md)。
