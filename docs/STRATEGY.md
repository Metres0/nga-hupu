# NGA 镜像站 — 完整性能策略与架构白皮书 v5.7

> 最后更新: 2026-05-23 | 涵盖: 缓存 / 加载 / 渲染 / 网络 / DB / 监控 / 18层防御 / 登录 / 预取
> v5.7: SSR 登录修复 + 单列 + BBCode清理 | v5.0: 完整 R1-V2 防御体系 | v2.0: L1/L2 错开机制

---

## 目录

1. [架构总览与关键变量](#一架构总览与关键变量)
2. [缓存策略 (L1/L2/L3 错开机制)](#二缓存策略)
3. [架构加固: 并发/写入/同步 (v4.4)](#三架构加固)
4. [深水区修复: 索引/锁/事件循环 (v4.5)](#四深水区修复)
5. [边缘防御: 事务锁/进程/锁TTL (v4.6)](#五边缘防御)
6. [零 Spinner + 渐进加载的骨架屏方案](#六零-spinner--渐进加载方案)
7. [渲染策略](#七渲染策略)
8. [网络与 API 策略](#八网络与-api-策略)
9. [数据库策略 (WAL 安全边界)](#九数据库策略)
10. [代码分割与请求合并非冲突设计](#十代码分割与请求合并)
11. [监控与度量](#十一监控与度量)
12. [实施路线图 (含依赖验证)](#十二实施路线图)

---

## 一、架构总览与关键变量

### 1.1 已验证的架构前提

| 组件 | 实际状态 (代码验证) | 策略依赖 |
|------|---------------------|----------|
| `forum/[fid]/page.tsx` | **已是 Server Component** — `export default async function ForumPage()` | Phase A2 依赖 ✅ |
| `thread/[tid]/page.tsx` | **已是 Server Component** — `export default async function ThreadPage()` | Phase A2 依赖 ✅ |
| `BottomNav.tsx` | **已使用 `<Link>` 非 `<a>`** (v4.8 修复) | Phase A1 已修复 ✅ |
| `ForumPageClient.tsx` | SSR 数据仅写入 forum-store，**已同时写入 cache-store** — 行 63 | Phase A2 已修复 ✅ |
| `cache-store.ts` | Zustand `"use client"` — **浏览器内存，非全局共享** | 缓存隔离分析见下 |
| `Sidebar.tsx` | **订阅 localStorage 恢复已覆盖所有路由** — 行 17 (v4.10) | ✅ |

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

### 2.2 修复方案: 阶梯式 TTL (已实施 v4.8)

```
当前状态 (v4.8):
  L1 TTL: 5min (300s)                         ← 浏览器内存, 快速响应
  L2 max-age: 300s (论坛) / 60s (帖子)         ← HTTP 缓存
  L2 stale-while-revalidate: 600s / 300s       ← 🛡️ v4.8 新增
  L2 stale 返回 + 后台刷新, 浏览器原生支持

  L2 穿透 → L3 SQLite (<50ms) 或 按需抓取 (3-5s)
```

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
│ ├ 容量: 500 条目 (per-tab, 独立实例) ← v4.9        │
│ ├ TTL: 5min                                       │
│ ├ 淘汰: FIFO-LRU (pinned 优先保护)                 │
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

| 措施 | v4.7 状态 | v4.8 状态 | 方法 |
|------|----------|----------|------|
| **SSR 注入到 L1** | ✅ SSR 同时写 cache-store | ✅ 保持 | ForumPageClient useEffect#1 |
| **SWR 过期降级** | ✅ L1 stale + 后台刷新 | ✅ L1+L2 双层 SWR | cache-store + Cache-Control SWR |
| **BottomNav 客户端路由** | ❌ `<a>` 全页刷新 | ✅ `<Link>` | BottomNav.tsx |
| **导航缓存保留** | ❌ evictByPrefix("forum") 清全站 | ✅ evictByPrefix("forum:{fid}") 精确清理 | ForumPageClient unmount |
| **预取订阅板块** | ✅ 首页预取前 5 个订阅 | ✅ 保持 | HomeClient useEffect |
| **帖子悬停预取** | ✅ 悬停 200ms 预取详情 | ✅ 保持 | ThreadList hover handler |

### 2.3 缓存键设计

```
thread:{tid}              → 帖子详情
thread:{tid}:{page}       → 帖子分页
forum:{fid}:{page}        → 论坛列表分页
boards:all                → 板块树
search:{query}:{fid}      → 搜索结果
```

---

## 三、架构加固: 并发/写入/同步 (v4.4)

> 基于代码审计发现的 4 项关键风险，以下为已实施的防御措施。

### 3.1 R1: 请求级去重 (Request Deduplication)

**问题**: 令牌桶限流作用于 API 入口 (`rate-limiter.ts`)，而非 Playwright 实例。3 个并发 cache-miss 请求各自通过限流后，会同时启动 3 个 Playwright Page 抓取同一 (tid, page)。

**修复**: `dedupedScrape()` — 进程内 `Map<string, Promise>` 共享机制。

```
修复前:
  3 并发请求 → 3 个 acquireSlot 通过 → 3 个 cache miss
  → 3 个 Playwright Page → 3 个 INSERT → SQLITE_BUSY + NGA 风控

修复后:
  3 并发请求 → 1 个 dedupedScrape → 1 个 Playwright Page
  → 其他 2 个 await 同一 Promise → 1 个 INSERT → 无冲突
```

**涉及文件**:
| 文件 | 变更 |
|------|------|
| `src/lib/cache/db.ts` | 新增 `_scrapeInFlight` Map + `dedupedScrape<T>()` + `getInFlightCount()` |
| `src/app/api/v1/forums/[fid]/route.ts` | cache-miss 分支改用 `dedupedScrape("forum:{fid}:{page}", ...)` |
| `src/app/api/v1/threads/[tid]/route.ts` | cache-miss 分支改用 `dedupedScrape("thread:{tid}:{page}", ...)` |
| `src/app/api/v1/health/route.ts` | 新增 `scrapeDedup.inFlightCount` 监控字段 |

### 3.2 R2: 跨进程写入重试

**问题**: 离线脚本 (`scrape-incremental`) 和在线按需抓取运行于不同进程，共享同一 SQLite 文件。WAL 模式下写操作序列化，`busy_timeout=5000` 到期后 SQLITE_BUSY 直接抛异常。

**修复**: `withWriteRetry()` — SOLITE_BUSY 时指数退避重试。

```
退避策略 (v4.5 增强: 5 次 × 500ms 基数, v4.7 增加初始 jitter):
  initial: 0-200ms 随机 jitter (打破多进程同步竞争)
  attempt 0: 立即执行
  attempt 1: 等待 500ms + random(0-200)ms
  attempt 2: 等待 1000ms + random(0-200)ms
  attempt 3: 等待 2000ms + random(0-200)ms
  attempt 4: 等待 4000ms + random(0-200)ms → 总窗口 ~15.5s
```

**涉及文件**:
| 文件 | 变更 |
|------|------|
| `src/lib/cache/db.ts` | 新增 `withWriteRetry<T>(fn, maxRetries=3)` |
| `src/lib/cache/db.ts` | `cacheThreads()` 包裹进 `withWriteRetry()` |
| `src/lib/cache/db.ts` | `cachePosts()` 包裹进 `withWriteRetry()` |

### 3.3 R3: 抽楼数据清理

**问题**: NGA 帖子存在"抽楼"或"删楼"现象。原 `INSERT OR REPLACE` 只能更新或插入存在的回复，无法删除已被 NGA 移除的楼层。旧数据永久残留于 DB，导致数据不一致。

**修复**: `cachePosts()` 从 `INSERT OR REPLACE` 改为原子 `DELETE + INSERT` 事务。

```
修复前:
  INSERT OR REPLACE INTO posts (...) VALUES (...)
  → 仅更新/插入，不删除旧 pid

修复后:
  transaction {
    DELETE FROM posts WHERE tid = ? AND page = ?
    INSERT INTO posts (...) VALUES (...)
  }
  → 每页写入前先清空该页所有旧数据，零残留
```

**签名变更**: `cachePosts(posts: any[], page: number)` → `cachePosts(posts: any[], tid: number, page: number)`

**涉及文件**:
| 文件 | 变更 |
|------|------|
| `src/lib/cache/db.ts` | `cachePosts` 重写为原子 DELETE+INSERT |
| `src/app/api/v1/threads/[tid]/route.ts` | `cachePosts(result.posts, tid, page)` |
| `scripts/scrape.ts` | `cachePosts(detail.posts, t.tid, p)` |
| `scripts/scrape-all.ts` | `cachePosts(detail.posts, t.tid, p)` |
| `scripts/scrape-incremental.ts` | `cachePosts(detail.posts, t.tid, p)` |

### 3.4 R4: SSR 登录态感知

**问题**: `forum/[fid]/page.tsx` 和 `thread/[tid]/page.tsx` 是 Server Component，使用 `force-dynamic` 每次从 SQLite 读公共缓存数据。完全不感知客户端 Cookie 中的 `ngaPassportUid`，导致:
- 登录用户访问受限板块，SSR 返回空数据或公共缓存
- React hydration 后 `AuthGate` 重新检查 → 内容闪烁/替换

**修复 (方案 A — 轻量)**:
1. SSR 阶段读取 `cookies().get("ngaPassportUid")` 判断登录态
2. 受限板块 + 未登录 → 直接返回 `<AuthGate>` 引导页
3. 已登录 → 正常 SSR 渲染 (数据来自公共缓存或客户端 fetch)

```
修复前:
  SSR: 永远走公共缓存，不感知用户身份
  Client: hydration 后 AuthGate 检查 → 闪烁

修复后:
  SSR: cookies() 判断 → 未登录直接 AuthGate
  Client: 已登录时 hydration 无缝衔接
```

**涉及文件**:
| 文件 | 变更 |
|------|------|
| `src/app/forum/[fid]/page.tsx` | 新增 `cookies()` 读取 + `AuthGate` 条件渲染 |
| `src/app/forum/[fid]/thread/[tid]/page.tsx` | 同上 |
| `src/components/widgets/AuthGate.tsx` | `children` 改为可选，新增 `fid` prop |

### 3.5 修复效果对比矩阵

| 风险 | 修复前 | 修复后 |
|------|--------|--------|
| **R1** 重复抓取 | 3 并发 cache-miss → 3 Playwright | 3 并发 → 1 Playwright, 2 await |
| **R2** 跨进程写冲突 | SQLITE_BUSY 直接抛异常 | 自动重试 3 次 + 随机退避 |
| **R3** 抽楼数据孤儿 | 旧 pid 永久残留 | 每页写入前 DELETE 全页 |
| **R4** SSR 登录态割裂 | 受限板块 SSR 永远空/错数据 | 未登录→AuthGate, 已登录→正常 SSR |

---

## 四、深水区修复: 索引/锁/事件循环/多实例 (v4.5)

> 基于 v4.4 加固后对执行机制细节的进一步审计，发现 4 项深水区风险。

### 4.1 F1: FTS5 全量重建排他锁 vs withWriteRetry 窗口

**问题**: 每 15min 的 `VALUES('rebuild')` 在 50,000+ 行时产生 1.5-3s 排他锁，而 `withWriteRetry` 退避窗口仅 ~900ms，必然耗尽。

**修复**:
1. `rebuildFtsIndex` → `optimizeFtsIndex`: `VALUES('optimize')` 仅合并 B-tree 碎片，共享锁 <100ms
2. `withWriteRetry` 退避窗口延长: 3 次/100ms 基数 → 5 次/500ms 基数 (总窗口 ~15.5s)

```
optimize vs rebuild:
  rebuild:  全量扫描 posts 表, 排他长锁, O(n) 磁盘 I/O
  optimize: 合并 B-tree 碎片, 共享快锁, O(log n) 内存操作
```

### 4.2 F2: dedupedScrape 跨进程边界失效

**问题**: `_scrapeInFlight` Map 在进程堆内，`execSync` 子进程完全隔离。

**修复**: 三层去重体系

```
Layer 1 (进程内): dedupedScrape()     → Map<key, Promise> 共享
Layer 2 (跨进程): scrape_locks 表      → SQLite ON CONFLICT 原子获取
Layer 3 (辅助):   scrape-incremental   → 获取锁失败自动跳过
```

**scrape_locks 表**:
```sql
CREATE TABLE scrape_locks (
  lock_key TEXT PRIMARY KEY,     -- "scrape:{tid}"
  created_at INTEGER NOT NULL    -- 30s TTL 自动过期
);
```

### 4.3 F3: execSync 事件循环阻塞

**问题**: `execSync("npx tsx scripts/scrape-incremental.ts")` 同步阻塞 Node.js 事件循环 30s，期间所有 HTTP 请求挂起、SSE 连接超时断开。

**修复**: `execSync` → `spawn`

```typescript
// 修复前: 同步阻塞
execSync("npx tsx scripts/scrape-incremental.ts", { stdio: "inherit" });

// 修复后: 异步子进程
const child = spawn("npx", ["tsx", "scripts/scrape-incremental.ts"], {
  stdio: "inherit", cwd: process.cwd(),
});
child.on("exit", (code) => { /* 日志 */ });
```

**影响**: 定时刷新期间 → 在线请求 50ms 正常响应, SSE 30s ping 正常。

### 4.4 F4: 多实例定时器膨胀

**问题**: PM2 cluster (4 workers) 每 15min 同时触发 4 个 FTS5 rebuild、4 个 scrape 子进程。

**修复**: `tryAcquireGlobalLock()` 文件锁

```typescript
// 使用 O_CREAT | O_EXCL 原子文件创建
function tryAcquireGlobalLock(name: string): boolean {
  const lockFile = path.join(LOCK_DIR, `${name}.lock`);
  try {
    fs.writeFileSync(lockFile, String(process.pid), { flag: "wx" });
    return true;  // 获取成功
  } catch {
    // 检查僵尸锁: pid 不存在 → 覆盖
    const pid = parseInt(fs.readFileSync(lockFile, "utf-8"));
    try { process.kill(pid, 0); } catch {
      fs.writeFileSync(lockFile, String(process.pid), { flag: "w" });
      return true;
    }
    return false;
  }
}
```

**锁定任务**:
| 锁名 | 保护任务 | 间隔 |
|------|---------|------|
| `db-maintenance` | PRAGMA optimize + optimizeFtsIndex + DB 备份 | 6h/15min/24h |
| `auth-renew` | 自动续期 | 30min |
| `scheduler` | 增量抓取 | 30min |

### 4.5 修复效果对比矩阵

| 风险 | 触发条件 | 修复前 | 修复后 |
|------|---------|--------|--------|
| **F1** FTS5 排他锁 | 每 15min | 1.5-3s 排他锁 → 写入 500 | optimize <100ms + 退避 15.5s |
| **F2** 跨进程去重 | 定时+在线重叠 | 2 Playwright 同时抓同一 tid | 三层去重 → 仅 1 个抓取 |
| **F3** 事件循环阻塞 | 每 30min | 30s 全站不可用 | spawn 异步 → 零影响 |
| **F4** 多实例膨胀 | PM2 cluster | N 倍定时器 + N 倍 Playwright | 文件锁 → 单实例执行 |

---

## 五、边缘防御: SQLite 事务/进程清理/锁 TTL (v4.6)

> 基于 v4.5 深水区修复后，进一步审计 SQLite 底层锁语义和子进程生命周期管理。

### 5.1 E1: BEGIN DEFERRED 读饿死写

**问题**: `database.transaction()` 使用 BEGIN DEFERRED——事务开始时无锁，直到第一条写语句才申请 RESERVED 锁。在高并发悬停预取/后台预取的持续读流下，写操作永远等不到读流清零，即使在 15.5s 退避窗口内也被持续饿死。

**修复**: 手动 `BEGIN IMMEDIATE` — 事务首行立即获取 RESERVED 锁，后续读请求在 RESERVED 持有期间被阻塞。

```
BEGIN DEFERRED (修复前):
  事务开始 → 无锁 → 第一条写才申请 RESERVED
  期间读请求畅通 → 读持续 → 写永远等不到 EXCLUSIVE → 饿死

BEGIN IMMEDIATE (修复后):
  事务开始 → 立即 RESERVED 锁 → 之后的新读被阻塞
  已有读完成 → 写入获得 EXCLUSIVE → 完成 → 锁释放
```

### 5.2 E2: spawn 子进程 Chrome 孤儿

**问题**: 父进程被 SIGKILL 时，`process.on("exit")` 不触发，spawn 子进程变孤儿。子进程内的 Playwright Chrome 实例因 `browser.ts` 的 4 信号清理无法触发而永久残留。

**修复 (四层防护, v4.6+v4.7)**:
1. `detached: false` 显式声明 — 子进程与父进程同进程组
2. `process.kill(-child.pid, "SIGTERM")` — 负 PID 信号覆盖整个进程组 (🛡️ v4.7)
3. `activeChildren` Set 追踪 + `process.on("exit")` 批量进程组杀灭
4. 10 分钟超时看门狗 — 过长运行自动 SIGTERM → 5s 后 SIGKILL

### 5.3 E3: 锁 TTL 固定值 vs 长帖耗时

**问题**: `scrape_locks` 固定 30s TTL。NGA 赛事帖/大建贴可达数百页，每页抓取 3-5s，30s TTL 不足以覆盖 5+ 页的抓取流程。锁提前过期后，其他进程可获取同一 (tid) 的锁，导致两个进程对同一页执行 DELETE+INSERT，数据交织。

**修复**: 锁 TTL 动态计算 — 先算 `totalPages` 后申请锁

```
ttlMs = max(30000, totalPages × 8000)

1 页:   TTL = 30s
2 页:   TTL = 30s
4 页:   TTL = 32s
5 页:   TTL = 40s
```

### 5.4 修复效果对比矩阵

| 风险 | 触发场景 | 修复前 | 修复后 |
|------|---------|--------|--------|
| **E1** 读饿死写 | 高并发悬停预取 | 写事务被无限期饿死 | BEGIN IMMEDIATE 阻断后续读 |
| **E2** Chrome 残留 | 父进程 SIGKILL | Playwright 孤儿进程常驻 | 三层防护 + startup 清理兜底 |
| **E3** 锁 TTL 不足 | 大建帖/赛事帖 | 锁提前过期 → 数据交织 | 动态 TTL 覆盖全页面耗时 |

### 5.5 V1-V2: OS 物理边界防护 (v4.7)

> 审计 SQLite fcntl 锁公平性和子进程组杀灭的 OS 级语义。

**V1 — 写锁公平性**: `withWriteRetry` 在第 0 次尝试前增加 0-200ms 随机 jitter，打破多进程在同一 OS tick 同步进入 `BEGIN IMMEDIATE` 竞争，消除 fcntl 非 FIFO 导致的某个进程持续落选风险。

**V2 — 进程组杀灭**: 所有 `child.kill("SIGTERM")` 改为 `process.kill(-child.pid, "SIGTERM")`。负 PID 语义将信号广播至整个进程组，确保 Playwright 拉起的 Chromium 孙子进程与 Node.js 壳进程一并终止。配合启动时 `taskkill /F /IM chrome.exe` 兜底清理。

---

## 六、零 Spinner + 渐进加载的骨架屏方案

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

## 七、渲染策略

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

## 八、网络与 API 策略

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

## 九、数据库策略

### 6.1 SQLite 配置

| 配置 | 当前值 | 推荐值 | 说明 |
|------|--------|--------|------|
| journal_mode | WAL | WAL | 读写并发 ✅ |
| busy_timeout | 0ms | C 层立即抛出 SQLITE_BUSY, JS 层 withWriteRetry 全权退避 ✅ (v4.9) |
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

## 十、代码分割策略

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

## 十一、监控与度量

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

## 十二、实施路线图

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
