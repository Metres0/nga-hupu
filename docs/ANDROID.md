# Android / Flutter 移植指南

## 架构兼容性

本项目设计时已考虑跨平台移植：

| 层 | Web 实现 | Android/Flutter 等价物 |
|----|----------|----------------------|
| 数据模型 | `src/lib/types.ts` | Dart class |
| BBCode 解析 | `src/lib/parser/bbcode.ts` | Dart function (纯函数，无 DOM) |
| 回复树 | `src/lib/reply-tree.ts` | Dart class |
| API 通信 | `fetch()` + JSON | `http` package |
| 图片 | `/api/v1/image-proxy` | 同一代理接口 |
| UI | Tailwind Glass | `BackdropFilter` + `ClipRRect` |

## 数据模型映射 (TypeScript → Dart)

```dart
// lib/models/thread.dart
class Thread {
  final int tid;
  final int fid;
  final String title;
  final String author;
  final int authorId;
  final int createTime;
  final int lastReplyTime;
  final int replyCount;
  final bool sticky;
  final bool digest;
  final List<String> categories;
  final int pageCount;

  Thread({required this.tid, required this.fid, ...});
  
  factory Thread.fromJson(Map<String, dynamic> json) => Thread(
    tid: json['tid'],
    fid: json['fid'],
    title: json['title'],
    author: json['author'],
    authorId: json['authorId'] ?? 0,
    createTime: json['createTime'],
    lastReplyTime: json['lastReplyTime'],
    replyCount: json['replyCount'],
    sticky: json['sticky'] ?? false,
    digest: json['digest'] ?? false,
    categories: List<String>.from(json['categories'] ?? []),
    pageCount: json['pageCount'] ?? 1,
  );
}

// lib/models/post.dart
class Post {
  final int pid;
  final int tid;
  final String author;
  final String content;
  final String contentHtml;
  final int createTime;
  final int? replyTo;
  final int floor;
  final List<String> images;
  final int likes;

  Post({...});
  factory Post.fromJson(Map<String, dynamic> json) => ...;
}
```

## BBCode 解析器 (TypeScript → Dart)

核心解析逻辑为纯函数，直接翻译即可：

```dart
// lib/parser/bbcode.dart
String bbcodeToHtml(String raw) {
  if (raw.isEmpty) return '';
  String html = raw;
  
  // [b] bold [/b]
  html = html.replaceAll(RegExp(r'\[b\](.*?)\[/b\]', caseSensitive: false, dotAll: true), '<strong>\$1</strong>');
  
  // [img] url [/img]
  html = html.replaceAllMapped(
    RegExp(r'\[img\](https?://[^\[]+?\.(?:jpg|jpeg|png|gif|webp|bmp)[^\[]*?)\[/img\]', caseSensitive: false),
    (m) => '<img src="${proxyImgUrl(m.group(1)!)}" loading="lazy" class="bb-img" />',
  );
  
  // [quote] ... [/quote]
  html = html.replaceAll(RegExp(r'\[quote\](.*?)\[/quote\]', dotAll: true), '<blockquote>\$1</blockquote>');
  
  // ... (transcribe all tags from bbcode.ts)
  
  return html;
}

String proxyImgUrl(String url) {
  return '/api/v1/image-proxy?url=${Uri.encodeComponent(url)}';
}
```

## API 调用

```dart
// lib/api/nga_client.dart
import 'dart:convert';
import 'package:http/http.dart' as http;

class NgaClient {
  final String baseUrl;

  NgaClient(this.baseUrl);

  Future<List<Thread>> getForumThreads(int fid, {int page = 1}) async {
    final res = await http.get(Uri.parse('$baseUrl/api/v1/forums/$fid?page=$page'));
    final json = jsonDecode(res.body);
    return (json['data'] as List).map((t) => Thread.fromJson(t)).toList();
  }

  Future<ThreadDetail> getThreadDetail(int tid, {int page = 1}) async {
    final res = await http.get(Uri.parse('$baseUrl/api/v1/threads/$tid?page=$page'));
    final json = jsonDecode(res.body);
    return ThreadDetail(
      thread: Thread.fromJson(json['thread']),
      posts: (json['posts'] as List).map((p) => Post.fromJson(p)).toList(),
      totalPages: json['totalPages'],
    );
  }
}
```

## 液态玻璃 UI (Flutter)

```dart
// lib/widgets/glass_card.dart
import 'package:flutter/material.dart';

class GlassCard extends StatelessWidget {
  final Widget child;
  final VoidCallback? onTap;

  const GlassCard({required this.child, this.onTap});

  @override
  Widget build(BuildContext context) {
    return ClipRRect(
      borderRadius: BorderRadius.circular(16),
      child: BackdropFilter(
        filter: ImageFilter.blur(sigmaX: 20, sigmaY: 20),
        child: Container(
          decoration: BoxDecoration(
            color: Colors.white.withOpacity(0.1),
            borderRadius: BorderRadius.circular(16),
            border: Border.all(color: Colors.white.withOpacity(0.2)),
            boxShadow: [
              BoxShadow(color: Colors.black.withOpacity(0.2), blurRadius: 16, offset: Offset(0, 8)),
            ],
          ),
          child: Material(
            color: Colors.transparent,
            child: InkWell(
              borderRadius: BorderRadius.circular(16),
              onTap: onTap,
              child: child,
            ),
          ),
        ),
      ),
    );
  }
}
```

## 图片画廊

```dart
// lib/widgets/image_gallery.dart
// 使用 cached_network_image 缓存图片
// 使用 photo_view 实现灯箱双击缩放
// 所有图片 URL 经过 proxyUrl() 处理

String proxyUrl(String src) {
  if (src.startsWith('/api') || src.startsWith('data:')) return src;
  return '/api/v1/image-proxy?url=${Uri.encodeComponent(src)}';
}
```

## 回复树

```dart
// lib/utils/reply_tree.dart
// 直接翻译 src/lib/reply-tree.ts
// buildReplyTree() + flattenTree() 两个纯函数

class ReplyNode {
  final Post post;
  final int depth;
  final List<ReplyNode> children;
}

List<ReplyNode> buildReplyTree(List<Post> posts) { ... }
List<MapEntry<Post, int>> flattenTree(List<ReplyNode> nodes) { ... }
```

## 推荐 Flutter 依赖

```yaml
dependencies:
  http: ^1.2.0
  cached_network_image: ^3.3.0
  photo_view: ^0.15.0
  flutter_blurhash: ^0.8.0
  url_launcher: ^6.2.0
  intl: ^0.19.0
```

## 数据预加载 (Flutter)

```dart
// 在论坛列表页，使用 FutureBuilder 预取可见线程
class ForumPage extends StatefulWidget { ... }

class _ForumPageState extends State<ForumPage> {
  final _prefetchCache = <int, Future<ThreadDetail>>{};

  void _prefetchThread(int tid) {
    if (!_prefetchCache.containsKey(tid)) {
      _prefetchCache[tid] = NgaClient(baseUrl).getThreadDetail(tid);
    }
  }

  @override
  Widget build(BuildContext context) {
    return ListView.builder(
      itemCount: threads.length,
      itemBuilder: (ctx, i) {
        final thread = threads[i];
        // Prefetch when item enters viewport
        _prefetchThread(thread.tid);
        return ThreadCard(thread: thread);
      },
    );
  }
}
```
