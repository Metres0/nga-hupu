# Changelog

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
