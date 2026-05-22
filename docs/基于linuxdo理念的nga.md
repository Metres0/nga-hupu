# 基于 Linux.do 架构理念的 NGA 镜像站改造方案

> 参考文档: `docs/linuxdo设计方案.md` (FluxDO v0.2.15 深度源码分析)
> 执行日期: 2026-05-21 | 版本: v4.0 | 最后更新: 2026-05-21

---

## 一、项目概述

### 1.1 改造前

| 维度 | 状态 |
|------|------|
| 架构 | 单体 `engine.ts` (576行) + 组件级 `useState` × 18 |
| 状态管理 | 散落在 4 个组件中，零散 `useState` |
| 缓存 | 客户端裸 `Map` (5min TTL) + SQLite 持久层 |
| 请求控制 | 无调度/限流/重试机制 |
| 错误处理 | 散落的 `try-catch` |
| 抓取策略 | 每次全量 (3-5min)，增量抓取 |
| 搜索 | 无 |
| 测试 | 0 |

### 1.2 改造后

| 维度 | 状态 |
|------|------|
| 架构 | 4 层分离 (scraper / middleware / cache / store) |
| 状态管理 | Zustand 4 store (forum / thread / cache / ui) |
| 缓存 | 3 层 (内存 LRU + SQLite + HTTP Cache-Control) |
| 请求控制 | 令牌桶限流 + 指数退避重试 + 结构化日志 |
| 错误处理 | Error Boundary 组件 + 统一中间件 + `app/error.tsx` |
| 抓取策略 | 增量优先 (~30s) + 全量兜底 + 定时自动刷新 |
| 搜索 | SQLite FTS5 全文索引 + `GET /api/v1/search` |
| 页面展开 | RSS / SSE 事件流 |
| 文件规模 | 新建 22 个 + 修改 8 个核心文件 |

---

## 二、FluxDO 理念映射

| FluxDO 设计范式 | NGA Next.js 落地 | 选择理由 |
|-----------------|------------------|----------|
| Riverpod Providers (autoDispose+family) | Zustand (~2KB) | 无 Provider 嵌套，TypeScript 原生 |
| Dio 8 层拦截器链 | Fetch 中间件 compose() | 纯函数，可测试 |
| UnifiedCacheManager | SQLite + LRU Map + HTTP Cache-Control | 单机无需 Redis |
| SegmentedLongPost 分块渲染 | CSS `content-visibility: auto` + `ChunkedPostRenderer` | 零额外依赖 |
| NavEntry 插件注册 | `ForumConfig` 存量兼容 | 向后兼容 |
| MessageBus Long-Polling | `setInterval` 轻轮询 (SSE) | 内存友好，不常驻连接 |
| PreloadedDataService 冷启动预热 | `instrumentation.ts` Chromium 预热 + API 预解析 | 已打底，增量优化 |
| 自适应请求调度 | 令牌桶 + 滑动窗口（纯函数） | 无外部库 |
| DOH 代理 / Rhttp 多适配器 | N/A (Web 天然 TLS) | 浏览器已内置 |

---

## 三、文件结构全览

```
新建 22 个文件:
  .env.local                                   环境变量配置
  docs/基于linuxdo理念的nga.md                 本方案文档
  src/lib/scraper/browser.ts                 浏览器生命周期 (单例, 空闲5min关闭, 4信号清理)
  src/lib/scraper/extractor.ts               Cheerio DOM 提取 (线程列表/帖子内容/图片属性链)
  src/lib/scraper/parser.ts                  后处理 (replyTo映射, 去重, HTML分块)
  src/store/forum-store.ts                   Zustand: 论坛页状态
  src/store/thread-store.ts                  Zustand: 帖子详情状态
  src/store/cache-store.ts                   Zustand: 客户端 SWR 缓存 (LRU + TTL + 去重)
  src/store/ui-store.ts                      Zustand: 订阅/localStorage 持久化
  src/lib/middleware/pipeline.ts              中间件组合器 compose()
  src/lib/middleware/rate-limiter.ts           令牌桶限流 (3并发, 1s/10req)
  src/lib/middleware/retry.ts                 指数退避 (3次: 1s/2s/4s)
  src/lib/middleware/error-handler.ts          类型化错误 (RateLimit/Server/Parse/Network)
  src/lib/middleware/logger.ts                 结构化日志 (method/url/status/duration)
  src/components/ui/ErrorBoundary.tsx          错误边界 (类组件, 降级UI + 重试)
  src/components/ui/SearchBox.tsx              搜索框 (Ctrl+K 快捷键)
  src/components/widgets/ChunkedPostRenderer.tsx  长帖分块渲染 (>5000字)
  src/app/error.tsx                            Next.js 全局错误页面
  src/app/api/v1/search/route.ts              全文搜索 API
  src/app/api/v1/rss/[fid]/route.ts          RSS 订阅输出
  src/app/api/v1/events/route.ts               SSE 事件流
  scripts/scrape-incremental.ts                增量抓取脚本

修改 8 个核心文件:
  src/lib/scraper/engine.ts                  576行 → 110行门面 (组合 browser/extractor/parser)
  instrumentation.ts                          添加 Chromium 预热 + Chrome 孤儿进程清理 + 定时刷新
  src/app/page.tsx                            接入 uiStore
  src/components/widgets/ForumPageClient.tsx   接入 forumStore + cacheStore
  src/components/widgets/ThreadPageClient.tsx  接入 threadStore + cacheStore (修复无限循环)
  src/components/widgets/PostCard.tsx          接入 ChunkedPostRenderer + ErrorBoundary
  src/components/widgets/BoardExplorer.tsx     接入 uiStore 替代 localStorage
  src/lib/cache/db.ts                         修复 DROP TABLE 关键 BUG + UNIQUE(pid,page) + INSERT OR REPLACE + getThreadPageInfo()
  package.json                                新增 zustand, vitest, testing-library + 6 个 npm scripts
```

---

## 四、核心模块详解

### 4.1 引擎拆分 (`scraper/engine.ts` 576行 → 4 模块)

```
src/lib/scraper/
├── browser.ts      # 浏览器生命周期
│   ├── getBrowser()       单例 + isConnected 检测
│   ├── newPage()          移动端 UA + viewport + navigator.webdriver 覆盖
│   ├── closeBrowser()     清理 idleTimer + browser.close()
│   ├── skipAdIfPresent()  NGA 广告中间页自动跳过
│   └── 进程信号监听        SIGINT/SIGTERM/uncaughtException 自动清理
│
├── extractor.ts     # Cheerio DOM 提取 (纯函数, 可测试)
│   ├── extractThreadList(html, fid)  → { threads, totalPages, forumName, subForums }
│   ├── extractThreadDetail(html, tid, page) → { thread, posts, totalPages }
│   ├── extractImageSrc()            7 层图片属性链降级 (srcorg → data-src → src → data-*/_* 全扫描)
│   ├── isContentImage()            过滤表情 / about:blank / SVG
│   └── parseNgaTime()              相对时间 + 绝对时间解析
│
├── parser.ts        # 后处理 (纯函数, 可测试)
│   ├── resolveReplyTargets()     NGA pid → floor 号映射
│   ├── deduplicatePosts()        按 pid 去重, 保留最长内容
│   └── chunkHtmlForRendering()   >5000 字长帖按 <p>/<div>/<br> 断句
│
└── engine.ts        # 门面 (110行)
    ├── scrapeThreadList()     newPage → goto → skipAd → extractThreadList
    ├── scrapeThreadDetail()   newPage → goto → skipAd → extractThreadDetail → resolveReplyTargets
    ├── scrapeForumInfo()      轻量板块信息
    └── closeBrowser()         委托 browser.closeBrowser
```

### 4.2 请求中间件管道

参照 FluxDO 的 Dio 8 层拦截器思想，在 API 路由层构建 Fetch 中间件链：

```
Request
  │
  ├── acquireSlot()                  令牌桶限流 (3并发, 1s/10req)
  │   └── 超限 → RateLimitError (含 retryAfter)
  │
  ├── withRetry(fn, {3, 1s/2s/4s})   指数退避
  │   └── NetworkError / ServerError 才重试
  │
  ├── classifyError()                统一错误类型
  │   ├── 429 → RateLimitError
  │   ├── 502/503/504 → ServerError
  │   └── 403 → NetworkError
  │
  ├── logRequest()                   结构化日志
  │   └── { timestamp, method, url, status, duration, error }
  │
  └── finally: releaseSlot()
```

文件清单:
- `src/lib/middleware/pipeline.ts` — `pipeline(handler)` 组合入口
- `src/lib/middleware/rate-limiter.ts` — 令牌桶 `acquireSlot()` / `releaseSlot()` / `getStats()`
- `src/lib/middleware/retry.ts` — `withRetry(fn, { maxRetries, baseDelay })`
- `src/lib/middleware/error-handler.ts` — `RateLimitError / ServerError / ParseError / NetworkError` 类型化异常 + `classifyError()`
- `src/lib/middleware/logger.ts` — 循环缓冲区 (100条), `logRequest()` / `getRecentLogs()`

### 4.3 Zustand 状态管理

| Store | 文件 | 状态字段 | 核心 Actions |
|-------|------|---------|-------------|
| `forumStore` | `src/store/forum-store.ts` | threads, page, totalPages, hasMore, forumName, fid, cached, loading, pageLoading, error, activeCategory | setXxx(), reset() |
| `threadStore` | `src/store/thread-store.ts` | thread, posts, totalPages, loading, pageLoading, error | setXxx(), reset() |
| `cacheStore` | `src/store/cache-store.ts` | entries (Map), pendingFetches (Map), ttl, maxEntries | get<T>(), set<T>(), prefetch<T>(), clear(), stats() |
| `uiStore` | `src/store/ui-store.ts` | subscribedFids, loading, hasInitialBoards | toggleSubscribe(), isSubscribed(), loadFromStorage() |

**重要设计决策**:
- 组件 `useEffect` 中使用 `useXxxStore.getState()` 命令式 API 访问 store，**不将 store 对象放入 useEffect 依赖数组**
- 原因: `useXxxStore()` 无 selector 返回整个 state 对象，每次更新引用变化 → 无限循环 (React error #185)
- 配合 `useRef` 防止 StrictMode 双重执行
- 仅在 JSX 渲染中使用 `useXxxStore()` 响应式订阅

### 4.4 统一缓存架构

```
┌──────────────────────────────────────────────┐
│ L1: 内存 LRU (max 200 条目, 5min TTL)        │
│  ├── Zustand cacheStore                       │
│  ├── 自动驱逐 (FIFO-LRU)                      │
│  └── 命中率统计 (hits/misses)                 │
├──────────────────────────────────────────────┤
│ L2: SQLite 持久层 (data/nga-cache.db)         │
│  ├── forums 表 (366 板块, INSERT OR REPLACE)  │
│  ├── threads 表 (帖子元数据, 含 page_count)    │
│  ├── posts 表 (UNIQUE(pid, page), INSERT OR REPLACE) │
│  └── posts_fts FTS5 虚拟表 (全文索引)         │
├──────────────────────────────────────────────┤
│ L3: HTTP 缓存头                               │
│  ├── Cache-Control: public, max-age=30 (API)  │
│  ├── Cache-Control: public, max-age=86400 (Image Proxy) │
│  └── Cache-Control: no-cache (SSE)            │
└──────────────────────────────────────────────┘
```

### 4.5 错误处理体系

| 层级 | 组件 | 职责 |
|------|------|------|
| **全局** | `src/app/error.tsx` | Next.js 路由级错误抓取，显示降级 UI + 重试按钮 |
| **组件** | `ErrorBoundary` (class) | 包裹问题组件，捕获 build 异常，`getDerivedStateFromError` |
| **渲染** | `PostErrorFallback` | 单个帖子渲染失败时显示"内容渲染失败"占位 |
| **API** | `error-handler.ts` | `RateLimitError / ServerError / ParseError / NetworkError` |
| **API** | `pipeline.ts` | 统一 catch → `classifyError()` → JSON `{ error, retryAfter }` |

### 4.6 增量抓取

`scripts/scrape-incremental.ts`:
1. 查询 SQLite 中每个板块的已有 TID 集合
2. 仅抓取 `tid` 不在集合中的新线程
3. 已有线程跳过，仅更新元数据
4. 新线程按标准流程抓取详情 (含多页翻页)
5. 最多抓取 20 个新线程详情 (轻量)

预期: 首次全量 ~5min → 后续增量 ~30s

### 4.7 定时刷新

`instrumentation.ts`:
- 启动时自动 `taskkill` 清理 Chrome 孤儿进程
- 预热 Playwright Chromium 实例
- `ENABLE_AUTO_REFRESH=1` 时启动 `setInterval(intervalMin)` 定时触发增量抓取
- 使用 `child_process.execSync` spawn 独立进程, 不阻塞服务器, 完成后自动释放内存

### 4.8 全文搜索

- SQLite FTS5 虚拟表 `posts_fts` (content 列, content_rowid='id')
- API: `GET /api/v1/search?q=关键词&fid=板块&limit=20&offset=0`
- 前端: `SearchBox` 组件 (Ctrl+K 快捷键, 回车搜索)
- 支持按板块过滤

### 4.9 新功能 API

| 端点 | 方法 | 用途 |
|------|------|------|
| `/api/v1/search?q=&fid=&limit=` | GET | FTS5 全文搜索 |
| `/api/v1/rss/[fid]` | GET | RSS 2.0 XML 订阅 |
| `/api/v1/events?fid=` | GET | SSE 事件流 (30s ping) |
| `/api/v1/health` | GET | 健康检查 (内存/chrome进程/限流器/搜索/日志) |

---

## 五、关键 BUG 修复记录

### BUG 1: 每次服务器重启清空帖子数据 (已修复)

- **位置**: `src/lib/cache/db.ts:58`
- **原因**: `initSchema()` 中 `DROP TABLE IF EXISTS posts` 在每次 `getDb()` 初始化时执行
- **修复**: 改为 `CREATE TABLE IF NOT EXISTS posts`

### BUG 2: 帖子翻页全部消失 (已修复)

- **位置**: `src/app/api/v1/threads/[tid]/route.ts:32`
- **原因**: 缓存命中时 `totalPages: 1` 硬编码
- **修复**: 新增 `getThreadPageInfo(tid)` 函数, 从 posts 表 `COUNT(DISTINCT page)` 读取真实页数

### BUG 3: 重复抓取导致帖子重复 (已修复)

- **位置**: `src/lib/cache/db.ts:134` + posts 表 schema
- **原因**: `INSERT INTO` 无去重, `id AUTOINCREMENT` 每次都成功
- **修复**: 添加 `UNIQUE(pid, page)` 约束 + `INSERT OR REPLACE INTO`

### BUG 4: "返回板块" 按钮整页刷新 (已修复)

- **位置**: `ThreadPageClient.tsx:192`
- **原因**: 原生 `<a href>` 导致浏览器硬刷新 (1-3s)
- **修复**: 改为 Next.js `<Link href>` 客户端路由 (瞬时)

### BUG 5: React Error #185 无限循环 (已修复)

- **位置**: `ThreadPageClient.tsx` + `ForumPageClient.tsx`
- **原因**: `useXxxStore()` 无 selector 在 `useEffect` 依赖数组中, 每次 state 更新引用变化 → 无限循环
- **修复**: 全面使用 `useXxxStore.getState()` 命令式 API, deps 仅含 URL params, 配合 `useRef` 防重复

---

## 六、npm Scripts

```json
{
  "dev": "next dev",
  "build": "next build",
  "start": "next start",
  "lint": "next lint",
  "scrape": "tsx scripts/scrape.ts",
  "scrape-all": "tsx scripts/scrape-all.ts",
  "scrape-boards": "tsx scripts/scrape-boards.ts",
  "scrape-incremental": "tsx scripts/scrape-incremental.ts",
  "test": "vitest run",
  "test:watch": "vitest"
}
```

---

## 七、环境变量 (.env.local)

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `NGA_MOBILE_UA` | `Nga_Official/9.9.9` | 移动端 User-Agent |
| `SCRAPE_MAX_THREAD_PAGES` | 2 | 论坛列表最大翻页数 |
| `SCRAPE_MAX_DETAIL_THREADS` | 100 | 预抓取帖子详情上限 |
| `RATE_LIMIT_MAX_CONCURRENT` | 3 | 最大并发请求 |
| `RATE_LIMIT_WINDOW_MS` | 1000 | 限流窗口 (ms) |
| `RATE_LIMIT_MAX_PER_WINDOW` | 10 | 窗口内最大请求数 |
| `CACHE_TTL_SECONDS` | 300 | 客户端缓存 TTL |
| `CACHE_MAX_ENTRIES` | 200 | LRU 缓存上限 |
| `ENABLE_AUTO_REFRESH` | 0 | 是否启用定时刷新 |
| `REFRESH_INTERVAL_MIN` | 30 | 刷新间隔 (分钟) |
| `IMAGE_PROXY_MAX_AGE` | 86400 | 图片代理缓存 |

---

## 八、数据库 Schema

```sql
-- forums 表
CREATE TABLE IF NOT EXISTS forums (
  fid INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  parent_fid INTEGER,
  updated_at INTEGER NOT NULL
);

-- threads 表
CREATE TABLE IF NOT EXISTS threads (
  tid INTEGER PRIMARY KEY,
  fid INTEGER NOT NULL,
  title TEXT NOT NULL,
  author TEXT NOT NULL,
  author_id INTEGER NOT NULL,
  create_time INTEGER NOT NULL,
  last_reply_time INTEGER NOT NULL,
  reply_count INTEGER NOT NULL DEFAULT 0,
  sticky INTEGER NOT NULL DEFAULT 0,
  digest INTEGER NOT NULL DEFAULT 0,
  categories TEXT DEFAULT '[]',
  page_count INTEGER DEFAULT 1,
  updated_at INTEGER NOT NULL
);

-- posts 表
CREATE TABLE IF NOT EXISTS posts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  pid INTEGER NOT NULL,
  tid INTEGER NOT NULL,
  page INTEGER NOT NULL DEFAULT 1,
  author TEXT NOT NULL,
  author_id INTEGER NOT NULL,
  content TEXT NOT NULL,
  content_html TEXT NOT NULL DEFAULT '',
  create_time INTEGER NOT NULL,
  reply_to INTEGER,
  floor INTEGER NOT NULL,
  images TEXT DEFAULT '[]',
  attachments TEXT DEFAULT '[]',
  likes INTEGER DEFAULT 0,
  UNIQUE(pid, page)
);

-- 全文索引
CREATE VIRTUAL TABLE IF NOT EXISTS posts_fts USING fts5(
  content, content='posts', content_rowid='id'
);
```

---

## 九、移动端 App 兼容性

所有 API 接口结构完全向后兼容 `docs/ANDROID.md` 中的 Flutter 客户端，新增 API 均为可选接入：

| 接口 | 兼容策略 |
|------|---------|
| `GET /api/v1/forums/:fid?page=` | 响应结构不变 |
| `GET /api/v1/threads/:tid?page=` | 响应结构不变, 新增 `totalPages` 准确值 |
| `GET /api/v1/image-proxy?url=` | 响应结构不变 |
| `GET /api/v1/boards` | 响应结构不变 |
| `GET /api/v1/search?q=` | 新增, Flutter 可同步接入 |
| `GET /api/v1/rss/:fid` | 新增, 通用 RSS 客户端 |
| `GET /api/v1/events?fid=` | 新增, Flutter 可 EventSource 接入 |

---

## 十、实施记录

### v4.1 — NGA 账号登录系统 (2026-05-22)

- **RSA 登录引擎**: Playwright + NGA jsencrypt.js 公钥加密 + `_submit()` 直接调用
- **验证码识别**: 手动输入 + Captcha UI 自动截屏 + 刷新/重试机制
- **Cookie 持久化**: AES-256-GCM 加密 → SQLite `auth_sessions` 表
- **自动续期**: 凭据加密存储 → 过期前自动重登录
- **受限板块**: `requiresLogin` 插件标记 + `AuthGate` 守卫组件
- **三级引擎**: RSA (默认) → XPath (iframe) → Legacy (回退)
- **新增板块**: 晴风村 (fid=-7955747)
- **管理脚本**: `manage.ps1` (setup/start/stop/status/update) + `.bat` 快捷方式
- **Bug 修复**: `getKey()` 随机密钥 → 确定性密钥 + `.env.local` `AUTH_ENCRYPT_KEY`

### v4.0 — 马卡龙亮色主题 (2026-05-21)
- 默认 light 马卡龙配色 (薄荷绿/粉/黄/蓝 5层 radial 渐变背景)
- PostCard 24px 圆角 + PostFooter 操作栏 (回复/点赞/分享)
- 回复树卡片深度着色 (奶油→紫→蓝→绿→橙)
- ThreadList 桌面 2 列网格
- 侧边栏浅薄荷绿底色 + 圆形激活态
- FAB "+" 按钮 + 暗色一键切换

### v3.x — FluxDO 设计全面迁移 (2026-05-21)
- v3.0: 前端重新设计 (GitHub 暗色 → MD3 tokens)
- v3.1: 风格温度提升 (阴影层次/渐变头像/毛玻璃)
- v3.2: 侧边栏动态订阅 + 缓存优先 (pinnedKeys + 预加载) + 双击刷新 + 下拉刷新 + Pangu 排版
- v3.3: MD3 完整色阶 + 字体层级 + 动效曲线 + 阴影 elevation + Ripple波纹 + FAB + Spoiler模糊
- v3.4: 液态玻璃增强 (glass-nav/sidebar/card/input/fab) + 首页瘦身

### v2.x — 架构稳定 (2026-05-21)
- v2.0: P0 管道接入 + UA 轮换 + 分类筛选 + 错误提示 + FTS5 优化
- v2.1: P1 SSR 首页 + 404 页面 + BBCode 修复 + 滚动恢复 + 反爬增强
- v2.2: P2 主题切换 + PWA + 已读标记
- v2.3: P3 单元测试 (33/33) + DB 维护 + CORS 头

### v1.0 — 架构地基 (2026-05-20)
- engine.ts 576行→4模块 + Zustand 4 store + ErrorBoundary + 帖子分块渲染 + 增量抓取
