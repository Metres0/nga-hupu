# NGA 镜像站 — 完整性能策略与架构白皮书 v2.0

> 最后更新: 2026-05-22 | 涵盖: 缓存 / 加载 / 渲染 / 网络 / DB / 监控
> v2.0 变更: 补充 L1/L2 错开机制 + 骨架屏方案 + 缓存隔离分析 + 架构依赖验证

---

## 目录

1. [架构总览与关键变量](#一架构总览与关键变量)
2. [缓存策略 (L1/L2/L3 错开机制)](#二缓存策略)
3. [零 Spinner + 渐进加载的骨架屏方案](#三零-spinner--渐进加载方案)
4. [渲染策略](#四渲染策略)
5. [网络与 API 策略](#五网络与-api-策略)
6. [数据库策略 (WAL 安全边界)](#六数据库策略)
7. [代码分割与请求合并非冲突设计](#七代码分割与请求合并)
8. [监控与度量](#八监控与度量)
9. [实施路线图 (含依赖验证)](#九实施路线图)

---

## 一、架构总览与关键变量

### 1.1 已验证的架构前提

| 组件 | 实际状态 (代码验证) | 策略依赖 |
|------|---------------------|----------|
| `forum/[fid]/page.tsx` | **已是 Server Component** — `export default async function ForumPage()` | Phase A2 依赖 ✅ |
| `thread/[tid]/page.tsx` | **已是 Server Component** — `export default async function ThreadPage()` | Phase A2 依赖 ✅ |
| `BottomNav.tsx` | **使用 `<a href>` 非 `<Link>`** — 行 58-63 | Phase A1 可修复 ✅ |
| `ForumPageClient.tsx` | SSR 数据仅写入 forum-store，**未写入 cache-store** — 行 52-63 | Phase A2 bug 确认 ✅ |
| `cache-store.ts` | Zustand `"use client"` — **浏览器内存，非全局共享** | 缓存隔离分析见下 |

### 1.2 缓存隔离 — L1 的准确范围

**L1 缓存 (cache-store.ts) 是每个浏览器 Tab 独立的。**

```
Tab A (cache-store)  ←── 不共享 ──→  Tab B (cache-store)
  200 条目              独立实例            200 条目
  5min TTL              各自过期            5min TTL
```

这意味：
- 同一台机器的 3 个 Tab 各自维护独立缓存。不会冲突。
- 用户打开新 Tab 时缓存完全冷启动——不继承已有数据。
- L2 (HTTP Cache-Control) 由浏览器统一管理，**可以跨 Tab 共享**。如果 Service Worker 介入，可进一步统一。

**关键结论**: L1 过期不会影响其他 Tab；但同一 Tab 内 L1/L2 同时过期的风险确实存在。解决方案见第二章。

### 1.3 当前延迟预算 (实际探针数据)

| 阶段 | 实测值 | 说明 |
|------|--------|------|
| TTFB (服务端首字节) | ~20ms | SQLite 命中，`getCachedThreads` with LIMIT |
| SSR HTML 生成 | ~5ms | 50 行 map + JSON 序列化 |
| JS Bundle 下载 | ~150ms | 87.3kB shared (本地 WiFi) |
| React Hydration | ~100ms | 105kB forum page |
| **SSR data → 显示** | ~0ms | ✅ SSR 直出内容 |
| **重复 fetch (bug)** | +200-800ms | ❌ 客户端 cache-store miss → 重新网络请求 |
| **Spinner flash (bug)** | +0ms | ❌ 重复 fetch 设置 loading=true 覆盖 SSR |

**因此修复 Phase A2 (SSR cache-store 写入 + 跳过 fetch) 是最高优先级。**(And I'm now in build mode, so I could implement it.)

### 1.4 架构依赖链

```
Phase A1 (BottomNav Link)
  └── 依赖: 无 (纯前端组件修改, 1 行改动)

Phase A2 (SSR 重复 fetch)
  └── 依赖: forum/page.tsx 和 thread/page.tsx 已是 Server Component ✅
        ForumPageClient 已接收 initialThreads props ✅
        只需在 useEffect#1 中同时写入 cache-store

Phase A3 (console.log gate)
  └── 依赖: 无 (纯服务端改动)
```

---

## 二、缓存策略 — L1/L2 错开 + 穿透防护

### 2.1 问题诊断: L1 与 L2 同步过期

```
当前设计:
  L1 TTL: 5min (300s)
  L2 max-age: 300s (论坛列表)
  
  → L1 和 L2 完全同步过期
  → L1 过期 → 检查 L2 → L2 也过期 → 直接穿透到 L3 (SQLite/网络)
  → 两层缓存形同虚设，任意时刻都只有一层在有效
```

### 2.2 修复方案: 阶梯式 TTL

```
修复后:
  L1 TTL: 5min (300s)         ← 浏览器内存, 快速响应
  L2 max-age: 900s (15min)    ← HTTP 缓存, 长于 L1
  L2 stale-while-revalidate: 600s (10min)  ← 过期后先返回旧数据

流程:
  t=0s:     API 返回, L1 缓存 5min, L2 缓存 15min
  t=3min:   L1 命中 → 返回 ✅
  t=6min:   L1 过期, L2 仍有效 (距过期还有 9min) → 浏览器直接拿 L2 ✅
  t=16min:  L2 也过期了, 但 SWR 窗口内 → 拿 stale 数据 + 后台刷新 ✅
  t=26min:  SWR 窗口也过 → 请求到服务端 → L3 ✅
```

**关键: L2 TTL 应显著大于 L1 TTL (建议 3-5x)。整个页面生命周期中，L1 承担热点，L2 承担冷存储。**

### 2.3 穿透保护表

| 场景 | L1 状态 | L2 状态 | 结果 |
|------|---------|---------|------|
| 刚才过 | 命中 | — | L1 返回 (0ms) |
| 5min 前 | 过期 | 有效 | L2 返回 (~0ms, browser cache) |
| 15min 前 | 过期 | 过期但 SWR | L2 stale 返回 + 后台刷新 |
| 30min+ | 过期 | 完全过期 | L3 SQLite (~20ms) 或 网络抓取 (~3s) |

### 2.4 缓存三层架构 (补齐 SWR)

```
┌──────────────────────────────────────────────────┐
│ L1: 浏览器内存 (Zustand cache-store)               │
│ ├ 容量: 200 条目 (per-tab, 独立实例)               │
│ ├ TTL: 5min                                       │
│ ├ 淘汰: FIFO-LRU                                   │
│ ├ Pin: 订阅板块永久保护                             │
│ └ fix: SSR 数据同时写入, 消除重复 fetch             │
├──────────────────────────────────────────────────┤
│ L2: HTTP 缓存 (Cache-Control)                      │
│ ├ 论坛列表: max-age=900, stale-while-revalidate=600│
│ ├ 论坛列表(新鲜): max-age=120                      │
│ ├ 图片代理: max-age=86400 (1d)                     │
│ └ 共享: 浏览器统一管理, 跨 Tab 共享                │
├──────────────────────────────────────────────────┤
│ L3: SQLite 持久层                                   │
│ ├ WAL 模式 + busy_timeout=5000                    │
│ ├ FTS5: 定时 rebuild (15min)                       │
│ ├ 计划: cache_size=64MB, mmap_size=256MB           │
│ └ 穿透仅当 L1+L2 均完全过期                         │
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

## 三、零 Spinner + 渐进加载的骨架屏方案

### 3.1 问题: "零 Spinner" 与 "渐进加载" 的技术矛盾

```
设定的两个目标互相冲突:
  (a) "零 spinner" — 用户永远看不到加载动画
  (b) "渐进加载 P0-P4" — 低优先级内容延迟加载

冲突:
  如果 P2-P3 的 Client Islands 异步加载时没有 spinner，
  页面会出现:
    ① 局部空白区域 (未 hydrate 的组件不渲染)
    ② 布局抖动 CLS (组件挂载后突然出现, 推动周围内容)
    ③ 交互死区 (按钮存在但 JS 未绑定)
```

### 3.2 解决方案: 分级骨架屏

**原则**: 永远不让用户看到"空"。每个延迟加载的区域都预先占用空间。

```
┌──────────────────────────────────────────────┐
│ P0 (0ms):    HTML 骨架 + CSS + 首屏文本      │  无延迟
│              ├ 帖子标题 + 作者               │
│              └ 导航栏 (SSR 直出)             │
├──────────────────────────────────────────────┤
│ P1 (50ms):   SSR 数据注入 → 帖子列表          │  有数据即渲染
│              ├ 50 条帖子卡片                  │
│              └ 页码导航                       │
├──────────────────────────────────────────────┤
│ P2 (200ms):  图片                             │  骨架: fixed height + aspect-ratio
│              ├ 占位: <div class="h-52         │         + shimmer (淡入动画)
│              │          rounded-xl            │
│              │          bg-[var(--bg-tertiary)]│
│              │          animate-pulse" />     │
│              └ 图片加载后 → fade in 替换      │
├──────────────────────────────────────────────┤
│ P3 (500ms):  Client Islands 异步组件          │  骨架: skeleton placeholder
│              ├ LoginDialog   → <GlassSkeleton │
│              ├ ImageGallery  → 固定高度占位   │
│              └ Sidebar       → SSR 直出(不变) │
├──────────────────────────────────────────────┤
│ P4 (idle):   悬停预取 + 收藏数据              │  骨架: 无 (后台静默) 
│              ├ 帖子详情 prefetch              │
│              └ localStorage 读取              │
└──────────────────────────────────────────────┘
```

### 3.3 骨架屏实现方式

| 组件 | 延迟原因 | 占位方案 |
|------|----------|----------|
| ImageGallery 图片 | lazy loading | `aspect-ratio: 16/9` + `bg-[var(--bg-tertiary)]` + `animate-pulse` |
| ChunkedPostRenderer 长帖 | 内容过长分段 | 已有的 `GlassSkeleton` 组件 (h-48 rounded-2xl) |
| LoginDialog 弹窗 | `next/dynamic({ ssr: false })` | 无占位 (弹窗不存在于初始 DOM) |
| Sidebar 收藏区域 | `/favorites` 页面数据 | 导航到独立页面, 无需在侧边栏渲染 |
| ThreadPageClient 详细内容 | 帖子页 SSR 数据注入 | 与论坛页相同 — SSR 直出, 无 spinner |

### 3.4 CLS 防护 (针对 P2-P3)

```
所有延迟加载区域必须满足:
  ① 固定 min-height (CSS 或 inline style)
  ② aspect-ratio (图片) 或 contain-intrinsic-size (containment)
  ③ 过渡动画使用 opacity + transform (仅 Composite, 不触发 Layout)

已存在的 GlassSkeleton 组件：
  className="h-48 rounded-2xl"  ← 固定高度, 可立即使用
  需补充: animate-pulse 或 skeleton-shimmer

待新增的图片骨架：
  <div class="rounded-xl bg-[var(--bg-tertiary)] animate-pulse"
       style="aspect-ratio: 16/9" />  ← 无 CLS
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
