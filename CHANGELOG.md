# Changelog

## v4.11 (2026-05-23) — Login Performance & Security Hardening

### Fixed (5 Login System Risks)

- **P1 登录会话内存泄漏**: 新增 `scheduleLoginTimeout()` — 每个登录会话 5 分钟 TTL 后自动关闭 Playwright ctx。消除用户放弃登录后 Playwright 实例常驻内存的问题
  - `login-engine.ts`: 新增 `LOGIN_TIMEOUT_MS` + `scheduleLoginTimeout()`, 4 个引擎入口均调用
- **P2 高频 Cookie 解密 I/O**: `getDecryptedCookies()` 新增内存缓存 — 1 分钟 TTL + 版本戳校验。消除高并发抓取下每请求 SQLite 读 + AES-GCM 解密的性能瓶颈
  - `session-store.ts`: 新增 `_cachedCookies`/`_cachedSessionId`/`_cacheTime` 模块级缓存
- **P3 自动续期 NGA 风控**: `isExpiringSoon()` 窗口从固定 3h 改为随机 2-5h jitter。避免固定模式被 NGA 识别为自动化刷登录
  - `auto-renew.ts`: `RENEW_JITTER_HOURS` + `Math.floor(Math.random() * 3)`
- **P4 自动续期与抓取竞态**: `createSession()`/`deleteSession()` 主动更新内存缓存。续期后的新 Cookie 通过版本戳 (`_cachedSessionId`) 原子切换，消除旧 Cookie 导致的短暂鉴权失效
  - `session-store.ts`: `createSession`/`deleteSession` 同步更新缓存
- **P5 引擎超时配置化**: `page.goto` 超时从硬编码 20000 改为环境变量 `LOGIN_NAV_TIMEOUT` (默认 15s), `LOGIN_ELEMENT_TIMEOUT` (默认 5s)
  - `login-engine.ts`: 新增 `LOGIN_NAV_TIMEOUT`/`LOGIN_ELEMENT_TIMEOUT` env vars

### Changed

- `login-engine.ts`: +`scheduleLoginTimeout`, +configured timeouts
- `session-store.ts`: +memory cookie cache with session versioning
- `auto-renew.ts`: +random jitter window (2-5h)

---

## v4.10 (2026-05-23) — Sidebar Subscription Fix

### Fixed

- **Sidebar 订阅不显示**: 直接访问帖子页时侧边栏订阅为空。根因: `uiStore.loadFromStorage()` 仅在 `HomeClient.tsx` (首页) 调用。修复: `Sidebar.tsx` 的 `useEffect` 中增加 `useUiStore.getState().loadFromStorage()`，确保所有路由下订阅均从 localStorage 恢复
  - `Sidebar.tsx:17`: +1 行

---

## v4.9 (2026-05-23) — Parameter Convergence

### Fixed (2 Parameter Collision Risks)

- **busy_timeout vs withWriteRetry 互斥**: `busy_timeout` 从 5000 改为 0 — C 层立即抛出 SQLITE_BUSY，JS 层 `withWriteRetry` 全权控制退避。消除 C 层 5s 阻塞导致的线程耗尽
  - `db.ts:21`: `busy_timeout = 0`
- **LRU 容量不足**: `maxEntries` 从 200 改为 500 — 避免多板块多页浏览时频繁淘汰
  - `cache-store.ts:41`: `maxEntries: 500`

### Changed

- `db.ts`: 写入超时策略: C 层零阻塞 + JS 层全权退避 (jitter+5次指数+15.5s窗口)
- `cache-store.ts`: L1 内存缓存容量 200 → 500

---

## v4.8 (2026-05-23) — Loading & Cache Optimization

### Fixed (4 Loading/Caching Defects)

- **D1 BottomNav 全页刷新**: `<a href>` → `<Link href>` — 移动端底部导航从全页重载改为客户端路由，延迟 2s → 200ms
  - `BottomNav.tsx`: 新增 `import Link from "next/link"`, `61行 <a>` → `<Link>`
- **D2 缓存过度清理**: `evictByPrefix("forum")` → `evictByPrefix("forum:{fid}")` — 切换板块时仅清除当前板块缓存，保留已访问板块的缓存数据
  - `ForumPageClient.tsx:117`: 精确前缀匹配
- **D3 L2 SWR 启用**: API 响应增加 `stale-while-revalidate` 指令 — 浏览器原生 SWR 与 L1 SWR 形成双层过期降级
  - `forums/route.ts`: `max-age=300, stale-while-revalidate=600`
  - `threads/route.ts`: `max-age=60, stale-while-revalidate=300`
- **D6 死代码清理**: `cache-store.ts` prefetch 中未使用的 `AbortController` 已移除

### Changed

- `BottomNav.tsx`: `<a>` → `<Link>` (移动端导航 -90% 延迟)
- `ForumPageClient.tsx`: unmount 清理精确化
- `forums/route.ts`: Cache-Control 增加 SWR
- `threads/route.ts`: Cache-Control 增加 SWR
- `cache-store.ts`: 移除死代码 AbortController

---

## v4.7 (2026-05-23) — OS Boundary Hardening

### Fixed (2 OS-Level Boundary Risks)

- **V1 写锁公平性**: `withWriteRetry` 新增事务前初始随机 jitter (0-200ms) — 多进程不再在同一 OS tick 同步进入 `BEGIN IMMEDIATE` 竞争，消除 fcntl 非 FIFO 导致的长尾饥饿
- **V2 进程组杀灭**: 所有 `child.kill()` 改为 `process.kill(-child.pid)` — 负 PID 信号覆盖整个进程组，确保 Playwright 拉起的 Chrome 孙子进程一并终止

### Changed

- `db.ts`: `withWriteRetry` 首行增加 `initialJitter` busy-wait
- `instrumentation.ts`: 4 处 `child.kill("SIGTERM/SIGKILL")` → `process.kill(-child.pid, "SIGTERM/SIGKILL")`

---

## v4.6 (2026-05-23) — Edge-Case Hardening

### Fixed (3 Edge Risks)

- **E1 读饿死写**: `cacheThreads` / `cachePosts` 从 `database.transaction()` (BEGIN DEFERRED) 改为手动 `BEGIN IMMEDIATE` — 事务启动时立即获取 RESERVED 锁，阻止新读请求接入，消除高并发预取下写事务被持续饿死的风险
  - `db.ts`: 移除 `database.transaction()` 包装，换为显式 `BEGIN IMMEDIATE`/`COMMIT`/`ROLLBACK`
- **E2 Chrome 僵尸残留**: `spawn` 增加 10 分钟超时看门狗 + 父进程 `exit` 事件清理 + `detached: false` 显式声明
  - `instrumentation.ts`: `activeChildren` Set 追踪 + `process.on("exit")` 批量 SIGTERM
- **E3 长帖锁 TTL 不足**: `tryAcquireScrapeLock` ttl 从固定 30s 改为动态 `max(30000, totalPages × 8000)`
  - `scrape-incremental.ts`: 先计算 totalPages 再申请锁，大建贴/赛事帖不超时

### Changed

- `db.ts`: `cacheThreads` 和 `cachePosts` 写入事务改为 BEGIN IMMEDIATE
- `instrumentation.ts`: `spawn` 增加超时 + 父进程清理 + `detached: false`
- `scrape-incremental.ts`: 锁 TTL 计算前置并动态化

---

## v4.5 (2026-05-23) — Deep Water Mitigation

### Fixed (4 Deep-Water Risks)

- **F1 FTS5 排他锁**: 定时任务从 `VALUES('rebuild')` 改为 `VALUES('optimize')` — 共享锁 <100ms 替代排他锁 1-3s。`withWriteRetry` 退避窗口从 ~900ms 延长到 ~15.5s (5 次 × 500ms 基数)
  - `db.ts`: 新增 `optimizeFtsIndex()`, `withWriteRetry` 改为 5 次/500ms
  - `instrumentation.ts`: 定时任务调用 `optimizeFtsIndex()` 替代 `rebuildFtsIndex()`
- **F2 跨进程去重失效**: 新增 `scrape_locks` SQLite 表作为跨进程原子锁，与进程内 `dedupedScrape` 组成三层去重体系
  - `db.ts`: 新增 `scrape_locks` 表 + `tryAcquireScrapeLock()` / `releaseScrapeLock()`
  - `scrape-incremental.ts`: 抓取前获取锁 + 完成后释放，已被其他进程抓取的 tid 自动跳过
- **F3 execSync 事件循环阻塞**: 定时抓取从 `execSync` 改为 `spawn` — 子进程异步运行，事件循环零阻塞
  - `instrumentation.ts`: 移除 2 处 `execSync("npx tsx ...")`，改用 `spawn("npx", ["tsx", "..."])`
- **F4 多实例定时器膨胀**: 新增 `tryAcquireGlobalLock()` 文件锁 — PM2 cluster/Docker 多副本部署时定时任务仅单实例执行
  - `instrumentation.ts`: 所有 `setInterval` 包裹在 `tryAcquireGlobalLock()` 中，僵尸锁自动回收

### Changed

- `instrumentation.ts`: 重构为文件锁守护 + 异步子进程
- `scrape-incremental.ts`: 抓取循环增加跨进程锁保护

---

## v4.4 (2026-05-23) — Architecture Hardening

### Fixed (4 Critical Risks)

- **R1 请求级去重**: 新增 `dedupedScrape()` — 同一 key 的并发 cache-miss 请求共享单个 Playwright 实例，消除 3→1 重复抓取风暴
  - `src/lib/cache/db.ts` 新增 `_scrapeInFlight` Map + `dedupedScrape()` + `getInFlightCount()`
  - `forums/route.ts` / `threads/route.ts` cache-miss 分支改用 `dedupedScrape()`
  - `health/route.ts` 新增 `scrapeDedup.inFlightCount` 监控字段
- **R2 跨进程写入重试**: 新增 `withWriteRetry()` — SQLITE_BUSY 时指数退避重试 (3 次, 100ms→200ms→400ms + 随机抖动)
  - `cacheThreads()` / `cachePosts()` 均包裹进 `withWriteRetry()`
- **R3 抽楼数据清理**: `cachePosts` 从 `INSERT OR REPLACE` 改为原子 `DELETE + INSERT` 事务，每次写入前清空该 (tid, page) 所有旧数据
  - 签名变更: `cachePosts(posts, page)` → `cachePosts(posts, tid, page)`
  - 4 个调用点同步更新 (threads/route + 3 scripts)
- **R4 SSR 登录态感知**: `forum/[fid]/page.tsx` 和 `thread/[tid]/page.tsx` 新增 Cookie 检测
  - 受限板块 + 未登录 → SSR 直接返回 `AuthGate` 引导页，避免数据注水冲突
  - `AuthGate` 组件 `children` 改为可选，新增 `fid` prop

### Changed

- `AuthGate.tsx`: `children` prop 改为可选，新增 `fid` prop 用于 SSR 无子节点模式

---

## v4.3 (2026-05-22) — Performance Optimization

### Optimized

- **DB Pagination**: `getCachedThreads` now uses `LIMIT ? OFFSET ?` — eliminates loading all rows into memory
- **FTS5 Rebuild**: Moved from per-write `cachePosts()` to 15-min periodic `instrumentation.ts` job
- **SSR**: `forum/[fid]/page.tsx` and `thread/[tid]/page.tsx` converted to Server Components with server-side data fetching — zero loading spinner on first visit
- **API Slimdown**: Removed redundant fields (`fid`, `authorId`, `categories`) from forum list response
- **Double Cache Merge**: Deleted `nga-cache.ts`, consolidated into `cache-store.ts`
- **Image Lazy Loading**: All content `<img>` tags now inject `loading="lazy" decoding="async"`
- **Dynamic Imports**: `ImageGallery`, `LoginDialog`, `ChunkedPostRenderer` now code-split via `next/dynamic`
- **Rate Limiter Queue**: Replaced immediate 429 rejection with Promise-based waiting queue
- **CSS Layers**: Custom classes wrapped in `@layer components` for Tailwind tree-shaking
- **Build**: `target: es2022`, `removeConsole: true`, `@next/bundle-analyzer` integration
- **Cache-Control**: `max-age=30` → `300` for forum lists

### Bundle Improvements

| Page | Before | After |
|------|--------|-------|
| Forum page | 107 kB | 105 kB |
| Thread page | 107 kB | 106 kB |

---

## v4.2 (2026-05-22) — Feature Expansion

### Added

- **收藏系统**: 帖子/回复收藏（⭐ SVG 心形图标），独立管理页面 `/favorites`
- **模糊搜索**: FTS5 前缀匹配 + LIKE 模糊回退，支持板块内搜索
- **用户主页**: `/user/[author]` 路由，点击作者名查看发言列表
- **首页搜索框**: HomeClient 顶部搜索输入 → 回车跳 `/search`
- **帖子内搜索**: 按作者/内容/楼层筛选当前帖
- **图片查看器增强**: 缩放（F键）、左右箭头导航、缩略图条、下载按钮、键盘快捷键
- **帖子排序**: 最新回复/最新发帖/最多回复三档切换
- **板块热榜**: 🔥 首页按 threadCount 降序展示 TOP 10
- **暗色主题完善**: card-tint 彩色化、AuthGate/LoginDialog 黑暗适配、system 模式
- **刷新按钮**: 论坛页/帖子页手动刷新 + 上次刷新时间

### Changed

- 帖子收藏图标从文本 ☆/★ 改为 SVG ♥，移到 PostFooter 操作栏
- 侧边栏收藏改为链接入口 → 独立 `/favorites` 页面
- 登录引擎默认 method 改为 `rsa`

### Fixed

- `session-store.ts` `getKey()` 随机密钥 → 确定密钥（`AUTH_ENCRYPT_KEY`）
- `login-engine.ts` 密码双重加密 → 单层（NGA JS `_encrypt()` 自动加密）
- `account_copy.html` JS 崩溃 → 切换到 `nuke.php` iframe 方案

---

## v4.1 (2026-05-22) — Authentication System

### Added

- **NGA 账号登录**: RSA 引擎 (L1) + XPath 引擎 (L2) + Legacy 引擎 (L3)
- **验证码识别**: 手动输入 + 自动截图 + 刷新机制
- **Cookie 持久化**: AES-256-GCM 加密 → SQLite `auth_sessions`
- **自动续期**: 凭据加密存储 → 过期前自动重登录
- **受限板块**: `requiresLogin` 插件标记 + `AuthGate` 守卫
- **晴风村插件**: fid=-7955747，需登录访问
- **窗口管理脚本**: `manage.ps1` (setup/start/stop/status/update) + `.bat` 快捷方式

### Changed

- `session-store.ts` 支持 `renewSessions()` 真正自动续期
- `auth-store.ts` 新增 `expiresAt`/`expiringSoon`/`hasCredential` 字段

---

## v4.0 (2026-05-21) — Macaron UI

### Added

- 马卡龙亮色主题 (5 色 radial 渐变背景)
- 液态玻璃 UI (backdrop-blur)
- Material Design 3 色阶/字体/动效/阴影/波纹
- 2 列网格桌面端帖子卡片
- 侧边栏订阅管理 (hover 取消)
- 回复树深度着色
- PostFooter 操作栏 (回复/点赞/分享)
- Spoiler 模糊 + Pangu 排版
- 暗色一键切换

---

## v3.x (2026-05-21) — FluxDO Migration

- Zustand 4 store (forum/thread/cache/ui)
- 引擎拆分 (browser/extractor/parser/engine)
- 中间件管道 (rate-limiter/retry/error-handler/logger/cors)
- FTS5 全文搜索
- SSR 首页
- PWA 离线支持
- 已读/未读追踪

---

## v1.x–v2.x (2026-05-20) — Foundation

- Playwright + Cheerio 抓取引擎
- SQLite 缓存
- BBCode 解析器
- 基本论坛/帖子 UI
- 单元测试 (33/33)

---

## 防御体系演化

```
v4.4 架构加固 ──────→  D1-D4 (进程内防御层)
v4.5 深水区修复 ────→  F1-F4 (进程间防御层)
v4.6 边缘防御 ──────→  E1-E3 (SQLite 锁语义层)
v4.7 OS 边界 ───────→  V1-V2 (操作系统物理层)

总计: 13 层防御, 消除 13 项架构风险
```
