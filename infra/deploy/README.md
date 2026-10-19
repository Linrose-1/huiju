# 后端与后台部署交接

当前分工：服务器 Agent 部署 API 与管理后台；小程序由用户本地配置服务器 API 地址后编译、上传。仓库不携带本地 `.env`、数据库、上传媒体或账号备份。本文不表示服务器已经部署成功。

## 给服务器 Agent 的提示词

```text
请将会聚项目的后端和管理后台部署到本服务器，供少量指定人员测试。小程序由我本地上传。
仓库：https://github.com/Linrose-1/huiju.git，分支 main。若我另提供提交 SHA，以该 SHA 为部署版本并记录。
先读 AGENTS.md、apps/api/AGENTS.md、apps/admin/AGENTS.md 和 infra/deploy/README.md。
检查系统、现有项目目录和 Git 修改、Node/MySQL/Nginx/进程管理器、端口与磁盘，复用合适设施，不覆盖其他应用、服务器 .env、数据库和上传文件。
可为本项目安装必要运行依赖、构建、配置独立服务和反向代理并启动；有本地修改先报告，不 reset/clean 或强制覆盖。
数据库先核对准确主机、端口、库名和迁移记录；已有数据库及媒体先备份。迁移、首次管理员创建需核实该目标的单独授权，不能默认对未知库执行；等待确认时继续代码拉取与构建。
按本文设置媒体持久目录、后台同源 /api 代理；使用 API 构建产物常驻运行、后台静态构建，不用 dev/watch 交付。
密钥只在服务器安全填写，不写仓库、不在回复输出，不索要聊天粘贴密钥；不用开发示例密码，不调用付费 AI 做冒烟测试。
目前没有域名和备案。先完成可独立进行的服务器部署及本机验证；没有可用 HTTPS 入口时明确报告外部后台登录和小程序联调还缺什么，不绕过安全校验，不将健康检查冒充全部可用。
最后返回部署 SHA、服务状态、后台地址、API 基地址（含 /api/v1）、健康结果、迁移状态、媒体路径、回滚方法及待我处理事项，区分服务器本机通过与外部实测通过。
```

## 运行方式

- Node.js 24，pnpm 12.6.0，按锁文件安装：`corepack pnpm install --frozen-lockfile`。构建需要开发依赖，不要先用 `--prod` 安装；不升级版本。
- 根目录构建：`corepack pnpm --filter @huiju/api build`、`corepack pnpm --filter @huiju/admin build`。
- 根目录启动 API：`corepack pnpm --filter @huiju/api start`。脚本在 `apps/api` 目录运行，读取根 `.env`（若存在），启动 `dist/main.js`。使用进程管理器，固定工作目录与 Node 路径，设置开机启动及日志。
- API 前缀 `/api/v1`，健康 `/api/v1/health`，端口由 `PORT` 指定。API 端口仅向反向代理开放，数据库不对公网开放。
- 后台静态产物 `apps/admin/dist`；SPA 路由回退到 `index.html`，同一站点 `/api/` 原样代理到 API 的 `/api/`，保留 Host／Origin 和 Cookie。Vite 开发代理不会随构建产物部署。配置上传体积和超时；不把 Swagger `/api/docs` 作为公开入口。

## 配置与数据

以根 `.env.example` 为变量清单，服务器独立配置并限制读取权限：

| 变量 | 部署要求 |
| --- | --- |
| `NODE_ENV` | `production` |
| `PORT` | 本项目独立端口 |
| `DATABASE_URL` | 核对准确 MySQL 目标；现有开发基线为 MySQL 8.4 |
| `WECHAT_MINIAPP_APP_ID` | `wx0797ad5030ad418e` |
| `WECHAT_MINIAPP_SECRET` | 用户在服务器安全填写对应账号密钥 |
| `ADMIN_ORIGIN` | 后台实际 HTTPS Origin，仅协议＋主机＋可选端口，无路径、无末尾斜线 |
| `ADMIN_ALLOW_LOCAL_HTTP` | `false`，公网不绕过校验 |
| `LOCAL_AVATAR_DIRECTORY` | 独立、持久、可写的头像绝对路径 |
| `LOCAL_COVER_DIRECTORY` | 独立、持久、可写的封面绝对路径 |
| `LOCAL_CIRCLE_DIRECTORY` | 独立、持久、可写的学友圈图片绝对路径 |
| `AI_*` | 用户已有服务另行配置；未配置则报告 AI 未就绪 |

媒体由业务 API 提供，不将整个上传目录无鉴权公开，避免绕过下架等访问限制。媒体目录不得放在会被替换的发布目录内。`infra/docker/compose.yaml` 为本地 MySQL 配置，包含开发默认密码，不直接用作生产部署配置。

迁移入口：根目录 `corepack pnpm --filter @huiju/api db:migrate`，显式读取根 `.env`。先取得准确目标的授权并核对备份。当前迁移 `0000` 至 `0011`；不用 `db push` 代替，不手工重复已应用迁移。空库初始化包含平台根节点，不重复创建。迁移失败时停止切换应用，不删表或执行猜测的逆向 SQL。

首次管理员使用 `apps/api/scripts/admin-account.mjs` 的交互式 `bootstrap`，参数见 `scripts/README.md`；创建账号是单独数据库写入。密码由操作者在终端隐藏输入，不放命令参数、日志或回复。已有管理员不自动初始化或重置。

## 验收与回滚

1. 核对进程、监听、重启后存活与数据库迁移状态；健康响应不单独证明数据库正常。
2. 核对公开活动和协议接口、后台首页及刷新路由、同源代理、未登录受限接口拒绝访问。不改既有数据，不自动创建演示会员或活动，不触发真实微信授权。
3. 后台真实登录与微信头像／昵称／手机号由授权操作者验证。当前协议仍为开发占位正文，需要正式内容确认；本次为测试部署。
4. 保留前一应用版本、服务配置、迁移前备份并报告恢复步骤。回退应用先核对数据库结构兼容性，不自动恢复数据库覆盖新数据。

服务器返回可用 HTTPS API 基地址后，本地小程序以 `VITE_API_BASE_URL=<该入口>/api/v1`、普通构建模式（`LOCAL_TEST=false`）重新编译。不要把电脑局域网或回环地址带进上传版本。小程序上传、服务器部署、微信外部能力须分别验收。
