# NGA 镜像站 — 项目对接文档 (Onboarding)

> 一份自包含的接手文档。读完即可运行、修改、扩展项目。

## 1. 5 分钟概览

### 这是什么

从 NGA 论坛 (bbs.nga.cn) 抓取帖子数据，用液态玻璃 UI 呈现的镜像阅读器。
两个仓库：

| 仓库 | 地址 | 角色 |
|------|------|------|
| **Web 后端+前端** | https://github.com/Metres0/nga-hupu | Next.js 14 全栈，含抓取引擎 |
| **Flutter 客户端** | https://github.com/Metres0/nga-hupu-app | Android 液态玻璃 App |

### 技术栈

```
Web:   Next.js 14 · React 18 · Tailwind CSS · Playwright · better-sqlite3 · Cheerio
App:   Flutter 3.32 · Dart 3.6 · Provider · CachedNetworkImage · SharedPreferences
Data:  NGA 移动端 (Nga_Official/9.9.9 UA) → HTML 解析 → SQLite
```

### 访问

```
Web:  http://localhost:3000
API:  http://localhost:3000/api/v1/
  /forums/:fid      论坛帖子列表
  /threads/:tid      帖子详情
  /image-proxy?url=  图片代理
  /boards            366 板块树
```

---

## 2. 环境搭建

### 2.1 Web 端

```bash
# 1. Node.js 22+ (https://nodejs.org)
node --version   # v22.x

# 2. 安装依赖
cd F:\nga-hupu
npm install

# 3. 安装 Chrome (Playwright 使用系统 Chrome 作为无头浏览器)
# 确保 C:\Program Files\Google\Chrome\Application\chrome.exe 存在

# 4. 初始化数据
npx tsx scripts/scrape-boards.ts    # 解析 NGA 全站 366 个板块 → SQLite
npm run scrape                       # 抓取当前 FID 板块的帖子数据

# 5. 启动
npm run build && npm run start
```

### 2.2 Flutter 端

```bash
# 1. Flutter 3.32 (https://docs.flutter.dev/get-started/install/windows)
#    解压到 C:\flutter，添加 C:\flutter\bin 到 PATH

# 2. JDK 21 (https://jdk.java.net/21/)
#    解压到 C:\jdk21，设 JAVA_HOME

# 3. Android SDK (Android Studio 自带，或 cmdline-tools)
#    SDK 路径: %LOCALAPPDATA%\Android\Sdk
#    需 platform 35 + build-tools 35 + platform-tools

# 4. 安装依赖
cd F:\nga_hupu_app
flutter pub get

# 5. 构建
set JAVA_HOME=C:\jdk21\jdk-21.0.11
set ANDROID_HOME=%LOCALAPPDATA%\Android\Sdk
flutter build apk --debug
# APK: build\app\outputs\flutter-apk\app-debug.apk
```

---

## 3. 架构全景图

### 数据流

```
NGA (bbs.nga.cn)
  │ Playwright + Nga_Official/9.9.9 UA (绕过访客限制)
  │ Cheerio HTML 解析
  ▼
┌──────────────────────────────────┐
│ scripts/scrape.ts (单板块)       │
│ scripts/scrape-all.ts (多板块)   │
│ scripts/scrape-boards.ts (板区树) │
└──────────────┬───────────────────┘
               │ cacheThreads() / cachePosts() / cacheForums()
               ▼
┌──────────────────────────────────┐
│ SQLite: data/nga-cache.db        │
│  forums 表 — 366 板块树          │
│  threads 表 — 帖子列表            │
│  posts 表 — 帖子回复 (含 page 列) │
└──────────────┬───────────────────┘
               │ getCachedThreads() / getCachedPosts() / getAllCachedForums()
               ▼
┌──────────────────────────────────┐
│ Next.js API Routes               │
│  (纯 SQLite 读取 <50ms)          │
│  缓存未中 → Playwright 按需抓取   │
└──────────────┬───────────────────┘
               │ JSON
               ▼
┌──────────────────────────────────────┐
│ React (Web)  │  Flutter (Android)    │
│ Next.js 14   │  http package         │
│ Tailwind CSS │  Provider + Material3 |
│ Liquid Glass │  BackdropFilter       │
└──────────────────────────────────────┘
```

### 组件依赖树

```
page.tsx (路由入口)
  ├── ForumPageClient (论坛列表)
  │     ├── GlassNav
  │     ├── ThreadList → Link → GlassCard
  │     └── 页码按钮
  └── ThreadPageClient (帖子详情)
        ├── GlassNav
        ├── PostCard (回复卡片)
        │     ├── GlassCard
        │     ├── 回复引用预览
        │     └── ImageGallery (图片灯箱)
        └── 页码按钮
```

---

## 4. 文件索引

### 4.1 Web 端 (`F:\nga-hupu\src\`)

| 文件 | 一句话用途 |
|------|-----------|
| **核心引擎** | |
| `lib/scraper/engine.ts` | Playwright 抓取 NGA 帖子列表和详情 |
| `lib/parser/bbcode.ts` | BBCode→HTML 解析 + 附件提取 + 图片代理 |
| `lib/cache/db.ts` | SQLite 表创建、CRUD、缓存过期 |
| `lib/reply-tree.ts` | 回复树构建 (buildReplyTree + flattenTree) |
| `lib/nga-cache.ts` | 客户端 SWR 缓存 Map + prefetchData |
| **API 路由** | |
| `app/api/v1/forums/[fid]/route.ts` | 论坛帖子列表 API (缓存→SQLite→按需抓取) |
| `app/api/v1/threads/[tid]/route.ts` | 帖子详情 API (含 page 过滤) |
| `app/api/v1/image-proxy/route.ts` | 图片代理 (防防盗链) |
| `app/api/v1/boards/route.ts` | 板块树 API |
| **页面** | |
| `app/page.tsx` | 首页 (BoardExplorer 搜索/订阅/折叠) |
| `app/layout.tsx` | 根布局 + 插件 import |
| `app/forum/[fid]/page.tsx` | 论坛页入口 |
| `app/forum/[fid]/thread/[tid]/page.tsx` | 帖子详情页入口 |
| `app/globals.css` | 全局样式 (暗色渐变 + 液态玻璃) |
| **UI 组件** | |
| `components/ui/GlassCard.tsx` | 液态玻璃卡片 |
| `components/ui/GlassButton.tsx` | 液态玻璃按钮 |
| `components/ui/GlassSkeleton.tsx` | 骨架屏 |
| `components/ui/GlassBadge.tsx` | 标签 |
| **业务组件** | |
| `components/widgets/BoardExplorer.tsx` | 板块搜索/订阅/折叠逻辑 |
| `components/widgets/BoardCard.tsx` | 单个板块卡片 |
| `components/widgets/ForumPageClient.tsx` | 论坛页数据加载 + 预取 |
| `components/widgets/ThreadPageClient.tsx` | 帖子详情页数据加载 |
| `components/widgets/ThreadList.tsx` | 帖子列表渲染 + 悬停预取 |
| `components/widgets/PostCard.tsx` | 回复卡片 (含 depth 缩进) |
| `components/widgets/ImageGallery.tsx` | 图片画廊 + 灯箱 |
| `components/widgets/GlassNav.tsx` | 导航栏 |
| **插件** | |
| `plugins/registry.ts` | 板块注册中心 (Map<fid, ForumConfig>) |
| `plugins/car-club.ts` | 汽车俱乐部插件 |
| `plugins/music-film.ts` | 音乐影视插件 |
| `plugins/_template.ts` | 新板块模板 |
| **脚本** | |
| `scripts/scrape.ts` | 单板块抓取 CLI |
| `scripts/scrape-all.ts` | 多板块批量抓取 |
| `scripts/scrape-boards.ts` | 解析 NGA 首页 → 板块树 → SQLite |

### 4.2 Flutter 端 (`F:\nga_hupu_app\lib\`)

| 文件 | 一句话用途 |
|------|-----------|
| `main.dart` | 入口 + MaterialApp + 路由 + Provider |
| `models/models.dart` | BoardNode / Thread / Post 数据类 + fromJson |
| `api/nga_client.dart` | HTTP 客户端 (getBoards / getForumThreads / getThreadDetail) |
| `parser/bbcode.dart` | BBCode→HTML 解析器 (纯函数) |
| `utils/reply_tree.dart` | 回复树构建 + 平铺 |
| `providers/subscription_provider.dart` | SharedPreferences 订阅管理 |
| `screens/home_screen.dart` | 板块搜索/订阅/折叠 |
| `screens/forum_screen.dart` | 帖子列表 + 下拉刷新 + 翻页 |
| `screens/thread_screen.dart` | 回复树 + 图片灯箱 |
| `widgets/glass_card.dart` | 液态玻璃 BackdropFilter 组件 |
| `widgets/board_card.dart` | 板块卡片 |
| `widgets/thread_card.dart` | 帖子卡片 |
| `widgets/post_card.dart` | 回复卡片 + depth 缩进 + ImageGallery |

---

## 5. 核心操作手册

### 5.1 添加新板块（6 步）

```typescript
// Step 1: 创建插件 → src/plugins/new-forum.ts
import { registerPlugin } from "./registry";
registerPlugin({
  fid: -123456,
  name: "新板块",
  baseUrl: "https://bbs.nga.cn/thread.php?fid=-123456",
  categories: [{ id: "all", name: "全部" }],
  subForums: [],
});

// Step 2: 注册布局 → src/app/layout.tsx 加一行
import "@/plugins/new-forum";

// Step 3: 更新 CLI → scripts/scrape.ts 改 FID
const FID = -123456;

// Step 4: 或加入多板块 → scripts/scrape-all.ts 加 FORUMS 数组
{ fid: -123456, name: "新板块" },

// Step 5: 如果 NGA 移动端显示缩略名，在 scripts/scrape-boards.ts 加修正
const nameFixes: Record<number, string> = {
  [-123456]: "正确的全名",
};

// Step 6: 抓取
npx tsx scripts/scrape-boards.ts  // 更新板块树
npm run scrape                     // 抓取帖子
```

### 5.2 修复 BBCode 解析器

**改文件**: `lib/parser/bbcode.ts`（Web）或 `parser/bbcode.dart`（Flutter）

两种格式：`[tag] content [/tag]` 或 `[tag=attr] content [/tag]`

```typescript
// 添加新标签示例
html = html.replace(
  /\[newtag\](.*?)\[\/newtag\]/gis,
  '<div class="bb-newtag">$1</div>'
);
```

然后在 PostCard.tsx 的 Tailwind 类中加样式：`[&_.bb-newtag]:text-red-400`

### 5.3 修复图片提取

**改文件**: `lib/scraper/engine.ts` → `extractImageSrc()` 函数

```typescript
// 当前优先级: _orgsrc > data-srcorg > data-src > data-original > _src > data-url > src
// 添加新属性: 在 extractImageSrc() 的属性链中插入
// 兜底扫描: data-* 和 _* 全属性循环

// 所有图片经 /api/v1/image-proxy?url= 代理
```

### 5.4 添加新页面

```typescript
// 1. 创建路由 → app/my-page/page.tsx
"use client";
export default function MyPage() { return <div>...</div>; }

// 2. 添加 API → app/api/v1/my-endpoint/route.ts
import { NextResponse } from "next/server";
export async function GET() { return NextResponse.json({ ok: true }); }
```

---

## 6. API 契约

### GET /api/v1/forums/:fid?page=1

```json
{
  "data": [{
    "tid": 46814321, "fid": -343809, "title": "...",
    "author": "...", "replyCount": 114, "createTime": 1779250866878,
    "sticky": false, "digest": false, "categories": []
  }],
  "page": 1, "totalPages": 2, "hasMore": true,
  "forum": { "fid": -343809, "name": "汽车俱乐部", "subForums": [] },
  "cached": true
}
```

### GET /api/v1/threads/:tid?page=1

```json
{
  "thread": { "tid": 46809845, "title": "...", "replyCount": 19 },
  "posts": [{
    "pid": 1, "tid": 46809845, "author": "UID:65086464",
    "content": "纯文本", "contentHtml": "<p>富文本 HTML</p>",
    "floor": 0, "replyTo": null, "images": [], "likes": 0,
    "createTime": 1779176520000
  }],
  "totalPages": 2, "cached": true
}
```

### GET /api/v1/boards

```json
{
  "forums": [{ "fid": -343809, "name": "汽车俱乐部", "parent_fid": null }],
  "lastUpdated": 1779261125628, "staleMinutes": 12
}
```

### GET /api/v1/image-proxy?url=ENCODED_URL

返回图片二进制流。Cache-Control: max-age=86400。

### 错误码

| 状态 | 含义 |
|------|------|
| 200 | 成功 |
| 400 | 缺少参数 |
| 403 | NGA 拦截 (需要 UA 反制) |
| 500 | 抓取/服务错误 |
| 502 | 图片代理请求失败 |

---

## 7. 构建部署

### Web 端

```bash
# 开发
npm run dev

# 生产
npm run build && npm run start

# 数据抓取
npx tsx scripts/scrape-boards.ts     # 板块树 (首次)
npm run scrape                        # 单板块帖子
npx tsx scripts/scrape-all.ts        # 所有注册板块

# 数据库位置
data/nga-cache.db                    # 单文件 SQLite
```

### Flutter 端

```bash
# 开发
flutter run                           # 需连接设备/模拟器

# 生产 APK
flutter build apk --debug             # debug 包 (~50MB)
flutter build apk --release           # release 包 (~15MB)

# 环境变量
JAVA_HOME=C:\jdk21\jdk-21.0.11
ANDROID_HOME=%LOCALAPPDATA%\Android\Sdk
PATH=%PATH%;C:\flutter\bin;%JAVA_HOME%\bin
```

### 连接 Flutter 到 Web 服务

```dart
// lib/api/nga_client.dart:5
NgaClient({this.baseUrl = 'http://localhost:3000'});
// 改为远程地址: 'https://your-server.com'
// 或在 main.dart 中传入: NgaClient(baseUrl: 'http://192.168.1.100:3000')
```

---

## 8. 故障排查

| 症状 | 原因 | 解决 |
|------|------|------|
| **论坛列表空白** | 数据未抓取或缓存过期 | `npm run scrape` |
| **点帖子无内容** | 该帖不在预抓取范围 | 等 3-5s 按需抓取完成，或 `MAX_DETAIL_THREADS` 增大 |
| **图片不显示** | NGA 防盗链或懒加载 | 检查 `/api/v1/image-proxy` 可达；查看 `src` 是否 `about:blank` |
| **翻页无响应** | `totalPages: 1` 缓存 bug | `npm run scrape` 重新抓取多页 |
| **搜不到"汽车俱乐部"** | NGA 移动端存为"寂寞的车" | `scripts/scrape-boards.ts` 中 `nameFixes` 修正 |
| **Flutter 构建失败** | Gradle/Maven 下载超时 | `F:\nga_hupu_app\android\settings.gradle.kts` 已有阿里云 Maven 镜像 |
| **Gradle "zip END header"** | 缓存损坏 | 删 `%USERPROFILE%\.gradle\wrapper\dists` 重建 |
| **Flutter "No Android SDK"** | 缺少 `ANDROID_HOME` | `set ANDROID_HOME=%LOCALAPPDATA%\Android\Sdk` |
| **404 访问不了** | 服务器未启动 | `npm run start` |
| **NGA 403 拦截** | UA 设置错误 | 检查 UA 为 `Nga_Official/9.9.9` |
| **非分页池/内存泄漏** | Playwright Chrome 孤儿进程 | `taskkill /F /IM chrome.exe` 清理；CLI 脚本启动即清理残留；`engine.ts` 注册 4 种退出信号 + 5 分钟空闲自动关闭；`GET /api/v1/health` 监控 chromeProcesses |
| **系统卡顿** | 多个 Chrome 实例堆积 | `curl http://localhost:3000/api/v1/health` 检查 chromeProcesses 数量 |

---

## 9. Flutter 衔接要点

### API 客户端

```dart
// lib/api/nga_client.dart — 唯一对接点
final client = NgaClient(baseUrl: 'http://192.168.1.100:3000');
final boards = await client.getBoards();
final (threads, _, _) = await client.getForumThreads(-343809);
final (thread, posts, pages) = await client.getThreadDetail(46809845);
```

### 订阅存储

```dart
// lib/providers/subscription_provider.dart
// 等价于 Web 端 localStorage
// 存储键: 'nga_subscribed_fids' → JSON 数组 → SharedPreferences
```

### 液态玻璃

```dart
// lib/widgets/glass_card.dart
// 实现: ClipRRect + BackdropFilter(ImageFilter.blur(20,20))
//       + Container(decoration: BoxDecoration(color: white/0.08))
// 等价于 Web 端: backdrop-blur + bg-white/10
```

### 图片代理

```dart
// lib/parser/bbcode.dart → proxyImgUrl()
// 所有 externUrl → /api/v1/image-proxy?url=ENCODED
// 等价于 Web 端 bbcode.ts → proxyImgUrl()
```

---

## 10. 优化路线图

### Web 端

| 优先级 | 项目 | 文件 | 说明 |
|--------|------|------|------|
| ⭐⭐⭐ | 增量抓取 | `scripts/scrape.ts` | 对比 SQLite 已有 TID，仅抓新增/变更 |
| ⭐⭐⭐ | 定时刷新 | `scripts/auto-refresh.ts` | cron/interval 调用 scrape-all |
| ⭐⭐ | 全文搜索 | `lib/cache/db.ts` | SQLite FTS5 索引 posts 表 |
| ⭐⭐ | 亮色主题 | `globals.css` + `theme.ts` | CSS 变量 system/dark/light 切换 |
| ⭐ | RSS | `app/api/v1/rss/[fid]/route.ts` | 生成 XML |
| ⭐ | 并发多板块 | `scripts/scrape-all.ts` | Pool 5 替换串行 |

### Flutter 端

| 优先级 | 项目 | 文件 | 说明 |
|--------|------|------|------|
| ⭐⭐⭐ | 离线缓存 | 新建 `lib/cache/local_db.dart` | `sqflite` 本地 SQLite |
| ⭐⭐ | 通知推送 | `android/app/` + WorkManager | FCM + 后台检查新帖 |
| ⭐⭐ | Deep Link | `AndroidManifest.xml` | `ngahupu://thread/:tid` |
| ⭐ | 连接池 | `lib/api/nga_client.dart` | `http.Client` keep-alive |
| ⭐ | Material You | `lib/main.dart` ThemeData | dynamic color |
| ⭐ | 性能 | 全局 | `const` widget + RepaintBoundary |
