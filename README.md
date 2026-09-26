# 会聚

会聚是面向地产教育机构及学员的活动与会员协作产品。

## 当前状态

- 产品：首期 PRD 已形成可验收草案，部分业务细节仍待后续设计。
- 体验：登录、活动、助手、我的及必要承接页已有设计稿和实现；原始素材与部分图标待补，尚未完成全部视觉验收。
- 技术：pnpm workspace、三个应用工程骨架和 MySQL schema 已建立；2026-09-26 本地开发库已执行三步迁移。环境与验证的最新记录见 HANDOFF，不代表已部署。
- 实现：小程序已实现8条路由，API已实现微信身份、资料补全、活动浏览、报名/修改答案/取消再报，OpenAPI与客户端同步；助手显示明确不可用状态。范围仅为最小链路，未实现整个PRD。
- 验证：工程检查通过；小程序最新27项测试通过，本机MySQL回滚与多连接并发测试通过。微信Secret待管理员提供，真实登录/手机号/完整报名及真机、登录后视觉验收按用户要求统一后置，持续目标未完成。

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

## 目标代码区

- `apps/miniapp`：微信小程序
- `apps/admin`：管理后台
- `apps/api`：业务 API
- `packages`：跨应用工程包
- `infra`：本地与部署配置
- `docs`：技术设计和接口文档
