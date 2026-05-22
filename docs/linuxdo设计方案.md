# Linux.do 第三方客户端设计方案

> 基于 FluxDO (https://github.com/Lingyan000/fluxdo) 的深度源码分析
> 版本: v0.2.15 | Flutter SDK ^3.10.4 | 717 Commits | GPL-3.0

---

## 一、项目概述

### 1.1 产品定位

FluxDO 是 Linux.do 社区（基于 Discourse 论坛引擎）的第三方跨平台客户端，支持 **Android / iOS / Windows / macOS / Linux** 五大平台，同时提供 **Flutter Web PWA**。

### 1.2 技术栈总览

| 层次 | 技术选型 | 版本 |
|------|----------|------|
| **前端框架** | Flutter | SDK ^3.10.4 |
| **UI 设计语言** | Material Design 3 + Dynamic Color | Flutter 内置 |
| **状态管理** | Riverpod | 3.1.0 |
| **网络请求** | Dio (多适配器) | 5.9.0 |
| **HTML 渲染** | flutter_widget_from_html | 0.17.1 |
| **代码高亮** | re_highlight | 0.0.3 |
| **图片处理** | cached_network_image + extended_image_lite | - |
| **国际化** | slang (编译期类型安全) | 4.14.0 |
| **HTTP 适配器** | native_dio_adapter / rhttp (Rust FFI) / cronet_http | - |
| **网络代理** | Rust DOH 代理 (独立子模块) | - |
| **浏览器内核** | flutter_inappwebview | 6.2.0-beta.3 |
| **本地存储** | shared_preferences + flutter_secure_storage | - |
| **崩溃收集** | catcher_2 | 2.1.5 |
| **工程化** | Melos Monorepo + Just 任务系统 | - |

### 1.3 代码组成

```
语言分布:  Dart 79.9%  C++ 14.8%  HTML 2.1%  Kotlin 0.7%  CMake 0.7%  Swift 0.5%
源码规模:  717 个提交, 6 个本地包, 1 个 Rust 子模块
```

---

## 二、前端架构设计

### 2.1 启动流程（6 阶段初始化）

```
main() ──▶ Stage 0 (同步)
            │  ├── WidgetsFlutterBinding.ensureInitialized()
            │  ├── SystemChrome (edge-to-edge)
            │  ├── HighlighterService 预热
            │  ├── LocalNotificationService 初始化
            │  └── 禁用 Android WebView CDP Debug
            │
            ▶ Stage 1 (并行初始化)
            │  ├── SharedPreferences
            │  ├── UserAgent 生成
            │  ├── LogWriter
            │  ├── ProxyCertificate 同步
            │  ├── CookieJarService 初始化
            │  ├── CsrfTokenService 提取
            │  ├── BackgroundNotificationService
            │  └── WindowManager + Acrylic (桌面端)
            │
            ▶ Stage 2 (串行依赖)
            │  ├── DataMigrationService (版本升级)
            │  ├── Cronet 降级检查
            │  ├── ProxySettingsService 初始化
            │  ├── Rhttp 初始化 (5s 超时 + 强制禁用降级)
            │  ├── NetworkSettingsService
            │  └── CfClearanceRefreshService 预启动
            │
            ▶ 冷启动缓存清理 (可选)
            │  └── 清空 Discourse / Emoji / External 图片缓存
            │
            ▶ PreloadedDataService (非阻塞预热)
            └──▶ runApp(ProviderScope(overrides: [...], child: MainApp()))
```

### 2.2 Widget 层级

```
Catcher2 (崩溃收集容器)
  └── ProviderScope (Riverpod 作用域, 注入 overrides)
      └── MainApp (ConsumerWidget)
          └── DynamicColorBuilder (MD3 动态取色)
              └── TranslationProvider (slang 国际化)
                  └── MaterialApp
                      ├── navigatorKey + RouteObserver
                      ├── AnnotatedRegion<SystemUiOverlayStyle>
                      └── Stack
                          ├── 主内容页
                          ├── ReadLaterBubble (悬浮稍后阅读球)
                          ├── KeyboardShortcutHandler (桌面快捷键)
                          └── home: OnboardingGate → PreheatGate → MainPage
```

### 2.3 MainPage 核心 Shell

```
MainPage
  ├── Scaffold + bottomNavigationBar
  │   ├── NavEntry 系统 (page | panel | action)
  │   └── 双击/单击自定义操作分发
  ├── IndexedStack (保持所有 Tab 存活)
  │   ├── TopicsPage (首页)
  │   ├── SearchPage (搜索)
  │   ├── NotificationsPage (通知)
  │   └── ProfilePage (个人)
  └── 生命周期管理 (WidgetsBindingObserver)
      ├── didChangeAppLifecycleState()
      │   ├── paused → enableBackgroundMode() (ForegroundTask + WorkManager)
      │   └── resumed → disableBackgroundMode() + debounce 重连 MessageBus
      ├── 剪贴板话题链接检测
      └── 双击返回退出 (Toast 提示)
```

### 2.4 导航系统设计 - NavEntry

```
NavEntryRegistry
  ├── home         → page   → TopicsPage
  ├── search       → page   → SearchPage
  ├── notifications→ panel  → NotificationQuickPanel
  ├── createTopic  → action → CreateTopicPage (push)
  ├── bookmarks    → page   → BookmarksPage
  ├── profile      → page   → ProfilePage
  └── settings     → page   → SettingsPage

NavEntry {
  id: String
  kind: NavEntryKind { page, panel, action }
  icon: IconData
  label: String
  pageBuilder: () → Widget
}

NavActionBus {
  // 底部导航栏手势事件分发
  onSingleTap(id)
  onDoubleTap(id)  // 300ms 双击窗口
}
```

- 用户可在设置中重排底部导航
- 双击行为可自定义 (切换到最新 / 标记已读 / 滚动到顶)

### 2.5 Riverpod 状态管理层

```
providers/
├── 核心状态 (8 个)
│   ├── core_providers.dart        → currentUser, authState, authError
│   ├── theme_provider.dart        → 主题色/暗色模式/字体
│   ├── locale_provider.dart       → 多语言
│   ├── connectivity_provider.dart → 网络连接状态
│   └── preferences_provider.dart  → 用户偏好
│
├── 话题 (12 个)
│   ├── topic_list/              → topic_list_provider, filter, sort, tab
│   ├── topic_detail_provider.dart
│   ├── selected_topic_provider.dart
│   ├── topic_session_provider.dart
│   ├── nested_topic_provider.dart
│   └── topic_search_provider.dart
│
├── 实时消息 (5 个)
│   ├── message_bus/
│   │   ├── message_bus_service_provider.dart
│   │   ├── topic_channel_provider.dart   (topic 频道)
│   │   ├── notification_providers.dart   (通知频道)
│   │   └── topic_tracking_providers.dart (追踪状态)
│   └── notification_list_provider.dart
│
├── 内容 (8 个)
│   ├── category_provider.dart
│   ├── search_provider.dart
│   ├── emoji_provider.dart
│   └── sticker_provider.dart
│
└── 用户 (5 个)
    ├── profile_stats_provider.dart
    ├── read_later_provider.dart
    └── download_provider.dart
```

**设计特点**:

- 使用 `autoDispose` + `family` 实现话题级 Provider 自动释放
- `instanceId` (UUID v4) 机制隔离不同话题详情的状态
- `AsyncNotifier` 懒加载 + 自动重试控制

---

## 三、HTML 渲染引擎

### 3.1 架构设计

```
DiscourseHtmlContent (入口 Widget)
  │
  ├── DiscoureWidgetFactory (自定义 Widget 工厂)
  │   ├── img  → DiscourseImage (支持 upload:// 协议解析)
  │   ├── img  → LazyImage (VisibilityDetector 懒加载)
  │   ├── svg  → JovialSVG (矢量渲染)
  │   ├── a    → LinkLauncher (安全检查 + 浏览器打开)
  │   ├── div.lightbox-wrapper → GalleryInfo (图片画廊)
  │   └── video → Chewie/VideoPlayer
  │
  ├── 文本处理管道
  │   ├── Emoji 解析 → EmojiHandler
  │   ├── Mention 解析 → @用户名链接
  │   ├── Pangu 排版 → pangutext (中英文空格)
  │   ├── Spoiler 折叠 → blur 遮罩
  │   └── Poll 投票 → 内嵌投票组件
  │
  ├── 代码高亮
  │   ├── HighlighterService (Isolate Worker Pool)
  │   │   ├── re_highlight + LRU Cache (max 50)
  │   │   ├── 并发限制 (max 3)
  │   │   ├── 语言检测 (regex 启发式)
  │   │   └── Google Fonts FiraCode 预加载
  │   └── SelectableText.rich + CodeSelectionContextTracker
  │
  └── 分块渲染 (大帖子)
      └── SegmentedLongPost
          ├── PostHeader
          ├── Chunk 1 (HTML 片段)
          ├── Chunk 2
          ├── ...
          └── PostFooter
```

### 3.2 性能优化手段

| 优化点 | 实现方式 |
|--------|----------|
| **大 HTML 分块** | 长帖拆分为 header/chunk/footer 三段，避免单棵巨型 Widget 树 |
| **懒加载图片** | LazyImage + VisibilityDetector，仅可视区域加载 |
| **Isolate 预处理** | HTML 分块 + Pangu 排版在 Isolate 中完成 |
| **代码高亮 Isolate** | HighlightWorker 持久化 Isolate，避免主线程卡顿 |
| **表情缓存** | EmojiCacheManager 独立缓存 |
| **文本选择** | SelectableAdapter 让 Emoji 等自定义 Widget 参与文本选择 |

---

## 四、网络层深度剖析

### 4.1 多适配器架构

```
                         ┌──────────────────────┐
                         │    Discourse API      │
                         │    (https://linux.do) │
                         └──────────┬───────────┘
                                    │
                    ┌───────────────┼───────────────┐
                    │               │               │
            ┌───────▼──────┐ ┌─────▼──────┐ ┌──────▼──────┐
            │ RhttpAdapter │ │  Native    │ │  WebView    │
            │ (Rust FFI)   │ │  Adapter   │ │  Adapter    │
            └───────┬──────┘ └─────┬──────┘ └──────┬──────┘
                    │              │               │
            ┌───────▼──────┐ ┌─────▼──────┐ ┌──────▼──────┐
            │ Rust reqwest │ │ Cronet     │ │ WebView HTTP│
            │ + TLS 1.3    │ │ (Android)  │ │ (系统 WebView)│
            │ + ECH        │ │ / Cupertino│ │             │
            │              │ │ / Dio IO   │ │             │
            └──────────────┘ └────────────┘ └─────────────┘
```

**适配器选择策略** (`PlatformAdapter`):

```
优先级队列:
  1. RhttpAdapter     — 性能最优, Rust 原生 TLS + ECH
  2. NetworkAdapter   — 经过本地 DOH 代理
  3. NativeAdapter    — Cronet(Android) / Cupertino(iOS) / Dio IO(桌面)
  4. WebViewAdapter   — 系统 WebView HTTP 栈 (绕过限制)

降级触发:
  - Rhttp 初始化超时 (5s) → 自动禁用 Rhttp
  - Cronet 引擎错误 → CronetFallbackInterceptor 降级到 Dio IO
  - WebView 不可用 → 降级到 Native
```

### 4.2 Dio 8 层拦截器链

请求穿透严格排序的 8 层拦截器:

```
                        ┌──────────────────────────┐
                        │     Request               │
                        └────────────┬─────────────┘
                                     │
                    ┌────────────────▼────────────────┐
                    │ 1. RedirectInterceptor           │
                    │    手动处理 301/302/307/308      │
                    │    剥离原 Cookie, 保留到重定向后  │
                    ├─────────────────────────────────┤
                    │ 2. SessionGuardInterceptor       │
                    │    标记请求的 session 代际        │
                    │    丢弃过期 session 的响应        │
                    ├─────────────────────────────────┤
                    │ 3. RequestSchedulerInterceptor   │
                    │    优先级队列 + 滑动窗口限流      │
                    │    最大并发 3, 1s 窗口 10 个请求  │
                    ├─────────────────────────────────┤
                    │ 4. RequestHeaderInterceptor      │
                    │    注入 UA / CSRF Token          │
                    │    注入 Sec-Fetch / Discourse-Present │
                    ├─────────────────────────────────┤
                    │ 5. ErrorInterceptor              │
                    │    429 → RateLimitException      │
                    │    502/503/504 → ServerException │
                    │    其他 → Toast + 类型化异常     │
                    ├─────────────────────────────────┤
                    │ 6. CfChallengeInterceptor        │
                    │    检测 403 CF 挑战              │
                    │    触发手动验证后自动重试        │
                    ├─────────────────────────────────┤
                    │ 7. CronetFallbackInterceptor     │
                    │    检测 Cronet 引擎错误          │
                    │    降级到 Dio IO                 │
                    ├─────────────────────────────────┤
                    │ 8. NetworkLogInterceptor         │
                    │    结构化 JSON 日志              │
                    │    记录 method/url/status/duration │
                    └─────────────────────────────────┘
                                     │
                        ┌────────────▼─────────────┐
                        │        Response            │
                        └──────────────────────────┘
```

### 4.3 请求调度器详解

```dart
class RequestSchedulerInterceptor extends Interceptor {
  static const _concurrentLimit = 3;       // 最大并发请求数
  static const _maxRequestsPerWindow = 10; // 1秒窗口内最多10个请求
  static const _windowDuration = Duration(seconds: 1);

  final PriorityQueue<QueuedRequest> _queue;

  // 高优先级: 用户操作 (点赞/回复/举报)
  // 低优先级: 预加载/背景数据/头像/追踪状态
}
```

**特性**:
- 优先级队列保证用户操作不被阻塞
- 滑动窗口防止突发流量
- 并发限制保护服务端
- 超时自动释放队列

### 4.4 Session Guard 机制

```
请求 → 附加 sessionGeneration 标记
  │
响应 → checkSessionGuarded()
  │
  ├── 200/正常 → 放行
  │
  ├── 403/CSRF 过期 → BAD CSRF 检测
  │   └── 尝试重新登录获取新 _t token
  │
  └── 多次 403 (strike counting) → 保守登出
      └── AuthErrorEvent → 显示"请重新登录"对话框
          └── 可选"清除数据"操作
```

**保守登出策略**:
- 不是立即登出，而是 strike counting (计数器)
- 只有连续 N 次 403 才触发
- 避免网络抖动导致的误登出

### 4.5 Cookie 管理层

```
EnhancedCookieJar (加密持久化)
  ├── 存储: 文件系统 JSON (AES 加密)
  ├── Cookie 枚举
  │   ├── _t (CSRF Token)
  │   ├── _forum_session
  │   ├── cf_clearance (Cloudflare)
  │   └── discourse_present
  └── CsrfTokenService
      ├── 从 Cookie 提取 _t
      ├── 从 Meta 标签提取
      └── 通知所有 Provider CSRF Token 变更
```

### 4.6 错误处理体系

```
ErrorInterceptor
  ├── 429 Rate Limit
  │   ├── 解析 Retry-After 头
  │   ├── 解析响应体 "请等待 N 分钟" / "Please wait N seconds"
  │   └── 抛出 RateLimitException(retryAfter, message)
  │
  ├── 502/503/504 Server Error
  │   └── 抛出 ServerException(statusCode)
  │
  └── 其他状态码
      ├── 写请求 (POST/PUT/DELETE/PATCH) → 显示 Toast
      ├── extra['isSilent'] = true → 静默
      └── extra['showErrorToast'] = false → 抑制
```

---

## 五、DOH 代理系统 (核心亮点)

### 5.1 整体架构

```
┌─────────────────────────────────────────────────────────┐
│                   FluxDO App (Dart/Flutter)               │
│                                                          │
│  ┌─────────────────┐        ┌─────────────────────────┐  │
│  │   Dio Client     │──────▶│  PlatformAdapter        │  │
│  └─────────────────┘        │  (调度 4 种适配器)      │  │
│                              └───────────┬─────────────┘  │
│                                          │                │
│                              ┌───────────▼─────────────┐  │
│                              │  GatewayAdapterWrapper  │  │
│                              │  (URL → localhost 转换) │  │
│                              └───────────┬─────────────┘  │
│                                          │                │
│  ┌───────────────────────────────────────▼─────────────┐  │
│  │           NetworkSettingsService                    │  │
│  │  ├── DOH 配置 (URL / IPv6 / ECH)                   │  │
│  │  ├── Rust 代理生命周期 (start/stop/port)           │  │
│  │  ├── ECH 配置分发                                   │  │
│  │  ├── IP 惩罚管理                                    │  │
│  │  └── WebView 代理配置                               │  │
│  └───────────────────────┬─────────────────────────────┘  │
│                          │                                │
│  ┌───────────────────────▼─────────────────────────────┐  │
│  │               DOH Proxy (Rust)                      │  │
│  │  桌面端: doh_proxy_bin 独立进程                      │  │
│  │  移动端: libdoh_proxy.so FFI 调用                    │  │
│  │  ├── DOH DNS 解析 (hickory-resolver)                │  │
│  │  ├── TLS 1.3 + ECH (rustls + aws-lc-rs)            │  │
│  │  ├── MITM 证书管理 (rcgen)                          │  │
│  │  └── 上游代理 (SOCKS5 / Shadowsocks)                │  │
│  └─────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────┘
```

### 5.2 Rust 代理内核架构

Rust 独立仓库 (`fluxdo_doh`), 13 个源文件, ~170KB 代码:

```
src/
├── lib.rs              (公共 API / 配置类型)
│   ├── ProxyConfig { bind_addr, bind_port, enable_doh,
│   │                 doh_server, doh_server_ech, prefer_ipv6,
│   │                 timeout_secs, upstream_proxy, server_ip,
│   │                 gateway_mode, mitm_connect,
│   │                 ca_cert_pem, ca_key_pem }
│   └── UpstreamProxyConfig { protocol, host, port, username,
│                              password, cipher }
│
├── main.rs             (CLI 入口)
│   └── 解析参数: --doh, --ipv6, --gateway, --upstream-*
│
├── dns.rs              (DNS 解析器, 42KB)
│   ├── DnsResolver (共享单例 per DOH URL)
│   ├── lookup_ip() → A/AAAA 记录
│   ├── lookup_ech_config() → HTTPS 记录提取 ECH
│   ├── lookup_ech_and_ip() → 并行查询
│   ├── lookup_host() → IP + ECH + preferred IP + TTL
│   ├── 缓存层: IP Cache / ECH Cache / RTT Cache / Sticky IP
│   ├── 内置 7 个 DOH 服务器
│   └── extract_hints_from_https() → SVCB 记录解析
│
├── ech.rs              (ECH TLS 连接器, 22KB)
│   ├── DohTlsConnector (DNS Resolver + Root Store)
│   ├── connect() → TLS 1.3 + ECH ClientHello
│   ├── connect_h2() → H2 ALPN (Gateway 模式)
│   ├── connect_tcp() → 原始 TCP 隧道
│   ├── Happy Eyeballs (dual-stack 竞争)
│   └── TLS 配置缓存 (session resumption)
│
├── proxy.rs            (代理服务器核心, 26KB)
│   ├── DohProxyServer (TcpListener + shutdown signal)
│   ├── handle_connection() → 分派 plain/MITM CONNECT
│   ├── handle_connect_tunnel() → 字节双向转发
│   ├── handle_connect_mitm() → TLS 拦截 (动态证书)
│   ├── handle_gateway_connection() → 反向代理模式
│   │   └── GatewayPool → HTTP/2 连接池
│   └── PrefixedStream → 缓冲字节重放
│
├── upstream.rs         (上游代理, 13KB)
│   ├── connect_http_tunnel() → HTTP CONNECT 代理
│   ├── connect_socks5_tunnel() → SOCKS5 认证
│   └── connect_shadowsocks_tunnel()
│       └── 支持: AES-128/256-GCM, ChaCha20-Poly1305, 2022-blake3
│
├── cert.rs             (证书管理器, 8KB)
│   ├── CertManager (嵌入式 CA 证书)
│   ├── get_server_config(hostname) → 动态叶子证书
│   ├── from_pem(cert, key) → 运行时注入
│   └── generate_ca_pem() → 生成新 CA
│
├── ffi.rs              (C FFI 接口, 17KB)
│   └── API:
│       doh_proxy_start(port, prefer_ipv6)
│       doh_proxy_start_with_server(port, prefer_ipv6, doh_server)
│       doh_proxy_start_with_config_json(config_json)
│       doh_proxy_stop() / doh_proxy_is_running()
│       doh_proxy_get_port()
│       doh_proxy_lookup_ech_config(host, doh_server)
│       doh_proxy_lookup_ip(host, doh_server, prefer_ipv6)
│       doh_proxy_lookup_host(host, doh_server, doh_server_ech,
│                               prefer_ipv6, force_refresh)
│       doh_proxy_record_host_success()
│       doh_proxy_generate_ca() → { cert_pem, key_pem }
│       doh_proxy_get_embedded_ca_pem()
│       doh_proxy_init_logging()
│
├── tls_crypto.rs       (TLS 加密提供商)
│   └── Chrome 风格密码套件排序:
│       TLS 1.3: AES_128_GCM > AES_256_GCM > ChaCha20
│       TLS 1.2: ECDHE_*_AES_128_GCM > ECDHE_*_AES_256_GCM
│
├── error.rs            (错误类型)
│   └── DohProxyError { Io, Tls, Dns, EchConfigNotFound,
│                        EchNotSupported, InvalidUrl, Timeout,
│                        Proxy, Parse, Certificate }
│
└── build.rs            (构建脚本)
    └── 自动生成 CA 证书 (openssl EC prime256v1, 10 年有效期)
```

### 5.3 DOH 代理工作流程

```
客户端发起 CONNECT linux.do:443
        │
        ▼
┌─────────────────────────────────────┐
│  1. 接收 CONNECT 请求                │
│     解析目标 host + port             │
├─────────────────────────────────────┤
│  2. DOH DNS 解析                     │
│     hickory-resolver → HTTPS 查询    │
│     POST https://doh.pub/dns-query  │
│     Body: application/dns-message   │
│     并行查询: A 记录 + HTTPS 记录     │
│     ├── A/AAAA → IPv4/IPv6 地址      │
│     └── HTTPS → ECH ConfigList       │
├─────────────────────────────────────┤
│  3. TCP / TLS 连接                   │
│     ├── Happy Eyeballs (v4/v6 竞争)  │
│     ├── 上游代理隧道 (可选)           │
│     │   ├── SOCKS5 socks5://ip:port  │
│     │   ├── Shadowsocks ss://base64  │
│     │   └── HTTP CONNECT proxy       │
│     └── TLS 1.3 + ECH (rustls)       │
│         └── 加密 ClientHello SNI     │
├─────────────────────────────────────┤
│  4. 双向数据转发                     │
│     tokio::io::copy_bidirectional() │
│     客户端 ◄──► 目标服务器            │
└─────────────────────────────────────┘
```

### 5.4 内置 DOH 服务器

| 服务器 | URL | 特性 |
|--------|-----|------|
| **DNSPod** | `https://doh.pub/dns-query` | 国内首选，低延迟 |
| **腾讯 DNS** | `https://sm2.doh.pub/dns-query` | SM2 加密 |
| **阿里 DNS** | `https://dns.alidns.com/dns-query` | 阿里系服务 |
| **Cloudflare** | `https://cloudflare-dns.com/dns-query` | 国际首选，隐私友好 |
| **Canadian Shield** | `https://private.canadianshield.cira.ca/dns-query` | 加拿大非营利 |
| **Google** | `https://dns.google/dns-query` | 全球覆盖 |
| **Quad9** | `https://dns.quad9.net/dns-query` | 恶意域名过滤 |

### 5.5 跨平台实现策略

| 平台 | 实现方式 | 操作系统交互 |
|------|----------|-------------|
| **Android** | FFI (JNI) → `libdoh_proxy.so` (cdylib) | `System.loadLibrary("doh_proxy")` |
| **iOS** | FFI → `libdoh_proxy.a` (staticlib) | 静态链接到 App |
| **Windows** | 子进程 → `doh_proxy_bin.exe` | `Process.start()` |
| **macOS** | 子进程 → `doh_proxy_bin` | `Process.start()` |
| **Linux** | 子进程 → `doh_proxy_bin` | `Process.start()` |

### 5.6 IP 惩罚机制

```dart
// NetworkSettingsService 中的 IP 黑名单
class IpPenaltyManager {
  // 失败的 IP 被暂时加入黑名单
  // 下次解析时优先使用成功记录过的 IP (Sticky IP)
  // 定时清理过期惩罚条目
  void penalize(String host, String ip, Duration duration);
  bool isPenalized(String host, String ip);

  // Rust 端通过 FFI 同步:
  // doh_proxy_record_host_success(host, ip)
  // doh_proxy_clear_preferred_host_ip(host)
}
```

---

## 六、缓存体系

### 6.1 四层缓存架构

```
┌─────────────────────────────────────────────────────────┐
│ L1: 内存缓存                                            │
│  ├── Riverpod Provider (autoDispose 自动释放)           │
│  ├── HighlighterService LRU Cache (max 50, 并发 3)      │
│  ├── EmojiHandler 预加载表情数据                        │
│  ├── DiscourseService 请求缓存                          │
│  └── PreloadedDataService (首屏 HTML 预解析数据)         │
├─────────────────────────────────────────────────────────┤
│ L2: 图片缓存 (flutter_cache_manager)                    │
│  ├── DiscourseCacheManager   → 论坛上传图片 (upload://) │
│  ├── EmojiCacheManager       → 表情图片                 │
│  ├── ExternalCacheManager    → 外部引用图片              │
│  └── StickerCacheManager     → 贴纸                     │
├─────────────────────────────────────────────────────────┤
│ L3: Cookie 持久化                                       │
│  ├── EnhancedCookieJar (AES 加密)                        │
│  └── Cookie 与 Session 元数据                            │
├─────────────────────────────────────────────────────────┤
│ L4: 持久化存储                                          │
│  ├── SharedPreferences        → 设置 / 偏好 / 草稿       │
│  ├── FlutterSecureStorage     → API Key / Token / CSRF   │
│  └── 数据备份                  → JSON 导出 / 导入         │
└─────────────────────────────────────────────────────────┘
```

### 6.2 四大 CacheManager 对比

| CacheManager | 缓存内容 | 最大数量 | 存储期限 |
|-------------|----------|---------|----------|
| DiscourseCacheManager | 论坛上传图片 (upload:// 短链接) | 1000 | 7 天 |
| EmojiCacheManager | 表情图片 | 500 | 30 天 |
| ExternalCacheManager | 外部引用图片 | 500 | 3 天 |
| StickerCacheManager | 贴纸 | 200 | 30 天 |

### 6.3 冷启动策略

```
启动 → PreloadedDataService.fetchHomepage()
  ├── 获取首页 HTML
  ├── 提取 <div data-preloaded="..."> JSON
  │   ├── 当前用户信息 (currentUser)
  │   ├── 站点设置 (siteSettings)
  │   ├── 话题追踪状态 (topicTrackingStateMeta)
  │   ├── 话题列表数据 (topicListData)
  │   ├── 自定义表情 (customEmoji)
  │   ├── 可用反应 (enabledReactions)
  │   └── 基础设施 (baseUri / cdnUrl / s3CdnUrl)
  └── 可选: 清空冷启动缓存 (Discourse/Emoji/External)
```

### 6.4 缓存大小管理

```dart
class CacheSizeService {
  // 计算各类缓存磁盘占用
  Future<int> getDiscourseImageCacheSize();
  Future<int> getEmojiCacheSize();
  Future<int> getExternalImageCacheSize();
  Future<int> getAiChatCacheSize();
  Future<int> getCookieCacheSize();
  Future<int> getTotalCacheSize();

  // 清理所有缓存
  Future<void> clearAllCaches();

  // 导出/导入设置和 API Key
  Future<Map<String, dynamic>> exportSettings();
  Future<void> importSettings(Map<String, dynamic> data);
}
```

---

## 七、Cloudflare 绕过机制

### 7.1 三阶段处理流程

```
┌──────────────────────────────────────────────────────────┐
│ 阶段 1: 检测 (CfChallengeInterceptor)                    │
│  ┌────────────────────────────────────────────────────┐  │
│  │ HTTP Response 403                                  │  │
│  │   ├── 检查响应体是否包含 turnstile/cf_challenge    │  │
│  │   ├── 是 → 暂停请求队列                            │  │
│  │   └── 触发阶段 2                                   │  │
│  └────────────────────────────────────────────────────┘  │
├──────────────────────────────────────────────────────────┤
│ 阶段 2: 求解 (CfChallengeService)                        │
│  ┌────────────────────────────────────────────────────┐  │
│  │ HeadlessInAppWebView                               │  │
│  │   ├── 加载 challenge-platform URL                  │  │
│  │   ├── 用户手动点击 Turnstile checkbox              │  │
│  │   ├── JS 拦截 turnstile.render() 回调              │  │
│  │   ├── 提取 cf-turnstile-response token             │  │
│  │   ├── 提取 cf_clearance cookie                     │  │
│  │   └── 提交到服务端完成验证                          │  │
│  └────────────────────────────────────────────────────┘  │
├──────────────────────────────────────────────────────────┤
│ 阶段 3: 自动续期 (CfClearanceRefreshService)             │
│  ┌────────────────────────────────────────────────────┐  │
│  │ 持久隐藏 WebView (不在 UI 中显示)                  │  │
│  │   ├── 维持 Turnstile widget 存活                   │  │
│  │   ├── 拦截 WebView fetch() → 代理 /rc/ API 调用    │  │
│  │   ├── 定期获取新 cf_clearance                      │  │
│  │   └── 自动更新 CookieJar                           │  │
│  └────────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────┘
```

### 7.2 hCaptcha 无障碍支持

```dart
// 辅助完成 hCaptcha 验证
class HCaptchaAccessibilityService {
  // 提供音频挑战替代视觉挑战
  // 自定义验证页面 UI
  // 可配置辅助模式
}
```

---

## 八、实时通信系统

### 8.1 MessageBus 协议实现

Discourse 使用自研的 MessageBus 协议 (HTTP Long-Polling):

```
客户端                                            服务端
  │                                                 │
  │  POST /message-bus/{clientId}/poll              │
  │  Body: [/channel1/msgId, /channel2/msgId, ...]  │
  ├────────────────────────────────────────────────▶│
  │                                                 │ ← 保持连接
  │  ◄ 有消息时立即响应                              │
  │  ◄ 无消息时 60s 后返回空                          │
  │◀────────────────────────────────────────────────┤
  │                                                 │
  │  POST /message-bus/{clientId}/poll              │
  ├────────────────────────────────────────────────▶│
  │  ...循环 Long-Polling                             │
```

### 8.2 Flutter 客户端实现

```dart
class MessageBusService {
  // 订阅频道
  final List<MessageBusSubscription> _subscriptions;

  // 核心频道
  /// /user/{userId}                          - 用户级消息
  /// /notification/{userId}                  - 通知
  /// /notification-alert/{userId}            - 通知提醒 (触发本地推送)
  /// /topic/{topicId}                        - 话题变更
  /// /topic/{topicId}/reactions              - 话题反应
  /// /presence/discourse-presence/reply/{topicId} - 输入状态
  /// /latest                                 - 最新话题
  /// /new                                    - 新话题
  /// /topic-tracking-state/{userId}          - 追踪状态

  // 跨域支持
  /// 主站域名 + CDN 域名自动切换
  /// sharedSessionKey 跨域会话共享

  // 前后台模式
  /// 前台: 保持 Long-Polling 连接
  /// 后台: FlutterForegroundTask (Android) + WorkManager (iOS)
}
```

### 8.3 前后台切换策略

```
┌─────────────────────────────────────────────┐
│ 前台模式                                     │
│  ├── MessageBus Long-Polling 保持连接         │
│  ├── Dio 正常网络请求                         │
│  └── WebView Clearance 自动续期               │
├─────────────────────────────────────────────┤
│ 切换到后台                                   │
│  ├── didChangeAppLifecycleState(paused)      │
│  ├── Android: FlutterForegroundTask          │
│  │   └── 持续运行 notification (保活)         │
│  ├── iOS: WorkManager.periodic (15分钟)       │
│  │   └── callbackDispatcher() 独立 Isolate    │
│  │       ├── 初始化 CookieJar + CSRF Token    │
│  │       ├── 短超时 Poll (10s)                │
│  │       ├── 本地推送通知                      │
│  │       └── 持久化 lastMessageId              │
│  └── Desktop: no-op                          │
├─────────────────────────────────────────────┤
│ 恢复前台                                     │
│  ├── didChangeAppLifecycleState(resumed)     │
│  ├── Debounce 重连 MessageBus                │
│  ├── 重置 lastMessageId 避免丢失消息          │
│  └── 检查剪贴板话题链接                        │
└─────────────────────────────────────────────┘
```

### 8.4 Topic Channel 消息类型

```dart
enum TopicMessageType {
  created,          // 新帖子
  revised,          // 已编辑
  rebaked,          // 重新渲染
  deleted,          // 已删除
  destroyed,        // 已销毁
  recovered,        // 已恢复
  acted,            // 系统操作
  liked,            // 点赞
  unliked,          // 取消点赞
  read,             // 已读
  stats,            // 统计数据更新
  boostAdded,       // 新 Boost
  boostRemoved,     // 删除 Boost
  moveToInbox,      // 移动到收件箱
  archived,         // 已归档
  removeAllowedUser,// 移除允许用户
  policyChanged,    // 政策变更
}
```

---

## 九、数据存储设计

### 9.1 存储分层

| 存储层 | 技术 | 存储内容 | 加密 |
|--------|------|----------|------|
| **设置** | SharedPreferences | 主题/语言/导航/字体/阅读偏好 | 否 |
| **安全凭据** | FlutterSecureStorage | API Key / User Token / CSRF Token | 是 (系统 Keychain/Keystore) |
| **Cookie** | EnhancedCookieJar | 论坛 Session / _t Token / cf_clearance | 是 (AES 加密) |
| **草稿** | DraftController + SP | 未发送的帖子和回复 | 否 |
| **书签** | ReadLaterProvider + SP | 稍后阅读列表 | 否 |
| **历史** | WebHistoryProvider + SP | 浏览历史 | 否 |
| **下载** | DownloadService + local files | 文件下载管理 | 否 |

### 9.2 数据模型

```
models/
├── topic.dart        — Topic, Post, PostStream, TopicDetail,
│                       Tag, Poll, Boost, FlagType
├── user.dart         — User, UserStatus, UserSummary,
│                       CurrentUser, FollowUser
├── notification.dart — NotificationItem
├── category.dart     — Category
├── badge.dart        — Badge
├── bookmark.dart     — Bookmark
├── draft.dart        — Draft (topic/post draft)
├── emoji.dart        — Emoji / EmojiGroup
├── sticker.dart      — Sticker
├── search_result.dart
├── nested_topic.dart
├── topic_vote.dart
├── web_bookmark.dart
├── web_history_item.dart
├── download_item.dart
├── read_later_item.dart
├── mention_user.dart
├── template.dart
├── invite_link.dart
├── cdk_user_info.dart
├── ldc_user_info.dart
├── connect_stats.dart
├── search_filter.dart
├── tag_group.dart
├── tag_search_result.dart
├── profile_stats_config.dart
├── shortcut_binding.dart
└── user_action.dart
```

---

## 十、工程化体系

### 10.1 Monorepo 结构

```
fluxdo/                                  (主包)
├── lib/                                 (核心 Dart 代码)
├── packages/                            (本地包)
│   ├── ai_model_manager/                → AI 模型/对话管理器
│   ├── enhanced_cookie_jar/             → AES 加密 Cookie 存储
│   ├── extended_image_lite/             → 轻量扩展图片 Widget
│   ├── flutter_inappwebview_linux/      → Linux WebView 兼容层
│   ├── pangutext/                       → 中英文自动加空格
│   └── paper_shaders/                   → 纸张纹理着色器
├── core/doh_proxy/                      → Rust DOH 代理 (git 子模块)
├── web/                                 → Flutter Web PWA
├── android/ ios/ windows/ macos/ linux/ → 原生平台代码
├── tool/                                → 工程化脚本
│   ├── project_prep.dart                → 项目初始化 (pub get + l10n + certs)
│   ├── flutterw.dart                    → Flutter 包装器 (自动 prep)
│   ├── project_tasks.dart               → 通用任务 (clean/rebuild/native)
│   ├── release.dart                     → 发版脚本
│   ├── gen_l10n.dart                    → 多语言生成
│   └── build_ipa_nosign.dart            → iOS IPA 无签名构建
└── scripts/ci/                          → CI 打包脚本
    ├── linux/                           → Linux bundle 构建
    └── flatpak/                         → Flatpak 打包
```

### 10.2 构建工具链

```
just (任务运行器, 统一入口)
  │
  ├── just bootstrap  → dart run melos bootstrap
  ├── just sync       → project_prep.dart app
  │                    ├── flutter pub get (所有 workspace 包)
  │                    ├── slang build (生成 l10n 代码)
  │                    └── 同步代理证书到各平台资源目录
  ├── just run        → flutterw.dart run
  │                    ├── project_prep.dart app (自动)
  │                    ├── project_tasks.dart native:prepare (自动)
  │                    └── flutter run (转发参数)
  ├── just build      → flutterw.dart build
  ├── just test       → flutterw.dart test
  ├── just analyze    → flutter analyze
  ├── just release    → release.dart --track release
  ├── just prerelease → release.dart --track prerelease
  └── just ipa        → build_ipa_nosign.dart

flutterw.dart (Flutter 包装器)
  ├── 自动检测是否首次运行 → 执行 project_prep
  ├── 自动检测 native target → 执行 native:prepare
  └── 委托调用 flutter CLI
```

### 10.3 CI/CD 部署矩阵

| 平台 | 产出物 | 构建环境 | 分发方式 |
|------|--------|----------|----------|
| **Android** | APK / AAB | GitHub Actions | GitHub Releases |
| **iOS** | IPA (无签名) | GitHub Actions | AltStore 源 |
| **Windows** | MSIX / 便携版 | GitHub Actions | GitHub Releases |
| **macOS** | DMG / App | GitHub Actions | GitHub Releases |
| **Linux** | Bundle / AppImage | GitHub Actions | GitHub Releases |
| **Flatpak** | Flatpak Package | 容器化构建 | Flathub / 本地 |
| **Web** | PWA | GitHub Actions | N/A |

---

## 十一、安全设计

### 11.1 安全层次

```
┌─────────────────────────────────────────┐
│ 传输层安全                               │
│  ├── DOH DNS 加密 (防 DNS 污染/劫持)     │
│  ├── ECH (Encrypted Client Hello)       │
│  │   └── 加密 TLS 握手中的 SNI 字段       │
│  └── TLS 1.3 + Chrome 密码套件排序      │
├─────────────────────────────────────────┤
│ 会话安全                                 │
│  ├── CSRF Token (_t) 自动提取和注入      │
│  ├── Session Guard (strike counting)    │
│  ├── BAD CSRF 自动重试                   │
│  └── 保守登出策略 (避免误登出)            │
├─────────────────────────────────────────┤
│ 客户端安全                               │
│  ├── Cookie AES 加密持久化               │
│  ├── FlutterSecureStorage (系统级安全)   │
│  ├── 链接安全检查 (LinkSecurity)         │
│  ├── 钓鱼链接警告                        │
│  └── MITM 证书管理 (代理层 TLS 拦截)     │
├─────────────────────────────────────────┤
│ 编译层安全                               │
│  ├── Rust release: LTO + panic=abort    │
│  ├── Rust release: opt-level="z"        │
│  ├── Rust release: strip=true           │
│  └── 代码混淆 (标准 Flutter 混淆)        │
└─────────────────────────────────────────┘
```

### 11.2 具体实现

```dart
// CSRF Token 自动注入
class RequestHeaderInterceptor {
  onRequest(options) {
    options.headers['X-CSRF-Token'] = csrfTokenService.token;
    options.headers['Discourse-Present'] = 'true';
    options.headers['X-Requested-With'] = 'XMLHttpRequest';
  }
}

// 链接安全检查
class LinkSecurity {
  static bool isSuspicious(String url) {
    // 检查 IDN 同形异义字攻击
    // 检查已知恶意域名
    // 检查 http:// 非本地链接
  }
}
```

---

## 十二、架构瓶颈分析

### 12.1 网络层瓶颈

| 问题 | 严重度 | 描述 |
|------|--------|------|
| **拦截器链过长** | 中 | 每次请求穿透 8 层拦截器，其中 RedirectInterceptor / SessionGuardInterceptor 可以合并 |
| **请求调度器保守** | 低 | 固定 1s/10req 窗口，未根据网络状况自适应 |
| **适配器切换无健康检查** | 中 | 仅在初始化或错误时切换，缺少主动健康探测 |
| **Rhttp 超时硬编码** | 低 | 5s 超时无配置入口，弱网环境可能误判 |

### 12.2 缓存层瓶颈

| 问题 | 严重度 | 描述 |
|------|--------|------|
| **CacheManager 各自为政** | 中 | 4 个独立 CacheManager 无统一驱逐策略，可能某个爆满另一个空闲 |
| **DNS 缓存不持久化** | 低 | 进程重启后 DNS 缓存丢失，需要重新解析 |
| **冷启动无预热** | 中 | 首屏数据依赖 PreloadedDataService 的 HTML 解析，慢网络下首屏空白时间长 |
| **图片缓存无分级** | 低 | 所有图片同等对待，未区分头像 (小图常访问) 和帖子图片 (大图偶访问) |

### 12.3 渲染性能瓶颈

| 问题 | 严重度 | 描述 |
|------|--------|------|
| **大帖子 Widget 树深** | 中 | SegmentedLongPost 仅分为 header/chunk/footer，但 chunk 内部的 HTML 渲染仍可能产生深度嵌套 |
| **Isolate 通信开销** | 低 | 每次帖子渲染都需要 Isolate 通信 (分块 + Pangu + 高亮)，可考虑合并为单次 |
| **Sliver 未完全利用** | 低 | topics_page 虽用了 ExtendedNestedScrollView，但帖子列表内部未使用 SliverChildBuilderDelegate 的懒加载 |

### 12.4 架构设计瓶颈

| 问题 | 严重度 | 描述 |
|------|--------|------|
| **DiscourseService 过大** | 中 | 主文件 + 16 个 Mixin = 7000+ 行，部分 Mixin 之间仍有隐式依赖 |
| **页面文件过大** | 中 | topic_detail_page 1700+ 行, topics_page 1700+ 行，缺少 ViewModel/Controller 提取 |
| **Provider 数量膨胀** | 低 | 35+ Provider，部分可合并 (如多个通知相关 Provider) |
| **全局单例过多** | 低 | Services 大量使用单例模式，测试困难 |

### 12.5 安全瓶颈

| 问题 | 严重度 | 描述 |
|------|--------|------|
| **MITM 证书固定 CA** | 中 | 使用嵌入式 CA 证书，支持用户自签可增强安全 |
| **缺少请求完整性校验** | 中 | API 请求无签名/校验，若绕过证书校验存在中间人风险 |
| **前端安全依赖系统信任** | 低 | 所有安全链的根凭据存储在设备本地 |

---

## 十三、优化方向建议

### 13.1 网络层优化

#### 13.1.1 合并轻量级拦截器

```
当前：8 个独立拦截器
建议：
  保留独立: RequestSchedulerInterceptor, CfChallengeInterceptor,
            NetworkLogInterceptor, ErrorInterceptor
  合并:     RedirectInterceptor + SessionGuardInterceptor
           → SessionRedirectInterceptor
  合并:     RequestHeaderInterceptor 功能内嵌到 Dio Transformer
  合并:     CronetFallbackInterceptor 移入 PlatformAdapter 错误处理

优化后：5 个拦截器 (-37%)
```

#### 13.1.2 适配器健康检查

```dart
// 新增：定期主动探测各适配器健康状态
class AdapterHealthChecker {
  Timer _timer; // 每 30s 探测一次

  Future<Map<AdapterType, bool>> checkAll();
  // → PlatformAdapter 根据健康状态动态调整优先级
  // → 不等待请求出错才切换
}
```

#### 13.1.3 自适应限流

```dart
// 改进：基于令牌桶的自适应限流
class AdaptiveRateLimiter {
  // 根据 API 响应时间动态调整 rate
  // P99 延迟 < 500ms → 增加并发至 5
  // P99 延迟 > 2000ms → 减少并发至 2
  // Error Rate > 5% → 窗口减半
}
```

#### 13.1.4 Rhttp 可配置超时

```dart
// 通过 preferences 暴露 Rhttp 超时配置
// 默认 5s, 弱网环境可设置 15s
class NetworkSettings {
  final int rhttpInitTimeoutMs;  // 用户可配置
  final int rhttpRequestTimeoutMs;
}
```

### 13.2 缓存优化

#### 13.2.1 统一缓存管理器

```dart
// 新增：UnifiedCacheManager 统筹所有缓存
class UnifiedCacheManager {
  final List<CacheManager> _managers;
  final int _totalMaxSizeBytes = 200 * 1024 * 1024; // 200MB 总上限

  // 统一驱逐策略
  // LRU (Least Recently Used) 全局排序
  // 某个 Manager 超过配额时从最久未使用的条目开始驱逐
  // 优先级: Sticker > Emoji > Discourse > External
}
```

#### 13.2.2 DNS 缓存持久化

```dart
// 将 DNS 缓存和 IP 惩罚列表持久化到本地
// 进程重启后快速恢复
class DnsCachePersistence {
  Future<void> save(DnsCacheData data);
  Future<DnsCacheData?> load();
  // 使用 SharedPreferences 或独立文件存储
}
```

#### 13.2.3 分级图片缓存

```dart
// 区分不同场景
class TieredImageCache {
  // Tier 1: 头像 (30x30 - 120x120) → 内存缓存, 永不过期
  // Tier 2: 缩略图 (200x200) → 磁盘缓存, 7 天
  // Tier 3: 原图 (>200x200) → 磁盘缓存, 3 天, 按需下载
}
```

#### 13.2.4 首屏骨架屏 + 预加载

```dart
// 首屏加载优化
class ImprovedPreloadStrategy {
  // 1. 显示骨架屏 (Skeleton) 而非空白
  // 2. PreloadedDataService 超时 3s 后直接发起 API 请求
  // 3. 预加载 high-priority avatars
  // 4. 后台预取常用表情包
}
```

### 13.3 渲染性能优化

#### 13.3.1 进一步分块渲染

```dart
// 长帖 (>5000字) 使用 Virtualized Rendering
class VirtualizedPostRenderer {
  // 使用 SliverList + builder 懒渲染
  // 每个段落 (<p> / <div>) 作为一个 Sliver item
  // 离开视口的段落自动回收
}
```

#### 13.3.2 合并 Isolate 处理

```dart
// 将 HTML 分块 + Pangu 排版 + 代码高亮 合并为单个 Isolate 调用
class PostProcessingPipeline {
  Future<ProcessedPost> process(String rawHtml, String language) {
    // 单次 Isolate 通信 → 返回完整处理结果
    // 减少序列化/反序列化开销
  }
}
```

#### 13.3.3 预构建 Widget 模板

```dart
// 对高频出现的 HTML 模式预构建 Widget
class WidgetTemplateCache {
  // 缓存常见模式: 单图 + 单行文字
  // 缓存常见模式: 代码块 + 语言标签
  // 避免重复解析相同结构的 HTML
}
```

### 13.4 架构重构建议

#### 13.4.1 DiscourseService 拆分为 Repository

```
当前: DiscourseService (16 Mixins, 7000+ lines)

建议:
  lib/
  ├── repositories/
  │   ├── topic_repository.dart       (~400 lines)
  │   ├── post_repository.dart        (~300 lines)
  │   ├── user_repository.dart        (~300 lines)
  │   ├── notification_repository.dart(~200 lines)
  │   ├── search_repository.dart      (~200 lines)
  │   ├── category_repository.dart    (~150 lines)
  │   └── upload_repository.dart      (~200 lines)
  └── services/discourse/
      └── discourse_api_client.dart   (仅 API 配置 + 拦截器)
```

#### 13.4.2 页面瘦身为 ViewModel + View

```dart
// topic_detail_page.dart (当前 1700+ 行)
// 重构为:
class TopicDetailViewModel extends AsyncNotifier<TopicDetailState> {
  // 所有业务逻辑和状态
  Future<void> loadTopic(String topicId);
  Future<void> likePost(int postId);
  Future<void> reply(String content);
}

class TopicDetailView extends ConsumerWidget {
  // 纯 UI, < 500 行
  Widget build(BuildContext context, WidgetRef ref) {
    final state = ref.watch(topicDetailViewModelProvider);
    // ...
  }
}
```

#### 13.4.3 合并 Provider

| 当前 | 建议 |
|------|------|
| notification_list_provider + recent_notifications_provider | 合并为 `unified_notification_provider` |
| topic_detail_provider + selected_topic_provider | 合并到 topic_detail_view_model |
| search_provider + search_settings_provider | 合并为 `unified_search_provider` |

### 13.5 安全增强

#### 13.5.1 支持用户自签 CA

```dart
// 允许用户生成自己的 CA 证书
class UserCertificateManager {
  Future<({String certPem, String keyPem})> generateUserCA();
  Future<void> importCA(String certPem, String keyPem);
  // 替代嵌入式固定 CA
}
```

#### 13.5.2 API 请求签名

```dart
// 为关键 API 添加 HMAC 签名
class ApiRequestSigner {
  // 可选: 用于防止代理层篡改
  // 非强制: 因 Discourse API 本身通过 HTTPS 保护
  // 仅在启用 MITM 代理时需要
  String sign(String endpoint, String method, String body);
}
```

#### 13.5.3 审计日志

```dart
// 安全事件审计
class SecurityAuditLogger {
  void logLogin(String userId, String ip);
  void logFailedLogin(String reason);
  void logTokenRotation(String oldToken, String newToken);
  void logSuspiciousRequest(String url, String risk);
}
```

### 13.6 工程化改进

#### 13.6.1 自动化测试

```
当前: test/ 目录基本为空, 无单元测试/Widget测试
建议:
  ├── test/
  │   ├── unit/
  │   │   ├── models/        → 数据模型序列化测试
  │   │   ├── services/      → DiscourseService mock 测试
  │   │   └── providers/     → Provider 状态测试
  │   ├── widget/            → 关键 Widget 测试
  │   └── integration/       → 端到端流程测试
  └── 覆盖率目标: ≥ 60%
```

#### 13.6.2 性能监控

```dart
// 增加性能埋点
class PerformanceTracker {
  // 首屏渲染耗时
  void trackFirstFrameTime(Duration time);
  // 网络请求耗时分布 (P50/P90/P99)
  void trackApiLatency(String endpoint, Duration time);
  // 内存使用
  void trackMemoryUsage(int bytes);
  // Crates: sentry / firebase_performance
}
```

#### 13.6.3 错误边界

```dart
// 在关键页面增加错误边界
class TopicDetailErrorBoundary extends StatelessWidget {
  // 捕获 Widget 构建异常
  // 显示降级 UI 而非空白/崩溃
  // 上报异常日志
}
```

---

## 附录 A: 关键文件索引

| 文件 | 行数 | 用途 |
|------|------|------|
| `lib/main.dart` | ~600 | 应用启动 + MainPage Shell |
| `lib/pages/topic_detail_page.dart` | ~1736 | 话题详情页 (最复杂页面) |
| `lib/pages/topics_page.dart` | ~1727 | 话题列表页 |
| `lib/services/discourse/` (16 files) | ~7000 | Discourse API 层 |
| `lib/services/network/adapters/platform_adapter.dart` | ~393 | 多适配器调度 |
| `lib/services/network/interceptors/` (8 files) | ~1500 | 拦截器链 |
| `lib/services/network/doh/network_settings_service.dart` | ~750 | DOH 配置管理 |
| `lib/services/message_bus_service.dart` | ~500 | 实时消息 |
| `lib/services/cf_challenge_service.dart` | ~400 | CF 挑战处理 |
| `lib/models/topic.dart` | ~1747 | 话题数据模型 |
| `lib/widgets/content/discourse_html_content_widget.dart` | ~1100 | HTML 渲染引擎 |
| `lib/widgets/post/post_item.dart` | ~500 | 帖子卡片 |
| `core/doh_proxy/src/proxy.rs` (Rust) | ~26KB | 代理服务器核心 |
| `core/doh_proxy/src/dns.rs` (Rust) | ~42KB | DNS 解析器 |
| `core/doh_proxy/src/ech.rs` (Rust) | ~22KB | ECH TLS 连接器 |

## 附录 B: 依赖关系总图

```
                        ┌──────────────────────────────┐
                        │     Flutter App Entry         │
                        │     main.dart + MainApp       │
                        └──────────────┬───────────────┘
                                       │
                   ┌───────────────────┼───────────────────┐
                   │                   │                   │
          ┌────────▼────────┐  ┌──────▼──────┐  ┌────────▼────────┐
          │   Riverpod      │  │   Pages     │  │   Widgets       │
          │   Providers     │  │   (45+)     │  │   (17 groups)   │
          └────────┬────────┘  └──────┬──────┘  └────────┬────────┘
                   │                  │                  │
          ┌────────▼──────────────────▼──────────────────▼────────┐
          │                 Service Layer                         │
          │  ┌──────────────┐ ┌───────────────┐ ┌──────────────┐ │
          │  │ Discourse    │ │ MessageBus    │ │ CfChallenge  │ │
          │  │ Service      │ │ Service       │ │ Service      │ │
          │  └──────┬───────┘ └───────┬───────┘ └──────┬───────┘ │
          └─────────┼─────────────────┼────────────────┼─────────┘
                    │                 │                │
          ┌─────────▼─────────────────▼────────────────▼─────────┐
          │                   Network Layer                       │
          │  ┌───────────────────────────────────────────────────┐│
          │  │ discourse_dio.dart → Dio + 8 Interceptors         ││
          │  └─────────────────────┬─────────────────────────────┘│
          │                        │                              │
          │  ┌─────────────────────▼─────────────────────────────┐│
          │  │ platform_adapter.dart                             ││
          │  │  ├── RhttpAdapter    (Rust reqwest via FFI)       ││
          │  │  ├── NetworkAdapter  (localhost DOH proxy)        ││
          │  │  ├── NativeAdapter   (Cronet / Cupertino / IO)    ││
          │  │  └── WebViewAdapter  (system WebView)             ││
          │  └─────────────────────┬─────────────────────────────┘│
          └────────────────────────┼──────────────────────────────┘
                                   │
          ┌────────────────────────▼──────────────────────────────┐
          │              Cache & Storage Layer                     │
          │  ┌────────────┐ ┌──────────┐ ┌──────────────────────┐ │
          │  │ 4 Cache    │ │ Cookie   │ │ SharedPrefs +        │ │
          │  │ Managers   │ │ Jar      │ │ SecureStorage        │ │
          │  └────────────┘ └──────────┘ └──────────────────────┘ │
          └───────────────────────────────────────────────────────┘
                                   │
          ┌────────────────────────▼──────────────────────────────┐
          │              Rust DOH Proxy (独立进程/FFI)              │
          │  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐ │
          │  │ DNS.rs   │ │ ECH.rs   │ │ Proxy.rs │ │ Cert.rs  │ │
          │  │ (DOH)    │ │ (SNI)    │ │ (Server) │ │ (MITM)   │ │
          │  └──────────┘ └──────────┘ └──────────┘ └──────────┘ │
          └───────────────────────────────────────────────────────┘
                                   │
                    ┌──────────────┼──────────────┐
                    │              │              │
              ┌─────▼─────┐  ┌────▼────┐  ┌─────▼──────┐
              │  SOCKS5   │  │ Shadow │  │  External  │
              │  Proxy    │  │ socks  │  │  Internet  │
              └───────────┘  └────────┘  └────────────┘
```

---

*本文档基于 FluxDO v0.2.15 源码分析生成，分析日期 2026-05-21。*
