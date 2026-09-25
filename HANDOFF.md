# 当前任务交接

- Task ID：`huiju-engineering-baseline-20260925`
- Project ID：`D:\code\gofor\会聚`
- 更新时间：2026-09-25 15:31:34 +08:00
- 状态：Current

> 本文件是当前状态索引，不是产品或架构事实来源。继续工作前仍需核对正式文档、代码和实时环境。

## 1. 当前目标与范围

已确认收费活动、活动咨询联系方式、再次报名及取消/下架后的数据规则，并完成可重复运行的工程基线：lint、环境配置、MySQL 版本与迁移流程、真实 API 调用及客户端生成。

已同步 PRD 与首个流程技术设计，并在隔离的空白本地 MySQL 8.4.11 实例执行首批迁移和约束验证。当前不提交或推送。

## 2. 规则、工作目录与正式来源

- 工作目录：`D:\code\gofor\会聚`
- 根规则：`AGENTS.md`
- 应用规则：`apps/miniapp/AGENTS.md`、`apps/admin/AGENTS.md`、`apps/api/AGENTS.md`
- 产品正式来源：`docs/product/首期PRD.md`、`docs/product/小程序框架与导航.md`
- 架构正式来源：`docs/architecture/技术选型与项目结构.md`、`database.md`、`auth.md`、`permissions.md`

## 3. 进度

### 已完成

- 建立 `apps/miniapp`、`apps/admin`、`apps/api` 和 `packages` 的 pnpm workspace 骨架。
- 将原 HBuilderX `frontend` 工程内容迁入 `apps/miniapp/src`，原目录已不在当前工作区。
- 整理产品与架构文档目录。
- 建立仓库和三个应用的协作规则。
- 建立当前交接、实现日志、经验文档、`.node-version`、`.npmrc` 和完整 `.gitignore`。
- 使用 Corepack pnpm `12.6.0` 完成 workspace 首次安装并生成 `pnpm-lock.yaml`。
- 固定小程序 Vue、DCloud 类型和 VueUse 的兼容版本，peer dependency 检查无问题。
- 明确允许执行 `esbuild`、`vue-demi`、`@parcel/watcher` 构建脚本，并拒绝遥测或非必要安装脚本。
- API 改为与 NestJS 12 一致的 ESM/NodeNext 输出，并增加独立构建配置。
- 三端 type-check 和 build 已通过。
- 已初始化本地 Git，默认分支为 `main`，远程 `origin` 指向 `https://github.com/Linrose-1/huiju.git`。
- 主数据库已由 PostgreSQL 调整为 MySQL；API 使用 `mysql2` 和 `drizzle-orm/mysql2`，锁文件已同步。
- 已补齐 `docs/architecture/auth.md`、`permissions.md`、`database.md` 和 `first-flow.md` 的首个业务流程最小设计。
- lint、三端类型检查、API HTTP 测试与三端构建已通过；健康接口从真实路由生成 OpenAPI 及客户端类型。
- 固定本地 MySQL 8.4.11 Compose 配置，并文档化 `.env`、Drizzle 生成/检查/迁移流程；首批迁移已在隔离验证实例执行。
- 已确认收费活动采用单一固定金额、报名立即占位且平台不记录或处理付款退款；免费和收费活动均填写咨询联系方式。
- 已确认取消后可重新报名、活动取消保留取消前报名名单与人数，以及答案在取消/下架/恢复状态下的修改规则。
- 已建立首批 13 张 MySQL Drizzle 表及两步 migration：业务建表（含报名一致性约束）、平台根节点种子；已在隔离验证实例执行并验证可重复运行。
- 已修正首批迁移的时间精度生成方式和收费金额空值约束，并为活动取消时人数增加不可变快照字段；后台目录规范统一为 `modules/<domain>`。
- 用户提供的本地主机开发库 `127.0.0.1:3306/huiju` 已完成两步迁移和约束验证；测试数据在事务中回滚，只保留正式结构及平台根节点。

### 尚未完成

- 尚未创建首个 commit，也尚未推送远程仓库。
- 本地主机 MySQL 开发库已迁移；隔离 MySQL 8.4.11 验证实例已在验收后停止。管理后台和小程序开发环境尚未启动；API 健康接口仅在测试进程中启动并完成真实本地 HTTP 调用。
- 现有 1 个健康接口 HTTP 测试和 1 个首批迁移契约测试；尚无身份、报名或并发的业务测试。
- 三个小程序 Tab 当前仍是占位页，实际业务功能尚未实现。
- 首个流程的会话、权限、活动与报名服务及接口尚未实现；当前只有 schema 和待执行 migration。

## 4. 已确认决策、禁止项与授权边界

- 技术方向：pnpm workspace；uni-app 小程序；Vue 管理后台；NestJS 模块化单体；MySQL + Drizzle；OpenAPI 客户端。
- 会聚保持独立产品和数据边界；未经明确确认不接入猩聚社。
- 首期不预设微服务、Redis、消息队列或平台内支付。
- 当前设计把活动生命周期与下架状态分开；报名可用性由状态、时间和容量在服务端事务中共同判断。
- 收费活动只有公开固定金额，不保存付款说明、收款码、付款状态或退款状态；费用问题统一提示联系发起人。
- 免费和收费活动都必须填写活动咨询联系方式；曾成功报名者在本人取消、活动取消或下架后仍保留查看权。
- 取消后再次报名复用同一条主记录并重新竞争名额；活动取消保留原名单和取消前人数，不计作到场。
- 前序工作已授权并完成依赖安装、兼容性修复、类型检查和构建。
- 前序工作已授权并完成 Git 初始化与远程关联。
- 已授权并完成本次隔离本地 MySQL 的迁移与约束验证；仍未授权 commit、push、共享数据库写入、其他外部账号操作和部署。

## 5. 文件与 Git 状态

- 观察时间：2026-09-25 11:39:31 +08:00。
- 当前是 Git 仓库，分支为 `main`，尚无 commit。
- `origin` 的 fetch/push 地址均为 `https://github.com/Linrose-1/huiju.git`。
- 远程仓库当前没有分支或标签；本地状态显示 18 个顶层未跟踪项。
- `pnpm-lock.yaml` 已生成，当前大小约 458 KB。

## 6. 服务、设备、账号、依赖与外部系统

- 观察时间：2026-09-25 03:35:03 +08:00。
- 本次测试在进程内启动了 API 并通过真实本地 HTTP 调用健康接口；隔离 MySQL 8.4.11 实例已完成迁移验证并停止。用户提供的 `127.0.0.1:3306/huiju` 当前可连接，实测版本为 MySQL 8.0.36，已迁移且约束测试数据全部回滚。未启动管理后台、小程序开发环境、HBuilderX、微信开发者工具或真机。
- 本机 Node：`v24.14.0`，与根目录 `engines.node` 和 `.node-version` 一致。
- 项目通过 Corepack 使用 pnpm `12.6.0`；系统 PATH 中直接调用的 pnpm 仍是 `9.5.0`，项目命令应优先使用 Corepack 或项目声明版本。
- 微信 AppID、主体资质、接口权限、模型供应商和部署账号状态均未核验。

## 7. 验证状态

### Passed

- 本次 `corepack pnpm verify` 通过：lint、三端类型检查、API 1 个真实 HTTP 客户端测试、1 个首批迁移契约测试与三端构建。
- 重新生成的两步首批 migration 通过 `corepack pnpm --filter @huiju/api db:check`；迁移契约测试确认毫秒时间默认值、收费非空条件和取消人数快照已写入 SQL。未把生成和检查表述为数据库执行成功。
- 首批 migration 在隔离空白 MySQL 8.4.11 上首次执行和重复执行均成功；实际得到 13 张业务表、1 张迁移表和 2 条迁移记录，平台根节点保持 1 条。
- MySQL 实测拒绝收费金额 `NULL`、收费金额 `0`、当前人数超过容量及取消活动缺少人数快照；接受正数收费金额和完整取消快照。当前人数由 10 更新为 8 后，取消人数快照仍为 10。
- 7 个 `updated_at` 列在 MySQL 中均显示毫秒精度、默认值 `CURRENT_TIMESTAMP(3)`，且未生成数据库端自动更新时间子句。
- 用户提供的 `127.0.0.1:3306/huiju` 上重复取得同样的约束结果；重复运行迁移后仍为 2 条迁移记录、1 个平台根节点和 0 条验证会员数据。
- `corepack pnpm api:generate` 成功导出 `/api/v1/health` OpenAPI 契约与客户端类型；`corepack pnpm peers check` 无问题。
- MySQL 8.4.11 本地 Compose 配置经 `docker-compose --env-file .env.example -f infra/docker/compose.yaml config --quiet` 静态检查通过。
- 首个流程设计已按 PRD F01–F04 静态对照，并检查文档之间的关键引用；状态与并发风险列入最小验收场景。
- `corepack pnpm install` 成功，锁文件通过 pnpm 供应链策略检查。
- `corepack pnpm peers check` 返回无 peer dependency 问题。
- 根 `type-check` 通过：miniapp、admin、api 均通过。
- 根 `build` 通过：管理后台、API 和微信小程序均生成产物。
- API 独立重建后确认入口为 `apps/api/dist/main.js`，与启动脚本一致。
- 数据库适配改为 MySQL 后重新执行依赖安装、peer 检查、根 type-check 和根 build，结果均通过。
- pnpm 已关闭隐式 peer 安装；`pg` 驱动确认不存在，`mysql2` 是唯一安装的关系数据库驱动，peer 检查无问题。

### Not Run

- 已确认产品规则尚未落成会话、权限、活动和报名业务服务或接口；schema 与 migration 已生成并在两套本地实例执行，但业务服务尚未实现。
- 尚未实现或验证报名业务事务、并发抢占名额、微信身份流程和共享环境迁移。
- 长期运行的本地 API、管理后台浏览器、小程序开发者工具和真机验收。
- 外部服务、部署环境和生产验证。

## 8. 风险、恢复点与不要重复的动作

- 系统代理为 SOCKS5，当前 Corepack 不接受该代理协议。已验证的项目安装方式是仅对当前命令清空代理变量并指定可直连的 npm registry，详见 `docs/开发踩坑与防复发.md`。
- 管理后台当前单个 JS 产物约 1 MB，Vite 给出大 chunk 告警；功能增长前应按路由拆包。
- 小程序构建存在 uni-scss/Sass 弃用告警；当前来自第三方样式包，后续升级 uni-app 时复查。
- 小程序未配置 AppID，当前构建通过不代表微信能力或真机通过。
- MySQL 适配已验证迁移和静态约束，但报名服务尚未实现，仍未验证并发抢占名额与事务行为。
- 当前主机开发库实际为 MySQL 8.0.36，低于项目固定的 8.4.11 交付基线；发布前必须继续在 8.4.11 上验证。
- workspace 使用 `autoInstallPeers: false`；以后新增依赖时必须显式补齐所需 peer，并运行 `pnpm peers check`。
- 当前尚无 commit 恢复点；首次提交前应审查纳入范围，确认没有构建产物或凭据被跟踪。
- 构建成功不代表应用已启动、接口可访问或业务验收通过。
- 不要在未核验微信账号权限和真机行为前承诺微信专属能力可用。

## 9. 下一最小可验证动作

开始实现微信身份与邀请服务、会员资料门槛及相关测试；报名服务落地时增加真实 MySQL 事务和并发名额测试。Git 首次提交与推送仍需单独授权。

## 10. 继续前必须复查的易变事实

- 当前是否已经成为 Git 仓库以及工作区是否有用户新增内容。
- Node、Corepack、pnpm 的实际版本和 registry 配置。
- `package.json` 中依赖版本是否仍为当前声明。
- HBuilderX、微信开发者工具、AppID 和相关接口权限。
- 数据库、API、前端端口和进程状态。
- 外部模型、部署平台和账号权限。
