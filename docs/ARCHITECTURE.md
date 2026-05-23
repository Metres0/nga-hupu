# NGA 镜像站 — 架构文档 v5.8

## 项目概述

基于 FluxDO 架构理念，从 NGA (bbs.nga.cn) 抓取论坛帖子，Material Design 3 马卡龙 UI 呈现。**预抓取 + SQLite + 客户端 LRU** 三层缓存架构，网页加载 <50ms。插件化板块接入，366 全站板块树。三层跨进程防御体系 (8+3 防御层)。

## 数据流

```
┌─────────────────────────────────────────────────┐
│                   CLI 预抓取                      │
│  npm run scrape-all → Playwright → NGA → SQLite  │
│  增量抓取 scrape-incremental (仅抓新帖, ~30s)    │
└───────────────────┬─────────────────────────────┘
                    │
                    ▼
┌─────────────────────────────────────────────────┐
│              API 路由 (pipeline 中间件包裹)       │
│  ├── RateLimiter  (令牌桶: 3并发/1s10req)       │
│  ├── withRetry    (指数退避: 3次 1s/2s/4s)      │
│  ├── error/logger (类型化错误 + JSON日志)        │
│  │                                                │
│  /api/v1/forums/:fid  ← SQLite 读取 <50ms        │
│  /api/v1/threads/:tid  ← SQLite 读取 <50ms        │
│  /api/v1/search         ← FTS5 全文索引          │
│  /api/v1/rss/:fid       ← RSS 2.0 订阅           │
│  /api/v1/events?fid=    ← SSE 事件流             │
│  /api/v1/image-proxy    ← 分级图片代理           │
│                                                    │
│  *缓存未中时自动 Playwright 按需抓取(3-5s)       │
└───────────────────┬─────────────────────────────┘
                    │
                    ▼
┌─────────────────────────────────────────────────┐
│           Next.js 14 前端 (App Router)            │
│  Server Components (SSR 预填数据)                │
│  ├── page.tsx       → 服务端读取板块树            │
│  └── HomeClient.tsx → 客户端订阅预取 + SWR缓存   │
│                                                    │
│  Zustand State Management                        │
│  ├── forum-store   → 论坛页状态                  │
│  ├── thread-store  → 帖子详情状态                 │
│  ├── cache-store   → SWR 客户端缓存               │
│  │   ├── LRU 驱逐 (max 200, pinned 保护)         │
│  │   ├── stale-while-revalidate (过期降级)       │
│  │   ├── autoDispose (页面级释放)                │
│  │   └── 优先级队列 (用户>预取>后台)              │
│  └── ui-store      → 订阅/localStorage           │
│                                                    │
│  Client-side: IntersectionObserver + 悬停预取     │
│  移动端: 底部Tab + 下拉刷新 + 双击返回顶部        │
└─────────────────────────────────────────────────┘
```

## 项目结构

```
src/
├── app/                          # Next.js App Router
│   ├── layout.tsx                # 根布局 (Sidebar + BottomNav + Theme)
│   ├── page.tsx                  # 首页 (Server Component, SSR 预填板块树)
│   ├── HomeClient.tsx            # 首页客户端逻辑 (订阅预取)
│   ├── ClientLayout.tsx          # 客户端 Shell (Sidebar+BottomNav+FAB)
│   ├── error.tsx / not-found.tsx
│   ├── api/v1/
│   │   ├── forums/[fid]/route.ts  # pipeline 包裹 (限流+retry+日志)
│   │   ├── threads/[tid]/route.ts # pipeline 包裹
│   │   ├── search/route.ts       # FTS5 搜索
│   │   ├── rss/[fid]/route.ts   # RSS
│   │   ├── events/route.ts       # SSE
│   │   ├── image-proxy/route.ts  # 图片代理 (分级缓存+安全头)
│   │   ├── boards/route.ts       # 板块树
│   │   └── health/route.ts       # 健康检查
│   └── forum/[fid]/
│       ├── page.tsx              # 论坛页 (SSR)
│       └── thread/[tid]/page.tsx # 帖子页 (SSR)
├── lib/
│   ├── types.ts                  # 数据模型
│   ├── scraper/                  # Playwright 抓取引擎 (4模块)
│   │   ├── engine.ts             # 门面 (withRetry)
│   │   ├── browser.ts            # 浏览器 (UA轮换池+资源拦截)
│   │   ├── extractor.ts          # Cheerio 提取
│   │   └── parser.ts             # 后处理
│   ├── parser/bbcode.ts          # BBCode→HTML (spoiler/pangu/dice)
│   ├── cache/db.ts               # SQLite (forums/threads/posts+FTS5)
│   ├── middleware/               # 中间件管道
│   │   ├── pipeline.ts / rate-limiter.ts / retry.ts
│   │   ├── error-handler.ts / logger.ts / cors.ts
│   ├── search.ts                 # FTS5 搜索
│   ├── reply-tree.ts             # 回复树 (replyTo=0 修正)
│   ├── scroll-restore.ts         # 滚动恢复 (sessionStorage)
│   ├── pull-to-refresh.ts        # 移动端下拉刷新 (touch 事件)
│   ├── read-tracking.ts          # 已读/未读 (localStorage)
│   ├── theme.tsx                 # MD3 主题切换
│   └── nga-cache.ts              # 遗留 (向后兼容)
├── components/
│   ├── ui/                       # GlassCard/Button/Badge/Skeleton/SearchBox
│   │                           /ErrorBoundary/ThemeToggle
│   └── widgets/                  # ThreadList/PostCard/ForumPageClient/ThreadPageClient
│                               /GlassNav/BoardExplorer/BoardCard/ImageGallery
│                               /Sidebar/BottomNav/BackToTop/ChunkedPostRenderer
└── plugins/                      # 板块插件 (car-club, music-film, registry, _template)
```

## 核心技术决策

### 缓存三层架构

| 层 | 技术 | 策略 |
|----|------|------|
| **L1 客户端内存** | Zustand cacheStore | LRU max 200, pinned 保护订阅, SLR 过期降级, autoDispose |
| **L2 服务端 SQLite** | better-sqlite3 WAL 模式 | 预抓取持久化，posts UNIQUE(pid,page)，FTS5 索引 |
| **L3 HTTP 缓存** | Cache-Control 头 | API 30s / Image 分级 (表情30d/帖子7d/外链3d) |

### 为什么用 Zustand 而非 Redux？

- 体积 2KB，零 boilerplate
- 原生 TypeScript 支持，无需 Provider 嵌套
- `getState()` 命令式 API 避免 React useEffect 无限循环

### 为什么中间件管道？

参照 FluxDO Dio 8 层拦截器思想，在 API 路由层构建 Fetch 中间件链：
- 令牌桶限流 (3 并发, 1s/10req) → 保护 NGA 不被封 IP
- 指数退避重试 (3 次: 1s/2s/4s) → 容错网络抖动
- 类型化错误 (RateLimit/Server/Parse/Network) → 统一错误处理
- 结构化日志 (method/url/status/duration) → 可观测性

### 架构加固 (v4.4)

| 机制 | 位置 | 解决风险 |
|------|------|---------|
| **请求去重** | `dedupedScrape()` in `db.ts` | 并发 cache-miss 重复启动 Playwright |
| **写入重试** | `withWriteRetry()` in `db.ts` | 跨进程 SQLITE_BUSY 写冲突 |
| **抽楼清理** | `cachePosts` 原子 DELETE+INSERT | NGA 删楼后旧数据残留 |
| **SSR 登录态** | `cookies()` in SSR pages | 受限板块数据注水冲突 |

### OS 边界防御 (v4.7)

| 机制 | 位置 | 解决风险 |
|------|------|---------|
| **写锁前置 jitter** | `withWriteRetry` initial 0-200ms | fcntl 非 FIFO 长尾饥饿 |
| **进程组杀灭** | `process.kill(-pid, signal)` | Chrome 孙子进程孤儿残留 |

### 边缘防御 (v4.6)

| 机制 | 位置 | 解决风险 |
|------|------|---------|
| **BEGIN IMMEDIATE** | `cacheThreads` / `cachePosts` in `db.ts` | 高并发读饿死写事务 |
| **spawn 超时守护** | `instrumentation.ts` spawn + 10min timeout | Chrome 僵尸进程残留 |
| **锁 TTL 动态化** | `scrape-incremental.ts` ttl = max(30s, pages×8s) | 长帖抓取锁提前过期 |

| 机制 | 位置 | 解决风险 |
|------|------|---------|
| **FTS5 optimize** | `optimizeFtsIndex()` in `db.ts` | 全量 rebuild 排他长锁 → 500 |
| **跨进程锁** | `scrape_locks` 表 + `tryAcquireScrapeLock()` | 子进程绕过 `dedupedScrape` |
| **spawn 异步** | `spawn()` 替代 `execSync()` in `instrumentation.ts` | 事件循环阻塞 30s → 全站不可用 |
| **文件锁单例** | `tryAcquireGlobalLock()` in `instrumentation.ts` | PM2 cluster 多实例定时器膨胀 |
| **退避延长** | `withWriteRetry(5, base=500ms)` | 退避窗口 900ms → 15.5s |

### 图片分级代理

| 类型 | max-age | 说明 |
|------|---------|------|
| 帖子内嵌图 | 7 天 | `/attachments/mon_*` + upload:// |
| 外部引用图 | 3 天 | 非 NGA 域名 |
| 表情 `[smile]` | 30 天 | `/face/`, `/smile/` |
| 头像 | CSS 渐变 (零网络) | 用户名 hash 着色 |

### BBCode 增强

- `[spoiler]` → `filter: blur(6px)` + hover 解除
- `[quote uid=... name=...]` → 带属性引用
- `[@username]` → 提及链接
- `[dice]` / `[tid]` / `[pid]` → 游戏/引用标签
- Pangu 排版 → CJK+Latin 自动加空格
- `[code]` 保护 → 先提取再换行，避免代码块被 `<br/>` 破坏

### 翻页

CLI 按 `replyCount / 20` 计算总页数，最多抓 5 页。posts 表有 `page` 列 + `UNIQUE(pid, page)` 去重 + `INSERT OR REPLACE`。API 按 `tid + page` 过滤，翻页走缓存 <50ms。

### 插件 + 订阅系统

- `ForumConfig` 类型：fid, name, categories (id+name), subForums
- `registry.ts` Map<fid, ForumConfig> 全局注册
- `ui-store.ts` `{fid, name}[]` localStorage 持久化
- 侧边栏动态渲染订阅列表 + hover 取消

### 定时刷新

`instrumentation.ts` 启动时：
1. PRAGMA optimize + WAL checkpoint
2. Chromium 预热
3. setInterval(spawn scrape-incremental.ts) → 独立子进程，OS 自动回收内存
4. 6h PRAGMA optimize + 24h DB 备份 (保留 5 份)

### NGA 账号登录 (RSA 引擎)

系统实现了三层登录引擎，默认使用 RSA 引擎。详见 [`AUTH.md`](./AUTH.md)。

**核心组件**:

| 组件 | 文件 | 职责 |
|------|------|------|
| RSA 引擎 | `lib/auth/login-engine.ts` | RSA 加密 + Playwright 自动化登录 |
| Cookie 存储 | `lib/auth/session-store.ts` | AES-256-GCM 加密持久化 |
| 凭据存储 | `lib/auth/credential-store.ts` | 用户名/密码加密存储 |
| 自动续期 | `lib/auth/auto-renew.ts` | 过期前用存储凭据重新登录 |
| 登录守卫 | `components/widgets/AuthGate.tsx` | 受限板块未登录拦截 |
| 插件的限制 | `plugins/*.ts` | `requiresLogin: true` 标记 |

**API 端点**: `POST /api/v1/auth/login` → `verify` → `renew` → `logout` — 全部 `dynamic`

## 最新更新 (2026-05-23)

- **v5.8**: 交互功能 — 回复(BBCode)+点赞/点踩+收藏NGA原帖链接+GBK编码修复
- **v5.6**: 防御冲突解决 — jitter→retry-only + PRAGMA user_version + 自适应熔断
- **v5.5**: 物理突破 — 批量预取管道 + SWR 指纹比对 + 高楼帖末页预取
- **v5.4**: 极限压榨 — useRef 同步 TTI + 正则快速路径 + Playwright 熔断降级
- **v5.3**: 加载流优化 — 后退修复 + 单写入者 + refresh 穿透
- **v5.2**: 弹性加固 — FTS5 触发器 + Full Jitter + Fast 路径熔断器
- **v5.1**: 抓取快路径 — fetch + Cheerio 替代 Playwright
- **v5.0**: 登录性能 — 超时压缩 + Cookie 快照恢复
- **v4.11**: 登录安全 — 内存 Cookie 缓存 + 续期 jitter
- **v4.9**: 参数收敛 — busy_timeout=0 + LRU 500
- **v4.8**: 加载缓存 — BottomNav Link + L2 SWR + 精确清理
- **v4.7**: OS 边界 — fcntl jitter + 进程组杀灭
- **v4.6**: SQLite 锁语义 — BEGIN IMMEDIATE + 超时守护 + 动态 TTL
- **v4.5**: 深水区修复 — FTS5 optimize + 跨进程锁 + spawn + 多实例锁
- **v4.4**: 架构加固 — 请求去重 + 写入重试 + 抽楼清理 + SSR 登录态
- **v4.3**: 系统性能优化 (DB分页 + FTS5异步 + SSR改造 + 缓存合并 + 代码分割)
- **v4.2**: 收藏系统 + 模糊搜索 + 用户主页 + 图片查看器增强 + 暗色完善 + 排序/热榜
- **v4.1**: NGA 账号登录系统 (RSA引擎 + 验证码 + Cookie持久化 + 自动续期)
- **v4.0**: 马卡龙亮色主题 + PostFooter 操作栏 + 2列网格 + 回复树深度着色
- **v3.x**: MD3 色阶/字体/动效/阴影/波纹 + 液态玻璃 + 订阅侧边栏
- **v2.x**: pipeline 中间件 + UA 轮换 + 分类筛选 + FTS5 + SSR
- **v1.0**: 引擎拆分 + Zustand + ErrorBoundary + 帖子分块渲染
