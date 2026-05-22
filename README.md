# NGA 镜像站 v4.0 — 马卡龙风格阅读器

基于 FluxDO 架构理念，从 NGA (bbs.nga.cn) 抓取论坛帖子，Material Design 3 马卡龙 UI 呈现。预抓取 + SQLite 缓存，网页加载 <50ms。插件化板块接入，366 全站板块树。

## 技术栈

| 层 | 技术 |
|----|------|
| 前端 | Next.js 14 + React 18 + Tailwind CSS + Zustand |
| 状态管理 | Zustand (4 store: forum/thread/cache/ui) |
| 抓取 | Playwright + Cheerio (withRetry 指数退避) |
| 缓存 | better-sqlite3 + 客户端 LRU (pinned + stale-while-revalidate) |
| 搜索 | SQLite FTS5 全文索引 |
| UI | Material Design 3 + 马卡龙亮色 + 润色液玻璃 (backdrop-blur) |
| 中间件 | 令牌桶限流 + withRetry + 结构化日志 |
| 移动端 | [Flutter/Android 客户端](https://github.com/Metres0/nga-hupu-app) |

## 功能特性

- **马卡龙亮色主题** — 5 色 radial 模糊渐变背景 (薄荷绿/粉/黄/蓝)，暗色一键切换
- **侧边栏订阅** — 直播板块从侧边栏管理，hover 取消订阅
- **2 列网格** — 桌面端论坛列表卡片流 (grid-cols-2)
- **帖子 Footer** — 回复/点赞/分享操作栏
- **回复树着色** — 深度着色卡片 (奶油→紫→蓝→绿→橙)
- **Spoiler 模糊** — `[spoiler]` 标签支持
- **Pangu 排版** — 中英文自动加空格
- **全文搜索** — FTS5 + Ctrl+K 快捷键
- **RSS / SSE** — 订阅输出 + 实时事件流
- **增量抓取** — 仅抓变更 + 定时自动刷新
- **请求调度** — 令牌桶限流 + 指数退避重试 + 优先级队列
- **NGA 账号登录** — XPath 引擎驱动登录 + 验证码识别 + Cookie AES-256-GCM 加密存储
- **自动续期** — 保存凭据后自动检测过期并重登录
- **受限于限制板块** — 晴风村等需登录板块，已登录用户无障碍访问
- **帖子收藏** — ⭐ 帖子/回复收藏，独立管理页面
- **模糊搜索** — FTS5 + LIKE 回退，板块内搜索 + 全局搜索
- **用户主页** — 点击作者名查看发言记录
- **图片增强** — 缩放/左右切换/缩略图/下载/键盘导航

## 注册板块

| 板块 | FID | 状态 |
|------|-----|------|
| 汽车俱乐部 | -343809 | ✅ 公开 |
| 音乐影视 | -576177 | ✅ 公开 |
| 晴风村 | -7955747 | ✅ 可访问 (已登录) |

## NGA 账号登录

项目支持账号登录以访问 NGA 的受限板块（如晴风村）。登录流程基于 Playwright 自动化 + XPath 精确定位。

```
登录流程:
  1. 点击侧边栏 "登录 NGA" → 弹出登录对话框
  2. 输入用户名 + 密码，勾选 "保存凭据用于自动续期"
  3. 如出现验证码 → 输入验证码 → 确认
  4. 登录成功 → 自动获取 NGA Cookie，AES-256-GCM 加密存储
  5. 7 天内自动续期 (凭据存储时启用)
```

管理端点:
| 端点 | 说明 |
|------|------|
| `POST /api/v1/auth/login` | 发起登录 (method: "xpath" \| "legacy", saveCredential: bool) |
| `POST /api/v1/auth/login/verify` | 提交验证码 |
| `POST /api/v1/auth/renew` | 手动触发续期 (需已存凭据) |
| `GET /api/v1/auth/status` | 查询登录状态 + Session 过期时间 |
| `POST /api/v1/auth/logout` | 退出登录 (同时清除 Cookie 和凭据) |

## 快速开始

### 一键启动 (推荐)

```bash
# Windows: 双击 setup.bat (检查环境 + 安装依赖 + 抓取数据)
#          双击 start.bat (启动服务 + 打开浏览器)
#          双击 stop.bat  (停止服务)

# 或命令行:
npm run setup              # 一键环境检查与配置
npm run setup -- --full    # 包含完整数据抓取
npm run start              # 启动服务
npm run stop               # 停止服务
npm run manage status      # 查看运行状态
npm run manage update      # 增量刷新数据
```

### 手动部署

```bash
npm install
npx tsx scripts/scrape-boards.ts   # 解析 NGA 366 板块
npm run scrape-all                   # 抓取所有注册板块数据
npm run build && npm run start      # 启动
# http://localhost:3000
```

### 管理脚本参考

| 命令 | 说明 |
|------|------|
| `setup.bat` / `npm run setup` | 检查安装 Node.js/Chrome/依赖/环境变量 |
| `start.bat` / `npm run start` | 构建并启动生产服务 |
| `stop.bat` / `powershell scripts/manage.ps1 stop` | 停止服务 |
| `npm run manage status` | 查看环境与服务状态 |
| `npm run manage update` | 增量抓取最新帖子 |
| `npm run manage restart` | 重启服务 |
| `npm run manage start -- --dev` | 开发模式 (热重载) |

## 项目结构

```
src/
├── app/                          # Next.js App Router
│   ├── api/v1/
│   │   ├── forums/[fid]/route.ts  # 论坛列表 (pipeline限流+retry)
│   │   ├── threads/[tid]/route.ts # 帖子详情 (pipeline限流+retry)
│   │   ├── image-proxy/route.ts   # 图片代理 (分级缓存)
│   │   ├── search/route.ts        # FTS5 全文搜索
│   │   ├── rss/[fid]/route.ts    # RSS 2.0 订阅
│   │   ├── events/route.ts       # SSE 事件流
│   │   ├── boards/route.ts       # 板块树
│   │   └── health/route.ts       # 健康检查
│   ├── forum/[fid]/page.tsx      # 论坛页 (SSR预填)
│   └── forum/[fid]/thread/[tid]/page.tsx
├── lib/
│   ├── scraper/                   # Playwright 引擎 (4模块拆分)
│   │   ├── engine.ts              # 门面 (withRetry包裹)
│   │   ├── browser.ts             # 浏览器生命周期 (UA轮换池)
│   │   ├── extractor.ts           # Cheerio DOM 提取
│   │   └── parser.ts              # 后处理
│   ├── parser/bbcode.ts           # BBCode→HTML + spoiler/pangu
│   ├── auth/                       # NGA 登录与续期
│   │   ├── login-engine.ts          # XPath引擎 + Legacy后备
│   │   ├── session-store.ts         # Cookie AES加密存储
│   │   ├── credential-store.ts      # 凭据加密存储
│   │   └── auto-renew.ts            # 自动续期
│   ├── cache/db.ts                # SQLite + FTS5 + 自动维护
│   ├── middleware/                # 中间件管道
│   │   ├── pipeline.ts            # compose 入口
│   │   ├── rate-limiter.ts        # 令牌桶 (3并发/1s10req)
│   │   ├── retry.ts               # 指数退避 (3次)
│   │   ├── error-handler.ts       # 类型化错误
│   │   ├── logger.ts              # 结构化日志
│   │   └── cors.ts                # CORS 头
│   ├── search.ts                  # FTS5 搜索
│   ├── reply-tree.ts              # 回复树
│   ├── scroll-restore.ts          # 滚动位置恢复
│   ├── pull-to-refresh.ts         # 下拉刷新
│   ├── read-tracking.ts           # 已读/未读
│   ├── theme.tsx                  # 主题切换 (MD3 light/dark)
│   └── types.ts                   # 数据模型
├── components/
│   ├── ui/                        # GlassCard/Button/Badge/Skeleton/SearchBox/ErrorBoundary/ThemeToggle
│   └── widgets/                   # ThreadList/PostCard/ForumPageClient/ThreadPageClient/GlassNav/BoardExplorer/BoardCard/ImageGallery/Sidebar/BottomNav/BackToTop/ChunkedPostRenderer
├── store/                         # Zustand 状态管理
│   ├── forum-store.ts             # 论坛页状态
│   ├── thread-store.ts            # 帖子详情状态
│   ├── cache-store.ts             # SWR 缓存 (LRU+pinned+stale)
│   └── ui-store.ts                # 订阅/localStorage
└── plugins/                       # 板块插件
    ├── registry.ts
    ├── car-club.ts
    ├── music-film.ts
    └── _template.ts
```

## API

| 端点 | 说明 |
|------|------|
| `GET /api/v1/forums/:fid?page=` | 论坛帖子列表 (pipeline 限流+retry, <50ms) |
| `GET /api/v1/threads/:tid?page=` | 帖子详情 (pipeline 限流+retry, <50ms) |
| `GET /api/v1/image-proxy?url=` | 图片代理 (分级 max-age, 安全头) |
| `GET /api/v1/boards` | 366 板块树 |
| `GET /api/v1/search?q=&fid=&limit=` | FTS5 全文搜索 |
| `GET /api/v1/rss/:fid` | RSS 2.0 订阅 |
| `GET /api/v1/events?fid=` | SSE 事件流 (30s ping) |
| `GET /api/v1/health` | 健康检查 (内存/chrome/限流/日志) |
| `POST /api/v1/auth/login` | NGA 账号登录 (xpath引擎) |
| `POST /api/v1/auth/login/verify` | 登录验证码提交 |
| `GET /api/v1/auth/status` | 登录状态查询 |
| `POST /api/v1/auth/renew` | 手动续期 |
| `POST /api/v1/auth/logout` | 退出登录 |

详见 [`docs/API.md`](docs/API.md) 和 [`docs/AUTH.md`](docs/AUTH.md)。

## 文档

| 文件 | 内容 |
|------|------|
| [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) | 架构设计 |
| [`docs/API.md`](docs/API.md) | API 文档 |
| [`docs/AUTH.md`](docs/AUTH.md) | 登录策略白皮书 |
| [`CHANGELOG.md`](CHANGELOG.md) | 完整版本历史 |
| [`docs/MASTER.md`](docs/MASTER.md) | 多板块接入总览 |
| [`docs/QUICKSTART.md`](docs/QUICKSTART.md) | 快速开始 |
| [`docs/ANDROID.md`](docs/ANDROID.md) | Flutter 移植指南 |
| [`docs/linuxdo设计方案.md`](docs/linuxdo设计方案.md) | FluxDO 深度分析 |
| [`docs/基于linuxdo理念的nga.md`](docs/基于linuxdo理念的nga.md) | 改造方案 |
| [`docs/优化方向.md`](docs/优化方向.md) | 优化路线图 |

## 移动端

[Flutter/Android 液态玻璃客户端 → `Metres0/nga-hupu-app`](https://github.com/Metres0/nga-hupu-app)

## 许可证

NGA 相关数据版权归 bbs.nga.cn 所有。仅供学习交流。
