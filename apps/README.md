# 应用目录

三个应用均已有源码、依赖清单和构建配置；构建入口存在不代表已部署。

| 应用 | 职责与入口 |
| --- | --- |
| [miniapp](miniapp/README.md) | uni-app 微信小程序；页面与微信能力约束见 [AGENTS](miniapp/AGENTS.md) |
| [admin](admin/README.md) | Vue 管理后台；业务页面按 `src/modules` 组织，约束见 [AGENTS](admin/AGENTS.md) |
| [api](api/README.md) | NestJS 模块化单体 API；数据迁移留在应用内 `drizzle/`，约束见 [AGENTS](api/AGENTS.md) |

当前任务和待验收项见 [HANDOFF](../HANDOFF.md)，实际验证证据见[实现日志](../docs/implementation-log/README.md)。启动和校验命令的副作用见[脚本说明](../scripts/README.md)。
