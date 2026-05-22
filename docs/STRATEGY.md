# NGA 镜像站 — 完整性能策略与架构白皮书 v1.0

> 最后更新: 2026-05-22 | 涵盖: 缓存 / 加载 / 渲染 / 网络 / DB / 监控

---

## 目录

1. [架构总览](#一架构总览)
2. [缓存策略 (3 层)](#二缓存策略)
3. [加载策略 (5 阶段)](#三加载策略)
4. [渲染策略](#四渲染策略)
5. [网络与 API 策略](#五网络与-api-策略)
6. [数据库策略](#六数据库策略)
7. [代码分割策略](#七代码分割策略)
8. [监控与度量](#八监控与度量)
9. [实施路线图](#九实施路线图)

---

## 一、架构总览

```
┌─────────────────────────────────────────────────────────┐
│                    请求生命周期                          │
├─────────────────────────────────────────────────────────┤
│                                                         │
│  浏览器                    Next.js 服务端                │
│  ┌──────┐    HTTP GET     ┌──────────────────┐          │
│  │Client│ ──────────────→ │Server Component   │          │
│  │      │                 │ (SSR)             │          │
│  │      │                 │  ├ getCached*()   │──┐       │
│  │      │                 │  └ render HTML    │  │       │
│  │      │ ←── HTML ────── │                   │  │       │
│  │      │                 └──────────────────┘  │       │
│  │      │                                       ▼       │
│  │      │   hydrate       ┌──────────────────┐  ┌─────┐ │
│  │      │ ──────────────→ │Client Component   │  │SQLite│ │
│  │      │                 │ (SSR data as      │  │     │ │
│  │      │                 │  props → store)   │  │WAL  │ │
│  │      │                 └──────────────────┘  │     │ │
│  │      │                                       └─────┘ │
│  │      │   interaction   ┌──────────────────┐          │
│  │      │ ──────────────→ │API Route          │          │
│  │      │ ←── JSON ────── │ (pipeline)        │          │
│  └──────┘                 └──────────────────┘          │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

### 延迟预算

| 阶段 | 目标 | 当前 |
|------|------|------|
| TTFB (服务端首字节) | < 50ms | ~20ms (SQLite 命中) |
| FCP (首次内容绘制) | < 500ms | ~200ms (SSR) |
| LCP (最大内容绘制) | < 1s | ~800ms (含 spinner flash) |
| TTI (可交互) | < 1.5s | ~1s |
| 客户端导航 | < 200ms | ~200ms (桌面) / ~2s (移动端*有 bug) |
| CLS (布局偏移) | < 0.05 | 0.1-0.3 (图片无宽高) |

---

## 二、缓存策略

### 2.1 三层缓存架构

```
┌──────────────────────────────────────────────────┐
│ L1: 内存缓存 (Zustand cache-store)                 │
│ ├ 容量: 200 条目                                  │
│ ├ TTL: 5 分钟 (计划→15分钟)                       │
│ ├ 淘汰: FIFO-LRU (非严格 LRU)                      │
│ ├ Pin 机制: 订阅板块保护不被淘汰                   │
│ ├ Stats: hits / misses / stale                    │
│ └ 命中时: 立即返回，无网络请求                     │
├──────────────────────────────────────────────────┤
│ L2: HTTP 缓存 (Cache-Control 头)                   │
│ ├ 论坛列表: max-age=300 (5min)                     │
│ ├ 论坛列表 (新鲜): max-age=120 (2min)              │
│ ├ 图片代理: max-age=86400 (1d)                     │
│ └ 计划: 添加 stale-while-revalidate=600            │
├──────────────────────────────────────────────────┤
│ L3: SQLite 持久层 (better-sqlite3)                 │
│ ├ 论坛: 366 板块, 预抓取                           │
│ ├ 帖子: threads + posts 多页                       │
│ ├ FTS5: posts_fts 全文索引                         │
│ ├ WAL 模式: 读写并发                               │
│ ├ PRAGMA optimize: 每 6h                           │
│ └ 计划: cache_size=64MB, mmap_size=256MB           │
└──────────────────────────────────────────────────┘
```

### 2.2 缓存命中率优化

| 措施 | 当前 | 目标 | 方法 |
|------|------|------|------|
| **SSR 注入到 L1** | ❌ SSR 数据不进缓存 | ✅ SSR 同时写 cache-store | ForumPageClient useEffect#1 |
| **SWR 过期降级** | ❌ 无 | ⚡ 过期返回 stale + 后台刷新 | cache-store `stale` 字段已经存在 |
| **预取订阅板块** | ✅ 首页预取前 5 个订阅 | ✅ 保持 | HomeClient useEffect |
| **帖子悬停预取** | ✅ 悬停 200ms 预取详情 | ✅ 保持 | ThreadList hover handler |
| **导航缓存保留** | ❌ 离开页面 evict | ✅ 仅 pull-to-refresh 清除 | 移除 unmount cleanup |

### 2.3 缓存键设计

```
thread:{tid}              → 帖子详情
thread:{tid}:{page}       → 帖子分页
forum:{fid}:{page}        → 论坛列表分页
boards:all                → 板块树
search:{query}:{fid}      → 搜索结果
```

---

## 三、加载策略

### 3.1 首屏加载 — 零 Spinner 原则

**目标**: 用户看到的第一帧就是内容，永远不是 spinner。

```
Phase 1: HTML 交付 (0-20ms)
  ├ 服务端 SSR → 完整 HTML 含内容
  └ 浏览器解析 HTML → FCP

Phase 2: JS 解析 + Hydration (20-300ms)
  ├ 下载并解析 JS bundle
  ├ React hydrate: 复用 SSR DOM
  └ CSSOM 构建完成 → 样式应用

Phase 3: 客户端就绪 (300-500ms)
  ├ Zustand store 初始化
  ├ 事件监听器绑定
  └ 图片渐进加载 (lazy)
```

### 3.2 SSR 数据流 — 当前缺陷与修复

```
当前 (有 bug):
  Server: fetch SQLite → render HTML → 发送
  Client: useEffect#1: SSR data → store ✅
          useEffect#2: cache-store 检查 → miss → 重新 fetch ❌
                       → loading=true → spinner 覆盖 SSR 内容 ❌
          useEffect#3: 预取帖子

修复后:
  Server: fetch SQLite → render HTML → 发送
  Client: useEffect#1: SSR data → store + cache-store ✅
          useEffect#2: store.threads.length>0 → 跳过 fetch ✅
          useEffect#3: 预取帖子
```

### 3.3 渐进加载优先级

| 优先级 | 内容 | 触发时机 |
|--------|------|----------|
| **P0 立即** | HTML 结构 + 首屏 CSS | SSR 直出 |
| **P1 尽快** | 首屏图文内容 | SSR 数据注入 |
| **P2 后台** | 帖子详情预取 | IntersectionObserver + hover |
| **P3 空闲** | 图片加载 | native lazy + aspect-ratio |
| **P4 按需** | 收藏列表 / 用户数据 | 导航到对应页面 |

### 3.4 图片加载策略

```
内嵌内容图 (extractor.ts 注入):
  loading="lazy" decoding="async" + aspect-ratio 预留空间

画廊图 (ImageGallery):
  loading="lazy" + aspect-ratio: 16/9 + object-fit: cover

外链图:
  当前: /api/v1/image-proxy?url=...   (双倍延迟)
  优化: img.nga.178.com 直连 (CORS 已配置)
        image-proxy 仅用于非 NGA 域名
```

---

## 四、渲染策略

### 4.1 组件分层

```
Server Components (无 JS 发送到客户端):
  layout.tsx          → HTML 骨架
  page.tsx            → 首页 SSR 数据
  forum/[fid]/page    → 论坛页 SSR 数据
  thread/[tid]/page   → 帖子页 SSR 数据

Client Components (仅交互部分):
  ClientLayout        → 布局壳
  Sidebar             → 侧边栏 (需交互)
  LoginDialog         → 动态导入 (ssr: false)
  ForumPageClient     → 论坛列表
  ThreadPageClient    → 帖子内容
  ImageGallery        → 动态导入
  ChunkedPostRenderer → 动态导入
  ThemeToggle         → 主题切换
```

### 4.2 CSS 性能

| 措施 | 说明 |
|------|------|
| Tailwind JIT | 仅生成使用的类，~10-15KB minified |
| @layer components | 自定义类放入 layer，tree-shaking |
| 毛玻璃优化 | 移动端 blur(12px) + translateZ(0) GPU 提升 |
| 渐变优化 | 5 层 → 1 层 radial-gradient (减少 Composite) |
| 关键 CSS 内联 | 首屏 Tailwind 指令 `@tailwind base` 已内联 |

### 4.3 渲染优化

| 措施 | 位置 | 说明 |
|------|------|------|
| `Set<number>` 替代 `Array.some()` | favorite-store | 收藏检查 O(1) vs O(n) |
| `content-visibility: auto` | 长帖分块 | CSS containment 延迟渲染 |
| `will-change: transform` | 滚动区域 | 预提升合成层 |
| `useRef` 防止重复 fetch | ForumPageClient | loadedRef 记录已请求 key |

---

## 五、网络与 API 策略

### 5.1 API 响应优化

| 端点 | 当前 | 优化 |
|------|------|------|
| `/forums/:fid` | 11 字段/帖 | 8 字段 (-27%) |
| `/forums/:fid` | max-age=30 | max-age=300 |
| `/threads/:tid` | 全部 contentHtml | ?summary=1 截断 + 按需加载 |
| `/boards` | 全量 forum 表 | 全量 (可接受, 366 行) |
| 所有 API | `console.log` 每次 | 仅 dev 环境 |
| 所有 API | 同步 pipeline | 限流队列化 |

### 5.2 网络请求瀑布 (论坛页)

```
优化前 (7 请求):
  GET /forum/-343809 (HTML)        ← SSR
  GET /_next/static/...js          ← Bundle
  GET /_next/static/...css         ← CSS
  GET /api/v1/forums/-343809       ← ❌ 重复 fetch
  GET /api/v1/image-proxy?url=...  ← 图片1
  GET /api/v1/image-proxy?url=...  ← 图片2
  GET /api/v1/threads/46814321     ← prefetch

优化后 (4 请求):
  GET /forum/-343809 (HTML)        ← SSR (含数据)
  GET /_next/static/...js          ← Bundle
  GET /_next/static/...css         ← CSS
  GET /_next/static/...image       ← 图片 (懒加载 + 直连)
```

### 5.3 限流策略

```
策略: 令牌桶 + 队列等待
  ├ 并发限制: 3 (可配 RATE_LIMIT_MAX_CONCURRENT)
  ├ 窗口限制: 10/秒 (可配 RATE_LIMIT_MAX_PER_WINDOW)
  ├ 超限行为: Promise 等待 (非 429 拒绝)
  └ 待优化: 添加 30s 队列超时 → 503
```

---

## 六、数据库策略

### 6.1 SQLite 配置

| 配置 | 当前值 | 推荐值 | 说明 |
|------|--------|--------|------|
| journal_mode | WAL | WAL | 读写并发 ✅ |
| busy_timeout | 5000ms | 5000ms | ✅ |
| cache_size | 默认 (2MB) | -64000 (64MB) | 提升热数据命中 |
| mmap_size | 无 | 268435456 (256MB) | 内存映射 I/O |
| synchronous | 默认 (FULL) | NORMAL | WAL 下安全且更快 |
| optimize | 每 6h | 保持 | ✅ |

### 6.2 关键查询优化

| 查询 | 当前 | 优化 |
|------|------|------|
| `getCachedThreads` | 全量 `SELECT *` | `LIMIT 50 OFFSET N` ✅ (v4.3) |
| `getCachedThreadCount` | `COUNT(*)` | 新增 ✅ (v4.3) |
| `getAllCachedForums` | `LEFT JOIN COUNT` | 可缓存到内存 (366 行固定) |
| `cachePosts` FTS5 | 每写入 rebuild | 移除, 15min 定时 ✅ (v4.3) |
| `searchPosts` | FTS5 → LIKE fallback | 前缀匹配 + 模糊回退 ✅ (v4.2) |

### 6.3 索引策略

```sql
-- 已有
CREATE INDEX idx_threads_fid ON threads(fid);
CREATE INDEX idx_posts_tid ON posts(tid);
CREATE INDEX idx_posts_tid_page ON posts(tid, page, floor);

-- 建议添加
CREATE INDEX idx_threads_fid_time ON threads(fid, last_reply_time);
-- 加速 ORDER BY last_reply_time + WHERE fid

CREATE INDEX idx_posts_author ON posts(author);
-- 加速作者搜索 (用户主页)
```

---

## 七、代码分割策略

### 7.1 当前分割

| 组件 | 方式 | 大小 |
|------|------|------|
| ImageGallery | `next/dynamic({ ssr: true })` | ~3kB |
| LoginDialog | `next/dynamic({ ssr: false })` | ~8kB |
| ChunkedPostRenderer | `next/dynamic({ ssr: true })` | ~2kB |
| 其余 | 静态导入 | 87.3kB shared |

### 7.2 可进一步分割

| 组件 | 理由 | 预计节省 |
|------|------|----------|
| Sidebar | 非首屏关键，侧边栏可延迟 | ~5kB |
| BoardExplorer | 首页才用，论坛页无需 | ~4kB |
| FavoritesDialog | 极少使用 | ~2kB |

---

## 八、监控与度量

### 8.1 关键指标

```typescript
// 内置: GET /api/v1/health
{
  status: "ok",
  uptime: 3600,          // 运行秒数
  memory: {
    heapUsed: 55,       // MB
    heapTotal: 84,
    rss: 121             // 常驻内存
  },
  chromeProcesses: 0,    // Playwright 孤儿进程
  rateLimiter: {
    activeCount: 0,      // 当前并发
    windowRequests: 0,    // 窗口内请求数
    waitingCount: 0       // 队列等待数
  },
  search: {
    hits: 0,              // 搜索命中
    misses: 0,
    ftsReady: false
  }
}
```

### 8.2 建议添加

| 指标 | 方式 | 用途 |
|------|------|------|
| API P50/P90/P99 | 中间件埋点 | 延迟分布 |
| 缓存命中率 | cache-store stats | 缓存有效性 |
| FCP/LCP/CLS | Web Vitals API | 前端性能 |
| Bundle 大小 | `ANALYZE=true npm run build` | 包体积 |
| DB 查询耗时 | 慢查询日志 (>100ms) | SQL 优化 |

### 8.3 Bundle 分析

```bash
# 生成可视化报告
ANALYZE=true npm run build
# → 浏览器自动打开 treemap
```

---

## 九、实施路线图

### 🔴 Phase A (立即 — 最大收益)

| 序号 | 项目 | 文件 | 收益 |
|------|------|------|------|
| A1 | BottomNav `<a>` → `<Link>` | `BottomNav.tsx` | 移动端 -90% 延迟 |
| A2 | SSR cache-store 写入 + 跳过重复 fetch | `ForumPageClient.tsx`, `ThreadPageClient.tsx` | 论坛/帖子页 -50% LCP |
| A3 | `console.log` production gate | `logger.ts` | 服务端 +10% 吞吐 |

### 🟡 Phase B (本周 — 显著改善)

| 序号 | 项目 | 文件 | 收益 |
|------|------|------|------|
| B1 | 图片 aspect-ratio | `ImageGallery.tsx` | CLS → 0 |
| B2 | 图片直连 vs 代理 | `extractor.ts` | 图片加载 -40% |
| B3 | localStorage debounce | `favorite-store.ts` | 交互无阻塞 |
| B4 | 帖子摘要模式 | `threads/route.ts`, `ThreadPageClient` | 长帖负载 -80% |
| B5 | 导航缓存保留 | ForumPageClient, ThreadPageClient | 返回瞬时 |

### 🟢 Phase C (本月 — 持续优化)

| 序号 | 项目 | 文件 | 收益 |
|------|------|------|------|
| C1 | Set 替代 Array 收藏 | `favorite-store.ts` | 渲染 CPU -20% |
| C2 | 限流队列超时 | `rate-limiter.ts` | 容错 |
| C3 | 毛玻璃移动端优化 | `globals.css` | 滚动帧率 +10fps |
| C4 | DB 索引 + pragma | `db.ts` | 查询 -30% |
| C5 | 服务端 console 精简 | `logger.ts` | I/O -80% |

### 🔵 Phase D (远期 — 架构演进)

| 序号 | 项目 | 说明 |
|------|------|------|
| D1 | ISR 缓存 | `revalidate=60` 静态生成热门页 |
| D2 | WebP 转码 | image-proxy 自动转 WebP |
| D3 | Service Worker | 离线浏览缓存 API |
| D4 | CDN 前置 | 静态资源 CDN 分发 |
| D5 | Docker 部署 | `output: standalone` |
| D6 | E2E 性能测试 | Playwright + Lighthouse CI |

---

## 附录: 相关文档

| 文档 | 内容 |
|------|------|
| `docs/LOADING.md` | 加载速度优化 14 瓶颈详细分析 |
| `docs/PERF.md` | v4.3 系统性能优化已实施报告 |
| `docs/AUTH.md` | 登录策略白皮书 |
| `CHANGELOG.md` | 完整版本历史 |
