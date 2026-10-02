# 会聚

会聚是面向地产教育机构及学员的活动与会员协作产品。

## 当前状态（2026-09-30）

- 小程序：已注册 18 条路由，覆盖活动分页与搜索、发起/管理、报名、阅读留痕、手动签到、评论/点评、资料与名片、通知和邀请码；名片已按 v3 设计实现，活动卡片及收费输入框已获得用户视觉确认。
- AI：已接入“帮我发活动”，整段文字经真实模型生成可编辑草稿，标题、介绍、明确时间、费用等字段回填已在微信开发者工具验证；由用户补齐并确认发布。“帮我找活动”对话推荐的代码与接口已接入，强制登录、资料可后补；推荐迁移、真实模型和微信验收尚未执行，不能沿用草拟功能的验收证据。详见[推荐方案](docs/architecture/activity-recommendation.md)。
- 后台：账号登录与管理、评论/点评隐藏、会员只读查询及详情已实现；本轮新增活动下架/恢复、原因与历史记录、站内通知，已通过 L1，并在本机隔离库完成真实 API、数据库及后台浏览器链路验收。运营文案维护等仍未实现。
- 收口：公开报名名单、我的报名、我发起的、管理名单与通知补齐分页，筛选与统计使用全量数据；本人报名查询失败不再遮挡公开详情。API 按身份、活动报名、反馈、通知、后台与 AI 建立模块边界，外部模型调用移到事务之外。
- 数据与契约：本机开发库 `127.0.0.1:3306/huiju` 的 `0000–0007` 迁移均已执行并核对；`0007` 只增加短期额度预留表与会员外键，原有成功次数未变。其他环境尚未因此完成迁移。OpenAPI 与生成客户端一致。
- 验证：本轮 2026-09-30 完整 `corepack pnpm verify` 通过（脚本 10、小程序 114、后台 13、API 145 项；9 项显式数据库测试跳过）；之后显式运行 AI 隔离库多连接测试 1 项通过，并完成后台活动下架/恢复的本地浏览器与数据库验收。其余列表的真实库分页、小程序微信工具交互、真实微信、真机及部署仍未验收。具体证据与限制见 [实现日志](docs/implementation-log/2026-09.md)。

## 入口文档

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

## 目标代码区

- `apps/miniapp`：微信小程序
- `apps/admin`：管理后台
- `apps/api`：业务 API
- `packages`：跨应用工程包
- `infra`：本地与部署配置
- `docs`：技术设计和接口文档
