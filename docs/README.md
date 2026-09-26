# 技术文档

- `product`：首期需求、PRD、导航与版本路线图。
- `architecture`：技术选型、数据库、身份与权限设计。
- `adr`：重要架构决策记录。
- `api`：接口规范及客户端生成约定。
- `testing`：测试策略与验收证据。
- `implementation-log`：按月记录已经完成且有证据的实现事实。
- `开发踩坑与防复发.md`：经过复现和验证的项目专属经验。

产品需求位于 `product`，实现状态和过程记录不得覆盖产品与架构正式来源。

首个业务流程的技术设计入口：[身份与会话](architecture/auth.md)、[权限策略](architecture/permissions.md)、[数据关系](architecture/database.md)、[活动与报名状态](architecture/first-flow.md)。

本地环境、MySQL 版本、迁移与客户端生成步骤见[本地工程基线](architecture/engineering-baseline.md)。

按任务选择检查见[验证与验收](testing/README.md)，命令副作用见[工程脚本](../scripts/README.md)。来自猩球工坊与猩商态的工程取舍记录在[工程实践借鉴](architecture/工程实践借鉴.md)，不作为产品规则来源。
