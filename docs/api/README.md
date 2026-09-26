# API 契约

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
| `GET /activities`、`GET /activities/:id` | 公开活动列表、详情；列表按发布时间及创建时间倒序 |
| `GET /activities/:id/registrations` | 公开名单，仅返回当前头像和名称 |
| `POST /activities/:id/registrations` | 提交 `contactPhone`、`answers: [{ questionId, value }]`，报名或重新报名 |
| `GET /activities/:id/registrations/me` | 查看本人报名联系方式及答案 |
| `POST /activities/:id/registrations/me/answers` | 修改本人答案；保留等价 `PATCH /activities/:id/registrations/me` |
| `POST /activities/:id/registrations/me/cancel` | 取消本人报名，重复取消不重复释放名额 |
| `GET /members/me/registrations` | 查询本人报名及对应活动 |

受限请求携带 `Authorization: Bearer <token>`。公开列表不依赖会话；详情可携带有效会话以取得本人有权查看的咨询联系方式。携带失效令牌时返回 `SESSION_REQUIRED`，客户端应清理对应会话。手机号、主动设置头像、主动设置名称全部齐备才满足报名门槛；真实姓名不能替代。

微信小程序请求使用上表 POST 修改入口，避免依赖不受 `uni.request` 微信端支持的 PATCH 方法。两种入口使用同一 DTO、认证和业务服务，不存在宽松的专用权限通道。

活动 `registrationState` 为 `open`、`closed`、`full`、`cancelled`、`removed`；本人修改答案以报名截止为界，取消报名以活动开始为界。公开 `organizer` 仅含 `avatarUrl`、`displayName`，下架活动返回 `null`。活动咨询联系方式只返回给发起人或曾成功报名的会员，包括本人取消报名后的会员。当前列表上限为 100 条，公开报名名单上限为 200 条。

### 本地资源与配置

头像返回 `/api/v1/media/avatars/<随机文件名>`；客户端按当前 API 源解析相对路径。文件保存在 API 进程目录下 `.local-uploads/avatars`，可由 `LOCAL_AVATAR_DIRECTORY` 指定路径；不会发送至对象存储或生图服务。上传仅用于会员主动选择的头像，PNG/JPEG 签名、格式白名单和大小在服务端检查，返回图片使用固定媒体类型及 `nosniff`。

服务端需要 `WECHAT_MINIAPP_APP_ID`、`WECHAT_MINIAPP_SECRET`；缺失返回 `WECHAT_UNAVAILABLE`，没有开发登录绕过。平台根节点不存在时返回 `PLATFORM_NOT_READY`，应用启动不会创建根节点或业务数据。会话有效期由 `MEMBER_SESSION_TTL_SECONDS` 控制（默认 604800 秒，允许 60–2592000），并发有效会话数由 `MEMBER_SESSION_MAX_ACTIVE` 控制（默认 5，允许 1–20）；数据库仅保存随机令牌的 SHA-256 摘要，达到上限后撤销较早会话。

### 显式数据库测试边界

普通 `test` 不加载 `.env`，真实数据库测试默认跳过，跳过不算验收通过。`apps/api/test/flow-concurrency.spec.ts` 仅在 `HUIJU_DB_TEST=isolated` 且显式 `TEST_DATABASE_URL` 指向 `127.0.0.1:3306/huiju_flow_test_20260926` 时运行；其他库名或缺少变量直接拒绝。该测试不建库、不建表、不迁移，必须先单独取得隔离库与写入测试数据授权，并准备现有 schema。

并发测试用真实多连接检查首次邀请固定、最后名额竞争、重复报名、重复取消与复用原报名记录；只替换微信外部凭证交换。测试以本次 UUID 和专属 `appId` 清理自己创建的数据，在 `finally` 关闭连接并核对相关表测试前后数量。事务回滚测试和多连接提交测试是不同证据，不能互相替代。
