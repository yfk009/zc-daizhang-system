# 辫子哥代账系统 · 云端数据留存后端

为纯前端代账系统补上后端：账号登录（JWT）、按人整包数据自动同步、行为日志、文件归档、AI 代理（Key 不下发浏览器）、老板管理端。前端零改动兼容：启动时自动探测 `/api/health`，探到即进入云端模式，探不到照旧单机 localStorage。

## 技术栈与目录

- Node.js ≥ 22.5（用 Node 24 内置 `node:sqlite`，零原生编译依赖）+ Express + jsonwebtoken + bcryptjs + multer
- `index.js` HTTP 路由 ｜ `store.js` 语义化数据访问与落盘（文件按数字 id 存 `<id>.bin`） ｜ `db.js` SQLite 语句 ｜ `ratelimit.js` 登录限速
- 数据库/上传件默认在 `server/data/`、`server/uploads/`（已 gitignore）

## 本地启动

```bash
cd server && npm install
node index.js            # 默认 127.0.0.1:3000，首次启动打印初始管理员账号
# 另开终端：cd zc-system && npx vite preview --port 4655   （/api 已由 vite 代理到 3000）
```

浏览器打开 http://localhost:4655 → 出现登录页即云端模式已生效。

## 接口一览

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | /api/health | 探测（含 AI 配置状态） |
| POST | /api/login | 账号密码登录 → JWT（同账号+IP 10 分钟内错 8 次锁 10 分钟） |
| GET | /api/me | 当前账号信息 |
| POST | /api/logout | 登出（记日志） |
| GET/PUT | /api/data/:scope | 按人按站点整包数据存取（前端用 `_all`）；PUT 自动留最近 10 份历史 |
| POST | /api/logs | 行为埋点 |
| POST/GET | /api/files | 文件上传（≤50MB）/本人文件列表 |
| GET/DELETE | /api/files/:id(/download) | 文件内容（JSON+base64）/删除（本人或 boss） |
| POST | /api/ai/chat | AI 代理：服务器持 Key 转发白名单端点（zhipu/deepseek/tongyi/kimi/doubao/hunyuan/qianfan） |
| GET | /api/admin/overview | （boss）全员各站点数据包总览+摘要 |
| GET | /api/admin/data/:uid/:tenant/:scope | （boss）查看某人整包 |
| GET/POST | /api/admin/history・restore | （boss）历史版本列表/恢复 |
| GET | /api/admin/logs・files | （boss）日志 / 全员文件 |
| GET/POST/DELETE | /api/admin/users… | （boss）账号增删改密（保护最后一名管理员） |

多站点隔离：前端带 `X-Tenant` 头（按域名自动生成：主站/dali/chuxiong/dz-* /local），数据互不混淆；管理端可跨站点查看。

## 生产部署（自有服务器，nginx + PM2）

```bash
# 服务器上（阿里云 47.85.20.92 / 宝塔）
cd /www/wwwroot/daizhang.bianzige.cn/server && npm install --production
pm2 start index.js --name zc-server && pm2 save
# nginx 站点配置追加（静态托管不动）：
#   location /api/ { proxy_pass http://127.0.0.1:3000; proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for; }
```

上线前：`cp server/.env.example server/.env` 配好 `JWT_SECRET` 与 `AI_API_KEY`，启动后立即登录改掉初始管理员密码，并在管理页为员工开账号。
