# 会聚

会聚是面向地产教育机构及学员的活动与会员协作产品。

## 当前状态

- 产品：首期 PRD 已形成可验收草案，部分业务细节仍待后续设计。
- 体验：小程序“活动、助手、我的”三个主页面已有高保真设计稿。
- 技术：pnpm workspace、三个应用工程骨架、MySQL 首批 schema 和待执行 migration 已建立。
- 实现：小程序已从原 HBuilderX `frontend/` 工程迁入 `apps/miniapp`；当前只有三 Tab 占位页，API 尚无身份、活动或报名业务接口。

## 入口文档

- [首期 PRD](docs/product/首期PRD.md)
- [小程序框架与导航](docs/product/小程序框架与导航.md)
- [技术选型与项目结构](docs/architecture/技术选型与项目结构.md)
- [首个业务流程技术设计](docs/architecture/first-flow.md)
- [本地工程基线与迁移流程](docs/architecture/engineering-baseline.md)
- [版本路线图](docs/product/版本路线图.md)
- [项目协作规则](AGENTS.md)
- [当前任务交接](HANDOFF.md)
- [实现日志](docs/implementation-log/README.md)
- [开发踩坑与防复发](docs/开发踩坑与防复发.md)

## 目标代码区

- `apps/miniapp`：微信小程序
- `apps/admin`：管理后台
- `apps/api`：业务 API
- `packages`：跨应用工程包
- `infra`：本地与部署配置
- `docs`：技术设计和接口文档
