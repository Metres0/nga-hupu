# NGA 镜像站 — 多板块接入总览 v4.0

## 项目现状

| 维度 | 状态 |
|------|------|
| **当前板块** | 汽车俱乐部 (fid=-343809) + 音乐影视 (fid=-576177) |
| **论坛列表** | ~160 帖双板块，SQLite 缓存 <50ms |
| **帖子详情** | 170+ 线程全量预抓取（含多页翻页） |
| **性能** | SSR 首页直出 <100ms，客户端导航 <50ms |
| **UI** | Material Design 3 马卡龙亮色 + 暗色一键切换 |
| **订阅** | 侧边栏管理 + localStorage 持久化 |
| **搜索** | SQLite FTS5 全文索引 + Ctrl+K 快捷键 |
| **缓存** | 3 层 (Zustand LRU pinned + SQLite + HTTP) |
| **中间件** | pipeline 令牌桶限流 + withRetry 退避重试 |
| **移动端 UA** | `Nga_Official/9.9.9` 绕过 NGA 访客限制 |
| **图片** | 全部经 `/api/v1/image-proxy` 代理，防防盗链 |
| **UI** | 液态玻璃 (Frosted Glass)，Tailwind CSS |

## 架构全景图

```
┌──────────────────────────────────────────────────────────┐
│                     CLI 预抓取层                           │
│  npm run scrape → Playwright + Chrome                     │
│  → NGA 移动端 (Nga_Official UA)                           │
│  → Cheerio HTML 解析                                      │
│  → BBCode → HTML 转换 + 图片代理                          │
│  → SQLite (data/nga-cache.db)                             │
└────────────────────────────┬─────────────────────────────┘
                             │
                             ▼
┌──────────────────────────────────────────────────────────┐
│                    API 网关层                              │
│  GET /api/v1/forums/:fid      → SQLite 读取 (<50ms)      │
│  GET /api/v1/threads/:tid     → SQLite 读取 (<50ms)      │
│  GET /api/v1/image-proxy      → 代理 NGA 图片 (带Referer) │
│  缓存未命中时自动 Playwright 按需抓取 (3-5s 兜底)        │
└────────────────────────────┬─────────────────────────────┘
                             │
                             ▼
┌──────────────────────────────────────────────────────────┐
│                   前端 (Next.js 14)                        │
│  /                          → 首页 (板块列表)              │
│  /forum/:fid                → 论坛帖子列表 (可翻页)        │
│  /forum/:fid/thread/:tid    → 帖子详情 (回复树+分页)      │
│                                                             │
│  预加载: SWR 客户端缓存 + 悬停预取 + 顺序预取前10帖       │
│  导航: next/link 客户端路由，View Transition 动画          │
│  回复树: buildReplyTree + flattenTree，层级缩进渲染        │
└──────────────────────────────────────────────────────────┘
```

## 多板块接入（5 步）

### 第 1 步：找到目标板块 FID

打开 NGA 目标板块网页，URL 中的 `fid` 参数即为板块 ID：

```
https://bbs.nga.cn/thread.php?fid=-343809
                                   ↑
                                  FID
```

| 常见板块 | FID |
|---------|-----|
| 汽车俱乐部 | -343809 |
| 大漩涡 | -7 |
| 魔兽世界 | 7 |
| IT数码 | -57450 |

### 第 2 步：创建插件文件

```typescript
// src/plugins/your-forum.ts
import type { ForumConfig } from "@/lib/types";
import { registerPlugin } from "./registry";

const plugin: ForumConfig = {
  fid: -57450,                  // 目标板块 FID
  name: "IT数码",
  baseUrl: "https://bbs.nga.cn/thread.php?fid=-57450",
  categories: [
    { id: "all", name: "全部" },
    { id: "news", name: "业界新闻" },
    { id: "diy", name: "装机配置" },
  ],
  subForums: [],
};

registerPlugin(plugin);
```

### 第 3 步：注册到布局

```typescript
// src/app/layout.tsx
import "@/plugins/car-club";       // 已有
import "@/plugins/your-forum";     // 新增
```

### 第 4 步：配置 CLI 抓取脚本

```typescript
// scripts/scrape.ts
const FID = -57450;                    // 改为目标 FID
const MAX_THREAD_PAGES = 2;            // 论坛列表页数
const MAX_DETAIL_THREADS = 100;        // 预抓取帖子数
```

也可创建多板块批量抓取：

```typescript
// scripts/scrape-all.ts
const FORUMS = [
  { fid: -343809, name: "汽车俱乐部" },
  { fid: -57450,  name: "IT数码" },
  { fid: -7,      name: "大漩涡" },
];

for (const forum of FORUMS) {
  console.log(`\n=== 抓取: ${forum.name} ===`);
  await scrapeForum(forum.fid);
}
```

### 第 5 步：运行预抓取

```bash
npm run scrape        # 单板块
# 或
npm run scrape-all    # 多板块
```

运行后访问 `http://localhost:3000`，新板块出现在首页列表中。

## CLI 配置参数

| 参数 | 默认值 | 说明 |
|------|--------|------|
| `FID` | -343809 | NGA 板块 ID（子版为负数，主版为正数） |
| `MAX_THREAD_PAGES` | 2 | 论坛列表最多抓取页数（每页约 50 帖） |
| `MAX_DETAIL_THREADS` | 100 | 预抓取帖子详情上限 |
| 每帖最多翻页 | 5 | `Math.min(Math.ceil(replyCount / 20), 5)` |

## 插件系统规范

### ForumConfig 接口

```typescript
interface ForumConfig {
  fid: number;              // NGA 板块 ID
  name: string;             // 显示名称
  baseUrl: string;          // 板块 URL
  categories: Array<{       // 帖子分类标签
    id: string;
    name: string;
    fid?: number;
  }>;
  subForums: Array<{        // 子版块列表
    fid: number;
    name: string;
    description?: string;
  }>;
}
```

### 注册机制

```typescript
// registry.ts — 全局 Map<fid, ForumConfig>
registerPlugin(config)   // 注册板块
getPlugin(fid)            // 查询板块
getAllPlugins()           // 列出所有
isPluginRegistered(fid)   // 检查是否已注册
```

### 模板文件

```typescript
// src/plugins/_template.ts
import { registerPlugin } from "./registry";

export function createForumPlugin(
  fid: number,
  name: string,
  categories: ForumConfig["categories"] = []
): ForumConfig {
  const config: ForumConfig = { fid, name, baseUrl: `...`, categories, subForums: [] };
  registerPlugin(config);
  return config;
}
```

## API 契约

详见 [`API.md`](./API.md)。核心三个端点：

| 端点 | 用途 | 缓存策略 |
|------|------|---------|
| `GET /api/v1/forums/:fid?page=` | 论坛帖子列表 | SQLite 读取，50 条/页 |
| `GET /api/v1/threads/:tid?page=` | 帖子详情+回复 | SQLite 读取，按 page 过滤 |
| `GET /api/v1/image-proxy?url=` | 图片代理 | 86400s 浏览器缓存 |

## 数据库设计

```sql
-- forums 表
CREATE TABLE forums (
  fid INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  parent_fid INTEGER,
  updated_at INTEGER NOT NULL
);

-- threads 表
CREATE TABLE threads (
  tid INTEGER PRIMARY KEY,
  fid INTEGER NOT NULL,
  title TEXT NOT NULL,
  author TEXT NOT NULL,
  reply_count INTEGER DEFAULT 0,
  sticky INTEGER DEFAULT 0,
  digest INTEGER DEFAULT 0,
  page_count INTEGER DEFAULT 1,
  updated_at INTEGER NOT NULL
);

-- posts 表
CREATE TABLE posts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  pid INTEGER NOT NULL,
  tid INTEGER NOT NULL,
  page INTEGER NOT NULL DEFAULT 1,     -- 翻页关键字段
  author TEXT NOT NULL,
  content TEXT NOT NULL,
  content_html TEXT NOT NULL DEFAULT '',
  create_time INTEGER NOT NULL,
  reply_to INTEGER,                     -- 楼中楼引用
  floor INTEGER NOT NULL,
  images TEXT DEFAULT '[]',             -- JSON 数组
  likes INTEGER DEFAULT 0
);
-- 索引
CREATE INDEX idx_posts_tid ON posts(tid);
CREATE INDEX idx_posts_tid_page ON posts(tid, page, floor);
CREATE INDEX idx_threads_fid ON threads(fid);
```

## 故障排查

| 症状 | 可能原因 | 解决 |
|------|---------|------|
| 论坛列表空白 | 数据未抓取 | 运行 `npm run scrape` |
| 点帖子无内容 | 该帖不在预抓取范围 | 等按需抓取完成（3-5s），或扩大 `MAX_DETAIL_THREADS` |
| 图片不显示 | NGA 防盗链或懒加载 | 检查图片 URL 是否含 `data-srcorg`；确认 `/api/v1/image-proxy` 可达 |
| 翻页无响应 | `totalPages` 为 1 | 检查 SQLite 中该帖 posts 数量，运行 `npm run scrape` 重新抓取 |
| 第 2 页加载慢 | 数据未预抓取 | 增大 CLI 的 `MAX_DETAIL_THREADS`；CLI 已自动按 `replyCount/20` 计算翻页数 |
| 页面闪白 | React 状态切换 | 翻页时用 `pageLoading` 保留旧内容，避免清空 data |

## 性能调优

| 环节 | 耗时 | 优化 |
|------|------|------|
| SQLite 查询 | <50ms | 已最优 |
| API 响应 | <50ms | Cache-Control 30s |
| React 渲染 20 帖 | ~150ms | `content-visibility: auto` |
| Next.js Link 导航 | ~200ms | 客户端路由，无编译 |
| **总首屏** | **<500ms** | — |
| Playwright 按需抓取 | 3-8s | 仅兜底，预抓取覆盖后不触发 |

**模式选择**：`npm run dev` 有编译开销（每次导航 1-3s），部署用 `npm run build && npm run start`。

## 板块树自动刷新

首页显示板块数量 + 最后更新时间（"366 个板块 · 3 分钟前更新"）。

| 操作 | 说明 |
|------|------|
| 首页"刷新列表"按钮 | 重载页面，API 返回最新 `forums` 表数据 |
| `npx tsx scripts/scrape-boards.ts` | 手动重新解析 NGA 首页板块树 |
| 定期运行（建议每周） | Windows 任务计划 / Linux cron |

## 附件格式处理

NGA 部分图片通过 `ubbcode.attach.load()` JavaScript 加载：

```
ubbcode.attach.load('id','container',[{url:'mon_202509/23/xxx.jpg',type:'img',...}])
```

解析流程：
1. 正则提取 `url:'mon_YYYYMM/DD/xxx.jpg'`
2. 补全路径 `https://img.nga.178.com/attachments/mon_YYYYMM/DD/xxx.jpg`
3. 加入 `images` 数组 → ImageGallery 渲染
4. 显示区移除 JS 代码和"显示全部附件"文本

## 扩展路线图

| 方向 | 路径 | 参考文档 |
|------|------|---------|
| **新 Web 板块** | 本章"多板块接入 5 步" | 本文档 |
| **Android / Flutter** | Dart 类型映射 + BBCode 翻译 + 液态玻璃 UI | [`ANDROID.md`](./ANDROID.md) |
| **多板块 CLI** | 批量 FID 循环抓取 | 本文档第 4 步 |
| **定时抓取** | cron / Windows 任务计划 | `npm run scrape` 可重复执行 |
| **RSS 订阅** | 基于 threads 表生成 RSS XML | — |
| **搜索** | SQLite FTS5 全文索引 | `CREATE VIRTUAL TABLE posts_fts USING fts5(content)` |
