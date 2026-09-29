# API 契约

## AI 活动草拟

`POST /api/v1/ai/activity-drafts` 使用会员 Bearer 会话，提交 `{ "idea": "活动想法" }`。服务端为调用安全限制输入为 1–5000 字，这不是产品定义的输入体验上限。服务端要求手机号、用户主动设置的头像与名称均齐备。成功返回 `draft`、`missingFields` 和 `remainingToday`；`draft` 包含 `title`、`description`、`startsAt`、`endsAt`、`location`、`capacity`、`feeType`、`feeAmountCents`、`registrationDeadline` 和 `questions`。不确定的候选字段为 `null`，问题的 `type`、`required`、`options` 也可为 `null`；`coverUrl` 与 `consultationContact` 必须由用户填写。日期候选是带时区解析后的 UTC ISO 字符串。

按会员北京时间自然日最多返回 5 份有效草稿；失败不计次。`AI_DAILY_LIMIT` 为 HTTP 429，`AI_NOT_CONFIGURED` 为 503，`AI_GENERATION_FAILED` 为 502，`AI_TIMEOUT` 为 504；资料不完整为 `PROFILE_INCOMPLETE`。草拟接口不创建活动，也不保存原文或模型原始回复。部署前需配置 `AI_PROVIDER=agentishere`、`AI_BASE_URL` 与仅后端可见的 `AI_API_KEY`，并在明确授权后应用 `0006` 迁移；未应用迁移时接口不可用。

本地验证更新（2026-09-30）：`0006` 已于 2026-09-29 获授权应用于本机开发库，真实模型及微信工具模拟身份的生成→编辑页回填链路已通过；未保存或发布测试活动。真实微信、真机与真实库并发限额未验收，详见[技术设计](../architecture/ai-activity-draft.md)及[实现日志](../implementation-log/2026-09.md)。此状态不代表其他环境已配置或迁移。

`openapi.json` 从 NestJS 实际路由生成，`packages/api-client/src/generated.ts` 由该文件生成。执行仓库根目录的 `corepack pnpm api:generate`；不要手工修改生成文件。运行步骤与当前验证范围见[本地工程基线](../architecture/engineering-baseline.md)。

日常检查使用 `corepack pnpm api:check`：构建 API 后在临时目录导出并比较两份产物，忽略 CRLF 行尾差异，有漂移或缺失时返回非零，不覆盖当前改动。确认接口变更后再执行生成命令。相关消费者边界见 [api-client 规则](../../packages/api-client/AGENTS.md)。

## 最小业务链路接口

所有路径带 `/api/v1` 前缀，JSON 字段以生成客户端为准。成功的 POST 返回 HTTP 200；错误响应为 `{ code, message, requestId }`，不会返回数据库错误或微信凭据。

| 方法与路径 | 用途 |
| --- | --- |
| `POST /auth/wechat/session` | 提交 `code`、可选 `inviteCode`，换取 `token`、`expiresAt`、本人 `member` |
| `GET /auth/session`、`DELETE /auth/session` | 查询本人会话或撤销当前会话 |
| `POST /members/me/phone` | 提交微信手机号授权 `code`，不能提交手工手机号；已绑定后不可更换 |
| `POST /members/me/profile` | 提交用户主动设置的 `displayName`；保留等价 PATCH 路由 |
| `POST /members/me/avatar` | 提交 `mimeType` 和 `base64`，支持 2MB 内 PNG/JPEG；本地保存并更新本人头像 |
| `GET /activities`、`GET /activities/:id` | 公开活动列表、详情；列表每页10条，`offset` 翻页，`sort=upcoming` 按开始时间升序，其余按发布时间及创建时间倒序，`q` 搜索标题、介绍与地点；返回 `hasMore` |
| `GET /activities/:id/registrations` | 公开名单，仅返回会员名片定位 ID、当前头像和名称 |
| `POST /activities/:id/registrations` | 提交 `contactPhone`、`answers: [{ questionId, value }]`，报名或重新报名 |
| `GET /activities/:id/registrations/me` | 查看本人报名联系方式及答案 |
| `POST /activities/:id/registrations/me/answers` | 修改本人答案；保留等价 `PATCH /activities/:id/registrations/me` |
| `POST /activities/:id/registrations/me/cancel` | 取消本人报名，重复取消不重复释放名额 |
| `GET /members/me/registrations` | 查询本人报名及对应活动 |

受限请求携带 `Authorization: Bearer <token>`。公开列表不依赖会话；详情可携带有效会话以取得本人有权查看的咨询联系方式。携带失效令牌时返回 `SESSION_REQUIRED`，客户端应清理对应会话。手机号、主动设置头像、主动设置名称全部齐备才满足报名门槛；真实姓名不能替代。

微信小程序请求使用上表 POST 修改入口，避免依赖不受 `uni.request` 微信端支持的 PATCH 方法。两种入口使用同一 DTO、认证和业务服务，不存在宽松的专用权限通道。

活动 `registrationState` 为 `open`、`closed`、`full`、`cancelled`、`removed`；本人修改答案以报名截止为界，取消报名以活动开始为界。公开 `organizer` 仅含 `memberId`、`avatarUrl`、`displayName`，下架活动返回 `null`。活动咨询联系方式只返回给发起人或曾成功报名的会员，包括本人取消报名后的会员。公开活动列表每页10条，公开报名名单上限为 200 条。

### 发起人与站内通知接口

以下接口需有效会员会话；活动管理接口只允许活动发起人，名单中的联系手机号和答案不进入公开名单接口。所有写操作均使用小程序支持的 POST。

| 方法与路径 | 用途 |
| --- | --- |
| `POST /activities` | 完整填写必填字段及问题后保存草稿，需完整资料 |
| `POST /activities/:id/edit` | 发起人保存编辑；已有报名后题目和收费永久锁定 |
| `POST /activities/:id/publish` | 发布草稿，再次校验资料、时间和必填信息；重复发布幂等 |
| `GET /members/me/activities` | 本人最近创建的100场活动，`hasMore`说明是否还有更早记录 |
| `GET /activities/:id/manage` | 本人活动完整管理信息，包括草稿、生命周期和锁定状态 |
| `GET /activities/:id/registrations/manage` | 发起人查看报名记录、当次联系方式及自定义答案；含已取消报名 |
| `POST /activities/:id/cancel` | 开始前取消并提交reason；快照、操作记录、当前报名者通知同事务 |
| `GET /members/me/notifications` | 本人最近100条站内通知，带`hasMore` |
| `POST /members/me/notifications/:id/read` | 本人通知标记已读，重复操作保留首次已读时间 |

活动写入使用`ActivityWriteInput`完整载荷。题目ID由服务端生成，新建不传ID；编辑既有题目保留ID。保存草稿同样要求完整必填字段。已发布活动开始后只允许修改咨询联系方式，结束后不允许编辑；过期草稿可重新设置未来时间后发布。取消或下架活动不可编辑。联系方式变化为当前有效报名者写入站内通知，不把联系方式直接放入通知内容。活动问题、取消与报名共用活动行锁，首笔报名后即使报名全部取消也不解锁。签到、阅读统计和评论审核接口见下文；后台活动上下架尚未实现。

### 活动封面上传

`POST /media/covers` 接收 `{base64, mimeType}`（PNG/JPEG、最大2 MiB），要求登录且资料完整，返回 `{coverUrl}`。复用头像完整解码校验，拒绝格式伪装、损坏和超过16,777,216像素的图片。`GET /media/covers/:name` 匿名读取受控文件名，响应固定图片类型和 `nosniff`。

文件保存在API工作目录 `.local-uploads/covers`，可通过 `LOCAL_COVER_DIRECTORY` 指定；默认目录已被忽略，不提交图片。数据库仅保存相对路径，保存活动时校验本地文件存在且由本人上传；既有HTTPS封面地址保持兼容。上传成功不自动修改活动，仍需保存草稿或保存修改。当前不自动清理未保存或被替换的图片，正式部署前需要持久化目录与备份方案；没有接入云存储。

### 本地资源与配置

头像返回 `/api/v1/media/avatars/<随机文件名>`；客户端按当前 API 源解析相对路径。文件保存在 API 进程目录下 `.local-uploads/avatars`，可由 `LOCAL_AVATAR_DIRECTORY` 指定路径；不会发送至对象存储或生图服务。上传仅用于会员主动选择的头像，PNG/JPEG 签名、格式白名单和大小在服务端检查，返回图片使用固定媒体类型及 `nosniff`。

正常服务端需要 `WECHAT_MINIAPP_APP_ID`、`WECHAT_MINIAPP_SECRET`；缺失返回 `WECHAT_UNAVAILABLE`，不回退到模拟登录。另有用户明确启用的独立本地测试服务，见[脚本说明](../../scripts/README.md)。平台根节点不存在时返回 `PLATFORM_NOT_READY`，应用启动不会创建根节点或业务数据。会话有效期由 `MEMBER_SESSION_TTL_SECONDS` 控制（默认 604800 秒，允许 60–2592000），并发有效会话数由 `MEMBER_SESSION_MAX_ACTIVE` 控制（默认 5，允许 1–20）；数据库仅保存随机令牌的 SHA-256 摘要，达到上限后撤销较早会话。

### 显式数据库测试边界

普通 `test` 不加载 `.env`，真实数据库测试默认跳过，跳过不算验收通过。当前显式测试目标为用户已授权的本机 `127.0.0.1:3306/huiju`：`flow-concurrency.spec.ts` 使用 `HUIJU_DB_TEST=local-concurrency`，`flow-database.spec.ts` 使用 `rollback`，新增 `organizer-database.spec.ts` 使用 `organizer-rollback`；均需独立传入 `TEST_DATABASE_URL`，不回退开发连接、不建库、不建表、不迁移。发起人测试以外层事务回滚校验发布、名单权限、字段锁、取消快照及站内通知，不计为微信验收。

并发测试用真实多连接检查首次邀请固定、最后名额竞争、重复报名、重复取消与复用原报名记录；只替换微信外部凭证交换。测试以本次 UUID 和专属 `appId` 清理自己创建的数据，在 `finally` 关闭连接并核对相关表测试前后数量。事务回滚测试和多连接提交测试是不同证据，不能互相替代。


## 阅读留痕与统计

- `POST /activities/:id/views`：可选会话；UUID v4 `eventId`、`visitorId`。只在详情成功打开后调用，重试与身份就绪沿用 eventId。同事件幂等；已绑定其他身份时返回 `VISITOR_CHANGED`，换新访客/事件后重试一次。
- `GET /activities/:id/readers?offset=0`：公开，40条分页 `{items,total,hasMore}`；items 仅 `memberId`、当前 `avatarUrl` 与 `displayName`，同会员一次、最近阅读优先，不包含阅读时间或联系方式。
- `GET /activities/:id/view-stats`：发起人专属 `{views,visitors,conversionRate}`，转化率为百分数，无浏览时 null。
- 依赖 `0003_activity_reading.sql`；2026-09-27已授权应用于本机开发库，真实回滚测试和微信工具本地模拟身份验收完成；真实微信及真机未验收，证据见实现日志。


## 个人资料与会员名片（2026-09-27）

- `GET/POST /members/me/profile-details`：本人六项补充资料（真实姓名、邮箱、家乡、简介、资源、需求）。POST提交完整六项字符串，空字符串清空；不接受绑定手机号、邀请关系或身份字段。
- `GET/POST /members/me/card-settings`：本人七项展示开关，缺省全部关闭；POST必须提交七个布尔值。
- `GET /members/:id/card`：登录且资料完整才可访问，头像/名称固定返回，未开启的字段完全不出现在响应中。本人访问同样按展示设置组装；本人私密资料从前两接口读取。平台根和不存在会员返回404。
- 公开活动发起人、报名名单、阅读名单增加`memberId`供名片路由定位；名单本身仍不返回私密资料、阅读时间或报名答案。
- 名片预览在页面内存按未保存开关过滤，不把私密值放入路由或持久缓存。关闭字段不会删除本人原始资料。

## F06 开发接口（2026-09-28）

- POST /activities/:id/registrations/:registrationId/attendance：仅发起人，幂等标记有效报名到场。
- GET/POST /activities/:id/comments；GET /activities/:id/comments/mine；GET/POST /activities/:id/reviews。正文content 1–2000字，点评score为1–5整数。
- POST /comments/:id/edit、/delete；POST /reviews/:id/edit、/delete：仅本人；编辑不解除隐藏，删除为软删除。
- GET /activities/:id/feedback-context：公开资格提示及当前会员自己的点评；GET /activities/:id/reviews/stats仅发起人。
- 公共列表offset分页40条，返回items/total/hasMore。名片字段不随评论泄露。管理员隐藏使用下述独立后台接口。
- 0004已于2026-09-28获单独授权并应用，真实数据库回滚测试与微信工具本地模拟主流程证据见实现日志12:34；不计真实微信或真机通过。

## 后台登录、运营账号和评价审核

以下均位于 `/api/v1/admin`，只接受独立 HttpOnly Cookie 后台会话，不接受会员 Bearer 令牌。写接口校验配置的 Origin；登录之外的写接口还要求 `X-CSRF-Token`，令牌从登录或当前会话响应读取。首次登录或重置密码后可直接使用后台，不强制改密。

| 方法与路径 | 用途 / 权限 |
| --- | --- |
| `POST /auth/login` | 账号密码登录，返回 account 与 csrfToken，Cookie 交付会话 |
| `GET /auth/session` | 当前账号及 CSRF，不返回密码或会话令牌原文 |
| `POST /auth/password` | currentPassword/newPassword，自改成功后全部会话失效，必须重新登录 |
| `POST /auth/logout` | 撤销当前会话并清 Cookie |
| `GET /accounts` | 超管读取账号列表，仅返回安全字段 |
| `POST /accounts` | 超管开通运营，username/displayName/temporaryPassword，不接受角色参数 |
| `POST /accounts/:id/reset-password` | 超管重置运营临时密码，撤销旧会话，不强制改密 |
| `POST /accounts/:id/status` | 超管按 active 启停运营，撤销旧会话，不删除审计 |
| `GET /feedback` | 两角色可读，kind=comment/review、status=visible/hidden/all、offset，40条分页 |
| `POST /feedback/:kind/:id/hide` | 两角色可直接隐藏，reason 必填1–500字，原子记录操作人/原因/正文快照 |

审核列表返回活动标题、作者名称、正文、可空分数及隐藏时间/原因/操作人，不额外加载会员私密信息。本人删除的内容不在待审核列表出现。重复隐藏幂等，不能覆盖首次原因，也无恢复隐藏接口。

生产 `ADMIN_ORIGIN` 为后台 HTTPS origin；本地开发需显式 `ADMIN_ALLOW_LOCAL_HTTP=true` 且 origin 为回环 HTTP。浏览器与 API 同源（本地通过 Vite `/api` 代理）；不放开通配 CORS。0005已于2026-09-28获授权应用于127.0.0.1:3306/huiju，两套真实库回滚测试通过且无残留。随后已创建超管与验收运营，完成浏览器登录及普通运营隐藏评论/点评的本地验收；账号停用浏览器验收仍暂缓，后台会员页面完整交互未验收，详细边界见当月实现日志。


### 后台会员查询

- `GET /api/v1/admin/members`：两类后台角色均可查询，q 按编号／用户名称／真实姓名／绑定手机号作字面包含搜索；profile=all/complete/incomplete，inviterId 按直接邀请人筛选，offset 为 0–100000 整数，每页 40 条。平台根节点不在会员列表。
- `GET /api/v1/admin/members/:id`：完整资料、邀请码、直接邀请人和直接受邀人数；无修改入口，不受普通会员名片公开开关限制。缺失会员或平台根节点详情返回 404。响应不含微信标识、会话或凭据，使用 no-store。
- 当前切片不含活跃度、行为时间线和导出；不代表 F08 全部完成。

2026-09-28：本人发起活动列表 GET /members/me/activities 增加 total，统计该会员全部活动（含草稿等状态）；items仍最多100条，供我的页展示准确总数。

2026-09-28：站内通知列表增加 unreadCount，统计当前会员全部 readAt 为空的通知，不受列表最多100条限制。我的页进入或返回时刷新该值，正数显示红色数量角标（超过99显示99+），零时隐藏。
