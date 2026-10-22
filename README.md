# 有聚点

产品已由“会聚”更名为“有聚点”。现有仓库／本机目录名、`@huiju/*`包名、数据库名、服务名、存储键与历史设计稿文件名继续沿用，避免影响既有环境和数据；历史资料中的旧名称指同一产品。微信公众平台登记名称需在平台侧另行修改，本仓库修改不代表平台改名或发布完成。

有聚点是面向地产教育机构及学员的活动与会员协作产品。

## 项目与状态入口

项目已具备微信小程序、管理后台和 NestJS API 工程。产品范围以[首期 PRD](docs/product/首期PRD.md)、[导航文档](docs/product/小程序框架与导航.md)及已确认的专项需求为准。

当前任务、待验收项及带观察时间的环境信息统一见 [HANDOFF](HANDOFF.md)；已完成的实现与分层验证证据见[实现日志索引](docs/implementation-log/README.md)。这些记录不代表本次已重新验证运行环境、数据库、真实微信、真机或部署状态。

## 入口文档

- [文档总索引](docs/README.md)
- [设计版本与采用状态](设计稿/README.md)
- [首期 PRD](docs/product/首期PRD.md)
- [小程序框架与导航](docs/product/小程序框架与导航.md)
- [技术选型与项目结构](docs/architecture/技术选型与项目结构.md)
- [首个业务流程技术设计](docs/architecture/first-flow.md)
- [AI 活动草拟技术设计](docs/architecture/ai-activity-draft.md)
- [本地工程基线与迁移流程](docs/architecture/engineering-baseline.md)
- [版本路线图](docs/product/版本路线图.md)
- [项目协作规则](AGENTS.md)
- [当前任务交接](HANDOFF.md)
- [实现日志](docs/implementation-log/README.md)
- [开发踩坑与防复发](docs/开发踩坑与防复发.md)
- [验证与验收](docs/testing/README.md)
- [API与配置](docs/api/README.md)
- [资源、缺失图标与设计差异](docs/资源/资源清单.md)
- [工程脚本与副作用](scripts/README.md)
- [参考项目实践与落地](docs/architecture/工程实践借鉴.md)

## 常用检查

已有依赖时，在根目录执行：

```powershell
corepack pnpm verify:plan apps/miniapp/src/pages/activity/index.vue
corepack pnpm api:check
corepack pnpm verify
```

第一条仅预览建议；第二条检查接口与生成客户端是否一致；第三条检查完整工程基线。具体覆盖和副作用见验证文档，均不自动迁移数据库。

## 目录职责

- `apps/miniapp`：微信小程序
- `apps/admin`：管理后台
- `apps/api`：业务 API
- `packages`：跨应用工程包
- `infra`：本地与部署配置
- `docs`：产品、架构、接口、验收与实现记录
- `设计稿`：页面原稿、版本状态、设计说明与生成记录
- `scripts`：项目级开发与校验脚本
