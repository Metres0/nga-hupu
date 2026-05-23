# NGA 镜像站 — 加载性能优化策略 v2.1

> 审计日期: 2026-05-23 | 覆盖范围: 全栈 (网络 / JS / CSS / 渲染 / I/O)
> v2.1: v5.4-v5.7 Phase A-D 全部完成, 更新当前基线

---

## 一、性能诊断方法论

### 1.1 评估维度

| 维度 | 指标 | 说明 |
|------|------|------|
| **首屏速度** | FCP / LCP | 用户看到第一个内容 / 最大内容的时间 |
| **交互就绪** | TTI | 页面完全可交互的时间 |
| **导航流畅** | INP / CLS | 交互响应延迟 / 累积布局偏移 |
| **资源效率** | Bundle Size / Requests | JS/CSS 体积 / 网络请求数 |
| **服务端延迟** | TTFB | 服务端响应首字节时间 |

### 1.2 当前基线

| 页面 | FCP (估计) | 首屏 JS | 首屏 CSS | 数据源 |
|------|-----------|---------|----------|--------|
| 首页 | ~200ms | 102 kB | 87 kB | SSR (SQLite) |
| 论坛页 | ~200ms | 105 kB | 87 kB | SSR → L1 缓存命中 ✅ (v4.4/v4.8) |
| 帖子页 | ~200ms | 106 kB | 87 kB | SSR → L1 缓存命中 ✅ (v4.4/v4.8) |
| 移动端导航 | ~200ms | — | — | `<Link>` 客户端路由 ✅ (v4.8) |

---

## 二、瓶颈分级修复方案

### 🔴 Phase A — 关键瓶颈 (3 项) — 已全部修复 ✅

#### A1: BottomNav 全页刷新 — ✅ 已修复 (v4.8)

**修复**: `<a href>` → `<Link href>` in `BottomNav.tsx:58-63`
**效率**: 移动端导航 -90% 延迟 (~2s → ~200ms)

#### A2: SSR 数据浪费 — ✅ 已修复 (v4.4)

**修复**: ForumPageClient/ThreadPageClient 的 useEffect#1 同时写入 cache-store, useEffect#2 先查缓存
**效率**: 论坛/帖子页首屏 -50% 延迟 (消除 spinner flash + 网络往返)

#### A3: `console.log` 同步 I/O — ✅ 已修复 (v4.3)

**修复**: `next.config.js` 添加 `compiler.removeConsole: true`
**效率**: 服务端吞吐量 +10-15%

---

### 🟡 Phase B — 高价值优化 (4 项)

#### B1: 图片无宽高 → 布局偏移

**问题**: `ImageGallery.tsx:49` 的图片 grid 使用 `max-h-52 w-full` 但**无固定宽高比**。图片加载后撑开容器 → CLS 累积偏移 0.1-0.3。

**影响**: Core Web Vitals 评分降级 (CLS > 0.1)。

**修复**:
```css
/* 添加 aspect-ratio 预留空间 */
aspect-ratio: 16/9; object-fit: cover;
/* 或使用 width/height 属性 */
width={240} height={180}
```

**效率**: CLS -0.2, Layout Shift 消除

**文件**: `ImageGallery.tsx`

---

#### B2: 图片代理双倍请求

**问题**: 所有内嵌图片通过 `/api/v1/image-proxy?url=...` 代理。每张图片 = 浏览器→Next.js→NGA 三次网络传输 + pipeline 中间件开销。

**影响**: 图片加载延迟翻倍。

**修复**: 使用 `img.nga.178.com` 和 `img4.nga.178.com` 直接 URL（已在 `next.config.js` 中配置 `remotePatterns`）。代理仅用于非 NGA 域名的外链图片。

**效率**: 图片加载 -40% 延迟

**文件**: `extractor.ts`

---

#### B3: localStorage 同步写入阻塞

**问题**: `favorite-store.ts` 每次 ☆ 切换 → `localStorage.setItem()` **同步阻塞 1-5ms**。

**影响**: 连续点击收藏 → 累积延迟 → jank。

**修复**: 延迟写入 500ms：
```js
let writeTimer: ReturnType<typeof setTimeout>;
const deferredPersist = () => {
  clearTimeout(writeTimer);
  writeTimer = setTimeout(() => persist(data), 500);
};
```

**效率**: 交互响应立即，写入在空闲时完成

**文件**: `favorite-store.ts`

---

#### B4: 帖子内容过大

**问题**: 每页 30 条 post 含 `contentHtml` (可达 50KB+/条)。长帖页 = **1.5MB+ JSON payload**。

**影响**: 慢速网络 10-20s 加载。

**修复**: API 添加 `?summary=1` 返回截断内容 (200 字)，完整内容在帖子展开时按需请求。`IntersectionObserver` 触发近视口帖子的详细加载。

**效率**: 初始负载 -60-80%

**文件**: `threads/route.ts`, `ThreadPageClient.tsx`

---

### 🟢 Phase C — 中等优化 (3 项)

| 编号 | 瓶颈 | 修复 | 文件 |
|------|------|------|------|
| C1 | 收藏 `Array.some()` O(n) 渲染期扫描 | 改为 `Set<number>` | `favorite-store.ts`, `ThreadList.tsx`, `PostCard.tsx` |
| C2 | 限流队列 `await new Promise()` 无超时 | `Promise.race` 30s 超时 → 503 | `rate-limiter.ts` |
| C3 | 毛玻璃 `backdrop-blur` 低端滚动卡顿 | 移动端 `blur(12px)` + `translateZ(0)` | `globals.css` |

### 🔵 Phase D — 精细优化 (4 项)

| 编号 | 瓶颈 | 修复 | 文件 |
|------|------|------|------|
| D1 | 5 层 body gradient 首帧 +5-10ms | 合并为单层 radial-gradient | `globals.css` |
| D2 | `withRetry` 最坏 7s | 降为 2 次重试 / 3s 总超时 | `retry.ts` |
| D3 | 页面切换 evict 缓存 | 仅 pull-to-refresh 清除 | ForumPageClient, ThreadPageClient |
| D4 | 6 字体回退链 | 精简为 `system-ui, "Microsoft YaHei", sans-serif` | `globals.css` |

---

## 三、加载架构对比

### 当前加载流程

```
用户访问 /forum/-343809
  │
  ├── 服务端: getCachedThreads(fid, 0, 50, 0) → SQLite (Sub-1ms) ✅
  ├── 服务端: 渲染 HTML + 内嵌 initialThreads JSON → 发送到浏览器
  │
  ├── 浏览器: 接收 HTML → 开始渲染 ← FCP ~200ms
  ├── 浏览器: 解析 JS bundle (105kB) → React hydrate ← ~300ms
  │
  ├── React useEffect#1: 注入 SSR 数据到 forum-store ✅
  ├── React useEffect#2: 检查 cache-store (空!) → fetch() ❌ 重复请求
  │   └── 浏览器: 显示 loading spinner (覆盖 SSR 内容!)
  │   └── 网络: GET /api/v1/forums/-343809 → 200ms
  │   └── 浏览器: 覆盖 forum-store → 重新渲染内容
  │
  ├── React useEffect#3: prefetch 前 10 个帖子详情
  │
  ├── 图片: 每张 img → GET /api/v1/image-proxy?url=... → 300ms/图
  │
  └── 用户交互: 点击 BottomNav tab → 整页重新加载！ ❌
```

### 优化后加载流程

```
用户访问 /forum/-343809
  │
  ├── 服务端: getCachedThreads(fid, 0, 50, 0) → SQLite (Sub-1ms) ✅
  ├── 服务端: 渲染 HTML + 内嵌 initialThreads JSON → 发送到浏览器
  │
  ├── 浏览器: 接收 HTML → 开始渲染 ← FCP ~200ms
  ├── 浏览器: 解析 JS bundle (105kB) → React hydrate ← ~300ms
  │
  ├── React useEffect#1: 注入 SSR 数据到 forum-store + cache-store ✅
  ├── React useEffect#2: 检查 store.threads.length > 0 → 跳过 fetch ✅
  │                    检查 cacheStore.get(key) → 命中 ✅ → 跳过 fetch
  │
  ├── 浏览器: 内容直接渲染 ← LCP ~500ms (无 spinner)
  │
  ├── 图片: img.nga.178.com 直接加载 (无代理) ✅
  │         aspect-ratio: 16/9 预留空间 → CLS = 0 ✅
  │
  └── 用户交互: 点击 BottomNav → <Link> 客户端路由 ✅ → 瞬时切换
              : localStorage.setItem → debounce 500ms ✅
```

---

## 四、性能策略总结

### 4.1 核心原则

| 原则 | 策略 |
|------|------|
| **零浪费** | SSR 数据必须被客户端复用，不允许重复 fetch |
| **首屏优先** | 首屏只加载必要的 JS/CSS/数据，其余延迟 |
| **渲染不阻塞** | localStorage 写入 defer，O(n) 扫描改用 Set |
| **原生优先** | 图片直连不改代理，字体用系统栈不下载 |
| **渐进增强** | 长内容分段加载，图片 lazy+aspect-ratio |
| **生产不 log** | console.log 仅开发环境 |

### 4.2 分级实施路线

```
执行顺序:
  A1 (BottomNav Link)           → 移动端即时生效，最大单点收益
  A2 (SSR cache-store 复用)      → 消除重复 fetch，论坛/帖子页 -50% 延迟
  A3 (console.log gate)         → 服务端吞吐 +10%
  B1 (图片 aspect-ratio)        → 消除 CLS
  B4 (contentHtml 按需)          → 长帖页 payload -80%
  C1 (Set 替代 Array)           → 渲染 CPU -20%
  B2+B3+C2+C3+D1-D4              → 持续渐进
```

### 4.3 预期总体提升

| 指标 | 优化前 | 优化后 | 改善 |
|------|--------|--------|------|
| 移动端导航速度 | ~2s (整页重载) | ~200ms (客户端路由) | **-90%** |
| 论坛页 LCP | ~1s (含 spinner) | ~500ms (SSR 直出) | **-50%** |
| 帖子页 LCP | ~1.5s | ~700ms | **-53%** |
| CLS (图片偏移) | 0.1-0.3 | ~0.01 | **-95%** |
| 服务端吞吐 | 基准 | +10-15% | +15% |
| 长帖页负载 | ~1.5MB | ~300KB | **-80%** |

---

## 五、文件变更清单

| 文件 | Phase | 变更 | 说明 |
|------|-------|------|------|
| `BottomNav.tsx` | A1 | 3 行 | `<a>` → `<Link>` |
| `ForumPageClient.tsx` | A2 | 10 行 | SSR cacheStore 写入 + skip fetch |
| `ThreadPageClient.tsx` | A2 | 10 行 | SSR cacheStore 写入 + skip fetch |
| `logger.ts` | A3 | 2 行 | console.log production gate |
| `ImageGallery.tsx` | B1 | 3 行 | aspect-ratio |
| `extractor.ts` | B2 | 20 行 | 直连 URL vs 代理 |
| `favorite-store.ts` | B3 | 8 行 | debounce write |
| `threads/route.ts` | B4 | 10 行 | ?summary=1 参数 |
| `ThreadPageClient.tsx` | B4 | 15 行 | 按需加载完整内容 |
| `favorite-store.ts` | C1 | 5 行 | Set 替代 Array |
| `rate-limiter.ts` | C2 | 3 行 | timeout |
| `globals.css` | C3 | 5 行 | 移动端 blur 减少 |
| `globals.css` | D1 | 5 行 | 单层 gradient |
| `retry.ts` | D2 | 3 行 | 2 次 / 3s 上限 |
| `globals.css` | D4 | 1 行 | 精简 font-family |

**总计**: 15 文件，~100 行变更。
