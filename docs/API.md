# NGA 镜像站 API 文档 v4.0

Base URL: `http://localhost:3000`
所有端点均返回 CORS 头 `Access-Control-Allow-Origin: *`

---

## GET /api/v1/forums/:fid

获取论坛帖子列表。

### 参数

| 参数 | 类型 | 默认 | 说明 |
|------|------|------|------|
| `page` | number | 1 | 页码 |
| `refresh` | string | - | `"1"` 强制刷新 |

### 响应

```json
{
  "data": [{ "tid": 46814321, "fid": -343809, "title": "...", "author": "...", "replyCount": 114, ... }],
  "page": 1, "totalPages": 2, "hasMore": true,
  "forum": { "fid": -343809, "name": "汽车俱乐部", "subForums": [] },
  "cached": true
}
```

| 状态 | 说明 |
|------|------|
| 200 | 成功 |
| 429 | 请求频率过快 (pipeline 限流) |
| 500 | 服务错误 |

---

## GET /api/v1/threads/:tid

获取帖子详情。

### 参数

| 参数 | 类型 | 默认 | 说明 |
|------|------|------|------|
| `page` | number | 1 | 帖子页码 |
| `refresh` | string | - | `"1"` 强制刷新 |

### 响应

```json
{
  "thread": { "tid": 46809845, "title": "...", "author": "...", "replyCount": 19, "pageCount": 2 },
  "posts": [{ "pid": 1, "author": "...", "content": "...", "contentHtml": "...", "floor": 0, "images": [], "likes": 0, ... }],
  "totalPages": 2, "cached": true
}
```

| 状态 | 说明 |
|------|------|
| 200 | 成功 |
| 429 | 限流 |
| 500 | 服务错误 |

---

## GET /api/v1/search

全文搜索 (SQLite FTS5)。

### 参数

| 参数 | 类型 | 默认 | 说明 |
|------|------|------|------|
| `q` | string | 必需 | 搜索关键词 |
| `fid` | number | - | 板块过滤 |
| `limit` | number | 20 | 返回数量 (max 50) |
| `offset` | number | 0 | 分页偏移 |

### 响应

```json
{
  "data": [{ "pid": 1, "tid": 46809845, "author": "...", "content": "匹配内容...", "createTime": 1779176520000, "floor": 0 }],
  "query": "关键词",
  "count": 5, "offset": 0
}
```

---

## GET /api/v1/rss/:fid

RSS 2.0 订阅。

### 响应

返回 `Content-Type: application/rss+xml` 的 XML 文档，包含最近 20 条帖子。

`Cache-Control: public, max-age=600`

---

## GET /api/v1/events

Server-Sent Events 实时事件流。

### 参数

| 参数 | 类型 | 默认 | 说明 |
|------|------|------|------|
| `fid` | number | - | 板块过滤 |

### 响应

`Content-Type: text/event-stream`，每 30 秒发送 ping：

```json
{"type":"ping","timestamp":1779261125628,"forumCount":366,"fid":null}
```

---

## GET /api/v1/health

服务器健康检查。

### 响应

```json
{
  "status": "ok",
  "uptime": 3600.5,
  "memory": { "heapUsed": 55, "heapTotal": 84, "rss": 121 },
  "chromeProcesses": 0,
  "rateLimiter": { "activeCount": 0, "windowRequests": 0, "concurrentLimit": 3, "maxPerWindow": 10 },
  "search": { "hits": 0, "misses": 0, "ftsReady": true },
  "recentLogs": [...]
}
```

---

## GET /api/v1/image-proxy

代理 NGA 图片。

### 参数

| 参数 | 类型 | 必需 | 说明 |
|------|------|------|------|
| `url` | string | 是 | 原始图片 URL (encodeURIComponent) |

### 分级缓存策略

| 图片类型 | max-age |
|---------|---------|
| 表情 (`/face/`, `/smile/`) | 30 天 |
| NGA 帖子内嵌 (`img.nga.178.com`) | 7 天 |
| 外部引用 | 3 天 |

响应头：`Cache-Control` / `Content-Length` / `X-Content-Type-Options: nosniff` / `Referrer-Policy: no-referrer` / `Access-Control-Allow-Origin: *`，单图最大 10MB。

| 状态 | 说明 |
|------|------|
| 200 | 成功 |
| 400 | 缺 url 参数 |
| 413 | 图片过大 |
| 502 | 代理失败 |

---

## Authentication API

### POST /api/v1/auth/login

发起 NGA 账号登录 (RSA 引擎)。

| 参数 | 类型 | 默认 | 说明 |
|------|------|------|------|
| `username` | string | - | NGA 用户名 |
| `password` | string | - | NGA 密码 |
| `method` | string | "rsa" | 引擎: rsa/xpath/legacy |
| `saveCredential` | boolean | false | 保存凭据用于自动续期 |

```json
// 需验证码: { "success": false, "captcha": "base64...", "sessionId": "...", "error": "请输入验证码" }
// 成功:     { "success": true, "username": "半城nini" }
// 失败:     { "success": false, "error": "..." }
```

### POST /api/v1/auth/login/verify

提交验证码。空 captcha 可刷新验证码。

```json
// Body: { "sessionId": "login_123", "captcha": "027222" }
```

### GET /api/v1/auth/status

```json
{ "loggedIn": true, "username": "半城nini", "expiresAt": 1779948000000, "expiringSoon": false }
```

### POST /api/v1/auth/renew

手动续期 (需凭据已存储)。

### POST /api/v1/auth/logout

退出登录 + 清除凭据。

---

## GET /api/v1/boards

获取 NGA 全站板块树。

### 响应

```json
{ "forums": [{ "fid": -343809, "name": "汽车俱乐部", "parent_fid": null }], "lastUpdated": 1779261125628, "staleMinutes": 12 }
```
