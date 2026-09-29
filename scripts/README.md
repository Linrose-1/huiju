# 工程脚本

只保存可重复执行的开发、生成和校验脚本。一次性人工命令不沉淀到这里。

| 根目录命令 | 用途与副作用 |
| --- | --- |
| `corepack pnpm dev:api:local-test` | 构建后启动仅监听127.0.0.1:3001的测试API；只允许本机3306/huiju，使用独立模拟微信身份和手机号，业务操作会写本地开发库；不迁移 |
| `corepack pnpm dev:miniapp:local-test` | 生成并监听微信开发产物，固定连接3001测试API；登录页提供测试头像和模拟手机号，正常build不启用；`build --mode local-test`拒绝执行 |
| `corepack pnpm verify:plan <文件...>` | 按显式相对路径输出建议检查及人工验收项，不执行检查、不读环境文件、不连接外部服务；未知路径非零退出 |
| `corepack pnpm api:check` | 构建 API、导出临时 OpenAPI、生成临时客户端文本并比较现有产物；漂移非零退出，不覆盖仓库产物 |
| `corepack pnpm api:generate` | 构建 API 并覆盖正式 OpenAPI、客户端生成文件；仅在契约确实需要同步时执行并审阅 diff |
| `corepack pnpm test:scripts` | Node 内置测试；包含临时文件测试，完成后清理自身文件 |
| `corepack pnpm verify` | lint、类型检查、脚本和应用测试、构建、迁移静态检查、契约比较；不会自动安装、迁移或部署 |

示例：`corepack pnpm verify:plan apps/api/src/database/db.ts docs/architecture/database.md`。

本地模拟模式：先运行上述测试API命令，再在另一个终端启动测试小程序。微信工具打开`apps/miniapp/dist/dev/mp-weixin`，如仍显示旧身份，清理工具缓存并完整编译。API脚本在NODE_ENV未设置时默认development，显式production/test一律拒绝。测试身份固定为本机同一会员，清缓存只清客户端会话，不删除数据库报名；模拟手机号19900000001不是已通过微信认证的真实号码。首次进入资料页点击“使用测试头像”“绑定模拟手机号”，填写标有测试含义的名称并保存。仅使用明确标记的本地测试活动。

恢复真实微信模式：停止小程序测试编译，运行`corepack pnpm dev:miniapp`并连接正常3000 API；也可停止3001测试服务。两种环境缓存按API地址隔离，测试令牌不能登录正常API。测试服务依赖开发依赖@nestjs/testing和独立scripts入口，正式main不导入测试适配器；禁止部署此脚本。模拟模式验证不计为客户AppID、真实手机号或真机验收。

计划器是轻量建议器，不扫描 Git、不证明所选文件已修改，也不自动识别完整依赖影响；调用前核对本次文件范围。输入路径只用于选择检查类别，推荐命令可能扫描整个模块或仓库，例如根 lint 和 `git diff --check`；其他脏文件导致的失败应单独注明归属。数据库实际验证、真机与页面视觉仍按[验证矩阵](../docs/testing/README.md)进行。

`api:check` 从当前源码先构建，避免直接比对陈旧 dist；完整 `verify` 已构建 API，内部直接调用比较脚本以避免重复构建。契约导出组装 Nest 应用但不监听端口，模块初始化必须保持无数据库写入和外部调用副作用。

## 后台账号维护（执行需单独授权）

`apps/api/scripts/admin-account.mjs` 是部署维护入口，不由应用启动、迁移或普通测试调用。0005必须先应用。初始超管用 `--mode=bootstrap`，已有超管找回用 `--mode=recover`；都需 `--apply`、`--username=<登录名>`、`--database-target=<主机:端口/库名>`，初始化另需 `--display-name=<显示名称>`。目标须与进程中的 DATABASE_URL 严格匹配，不接受额外URI查询参数。

由维护人员在交互终端运行；需要时明确使用 Node 的 `--env-file` 指定已授权环境文件，禁止把连接串或密码放入命令参数。密码在终端双次隐藏输入，12–128位且包含字母与数字，脚本不打印密码/SQL错误。初始化已有超管时拒绝；恢复仅针对超管并撤销全部旧会话，二者均要求下次登录改密、记录维护审计。账号创建和恢复是真实数据库写入，不能因脚本已存在或语法检查通过而默认获得执行授权。

后台开发使用 `corepack pnpm dev:admin --host 127.0.0.1`；Vite默认将`/api`代理到127.0.0.1:3000，可仅为开发进程设置`ADMIN_API_PROXY`切换已授权API。后端`ADMIN_ORIGIN`须精确匹配浏览器origin，本地HTTP另需`ADMIN_ALLOW_LOCAL_HTTP=true`；生产禁止该例外。代理配置不是数据库、账号初始化或部署授权。


## 小程序独立视觉预览

执行 `node scripts/preview-miniapp.mjs`，访问 `http://127.0.0.1:4176/?page=activity`。
支持 page：`login`、`activity`、`assistant`、`mine`、`detail`、`form`、`result`、`registrations`。

- 使用已安装的 Vite、Vue 编译器与真实页面组件，临时文件写入被忽略的 `.codex-runtime-logs/visual-preview`；不改小程序入口或打包配置。
- 固定本机 127.0.0.1:4176，端口占用时报错，不抢占服务。不加载 .env、不连接 API/数据库、不执行微信登录，不生成可用会话。全部示例数据明确标注；写入方法抛出“视觉预览不执行业务写入”。
- 身份、API、导航和微信服务仅在此预览内替换，未声明的服务导入直接拒绝。正式应用继续使用原真实服务和鉴权。
- 原生 view/text/image/scroll-view 映射到浏览器元素，rpx 按视口换算，原生标题、底部导航及 uni-icons 使用简化外壳。因此只能检查主要布局、换行、选中样式与滚动，不能证明微信原生控件、胶囊、安全区、键盘、登录权限、请求状态或真实业务成功。
- 关闭该命令即可停止预览。无需安装、迁移或创建测试库。视觉证据与差异见 `docs/资源/验收截图/前端复刻-独立预览/README.md`。
