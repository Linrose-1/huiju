# API 客户端协作规则

继承根目录规则。本包只承载 OpenAPI 生成类型和薄传输封装，不承载数据库模型或业务权限判定。

- `src/generated.ts` 由 `docs/api/openapi.json` 生成，禁止手工维护第二份协议。
- API 变动时先检查 DTO、权限可见字段及两端消费者，再运行 `corepack pnpm api:generate` 更新产物；检查使用 `corepack pnpm api:check`，不覆盖现有产物。
- 不通过去掉类型、扩大为任意字段或在客户端伪造成功来绕过契约差异。
- Node HTTP 测试不证明 uni-app 微信端支持 `fetch`；小程序传输适配随真实接口接入验证，不能把生成类型通过称作真机可用。
- URL、认证和错误处理由各端服务层适配；不在本包硬编码服务器、存储凭据或引入页面组件。
- 验证命令及副作用见根目录 `docs/testing/README.md` 和 `scripts/README.md`。
