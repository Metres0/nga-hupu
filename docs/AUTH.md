# NGA 镜像站 — 账号登录策略文档 v5.7

> 最后更新: 2026-05-23 | 引擎版本: RSA v4.0 + 超时压缩 + Cookie 快照恢复
> v5.7: SSR 登录检测改用 getSession() | v5.0: 登录时延 -50% | v4.11: 内存缓存 + 续期 jitter

---

## 一、概述

NGA (bbs.nga.cn) 部分板块需要登录后才能访问（如晴风村 fid=-7955747）。本项目实现了基于 Playwright 自动化 + RSA 公钥加密的三层登录引擎，支持验证码识别、Cookie 持久化和自动续期。

### 登录架构

```
┌─────────────────────────────────────────────────────────┐
│  FRONTEND                                               │
│  LoginDialog.tsx  →  POST /api/v1/auth/login            │
│                   →  POST /api/v1/auth/login/verify     │
│  Sidebar.tsx      →  GET  /api/v1/auth/status           │
│  AuthGate.tsx     →  受限板块守卫                        │
└─────────────┬───────────────────────────────────────────┘
              │
┌─────────────▼───────────────────────────────────────────┐
│  BACKEND (login-engine.ts)                              │
│                                                         │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐   │
│  │ L1: RSA 引擎  │  │ L2: XPath    │  │ L3: Legacy   │   │
│  │ (默认/推荐)    │  │ (nuke iframe)│  │ (iframe回退)  │   │
│  │              │  │              │  │              │   │
│  │ nuke.php     │  │ nuke.php     │  │ nuke.php     │   │
│  │ _submit直调   │  │ #iff iframe  │  │ frame扫描     │   │
│  │ RSA加密密码   │  │ CSS选择器     │  │ CSS选择器     │   │
│  │ _encrypt()    │  │              │  │              │   │
│  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘   │
│         │                  │                  │          │
│         └──────────┬───────┴──────────────────┘          │
│                    ▼                                     │
│         ┌─────────────────────┐                          │
│         │ session-store.ts    │                          │
│         │ AES-256-GCM 加密    │                          │
│         │ SQLite auth_sessions│                          │
│         └─────────┬───────────┘                          │
│                   ▼                                      │
│         ┌─────────────────────┐                          │
│         │ credential-store.ts │                          │
│         │ 凭据加密存储         │                          │
│         └─────────┬───────────┘                          │
│                   ▼                                      │
│         ┌─────────────────────┐                          │
│         │ auto-renew.ts       │                          │
│         │ 自动续期(7天)        │                          │
│         └─────────────────────┘                          │
└─────────────────────────────────────────────────────────┘
```

---

## 二、L1: RSA 引擎（默认）

### 2.1 技术原理

NGA 登录密码须经 RSA 公钥加密后提交。浏览器端通过 `jsencrypt.js` 暴露 `_encrypt()` 函数。本项目通过 Playwright 注入 JavaScript，直接调用 NGA 的 `_submit()` / `_encrypt()` 完成登录。

### 2.2 RSA 公钥

```
-----BEGIN PUBLIC KEY-----
MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAyKzZWDimCN1OCprqWUhF
UPhcwxDE62/BFVP6LtQHJu+65dm4YNmDvzitmcfaXW9YbhXnd4oP7j+6vpcgJQ+p
3ucySo1ZnqO0Bb2JKEtxpCmxe7IYXhFEkJqHpFYBTiAxQz2n2mX4JZy/ehBUSMjz
gzd0NdG6Ai1C42oCzYltUOjNWZUNHn1nqpElSWHnUWqkdN8+5ISP/ZMKiQdFANkE
qDGw3/34qyF+E/hVgrGF4/CcWNP/LJCdB6DYtx7VPlQZF0tP1s+q/++rC4rQ2wmV
l2V8zGh1j7ojZbt62hVjy6byK1E/2XYo97ZtL4KDW7F5jJMvSDRFR7901UR8hCdf
4wIDAQAB
-----END PUBLIC KEY-----
```

### 2.3 登录流程

```
startLoginRSA(username, password, saveCredential)
  │
  ├── 1. goto("https://bbs.nga.cn/nuke.php?__lib=login&__act=account&login")
  │       UA: Nga_Official/9.9.9 (移动端)
  │       Viewport: 390×844
  │
  ├── 2. 进入 account_copy.html iframe
  │       设置 window.__client |= 4   ← 强制 Web 验证码模式
  │       覆写 window._checkCodeInput  ← 只在 captcha 已填时返回 true
  │
  ├── 3. 填入表单:
  │       document.getElementById("name").value = username
  │       document.getElementById("password").value = plainPassword
  │       check(checkbox)  ← 同意协议
  │
  ├── 4. 调用 _checkCodeInput(loginBtn, "login")
  │       → NGA JS 创建 captcha UI (img + input + 按钮)
  │
  ├── 5. 轮询 img[src*="check_code"].complete
  │       → 截图 → 返回 base64 到前端
  │
  └── 6. 返回: { success: false, captcha: "base64...", sessionId, error: "请输入验证码" }

verifyCaptchaRSA(sessionId, "027222")
  │
  ├── 1. frame.evaluate: 设置 __checkCode = "027222"
  │      调用 _encrypt(password) → RSA 密文
  │      调用 _submit(loginBtn, callback,
  │         "__lib", "login",
  │         "__act", "login",
  │         "__output", "8",
  │         "name", username,
  │         "type", "",
  │         "password", encryptedPW
  │       )
  │
  ├── 2. Callback: _xhrParseJs 解析响应
  │      ├── y.error  → 存储到 __loginError
  │      └── y.data[3] → __appDoAction("loginSuccess", ...)
  │           → 父级 nuke.php 提交隐藏表单 → 设置 Cookies
  │
  ├── 3. 轮询 cookies (10 次 × 2s)
  │      检查 ngaPassportUid 是否非 "guest"
  │      如有 → finishLoginHelper
  │
  └── 4. finishLoginHelper:
         ctx.cookies() → 过滤 → createSession(username, allCookies)
         → AES-256-GCM 加密 → SQLite auth_sessions
```

### 2.4 `_checkCodeInput` 覆写策略

```javascript
// 原始行为: mobile UA 下 __client&4==0 → 跳过 captcha → 返回 undefined
// 覆写后:   设置 __client|=4 → 强制 captcha 模式
//           只在 __checkCode 已设置时返回 true（允许提交）
//           否则返回 undefined（阻止提交，等待验证码）

w._checkCodeInput = function (o, frm) {
    if (frm === "login") {
        orig.call(window, o, frm);                          // 创建 captcha UI
        if (w.__checkCode && String(w.__checkCode).length > 0) {
            return true;                                     // 验证码已填 → 提交
        }
        return undefined;                                    // 等待验证码
    }
    return orig.call(window, o, frm);
};
```

---

## 三、L2: XPath 引擎

备用引擎，通过 `nuke.php` 页面中的 `#iff` iframe 交互。

- URL: `nuke.php?__lib=login&__act=account&login`
- 使用 `page.frameLocator("#iff")` 定位 iframe
- CSS 选择器: `#name, #password, a:has-text("登 录")`
- Captcha 检测: 扫描所有 frames 中 `img[src*="captcha"]`

---

## 四、L3: Legacy 引擎

最原始的实现，iframes 扫描 + 文本匹配。作为最后的后备。

---

## 五、Cookie 持久化

### 5.1 加密方案

- 算法: **AES-256-GCM** (Node.js `crypto` 模块)
- 密钥: `AUTH_ENCRYPT_KEY` 环境变量 (SHA-256 哈希)
- 格式: `iv(16B) + authTag(16B) + ciphertext` → Base64

### 5.2 存储

```sql
CREATE TABLE IF NOT EXISTS auth_sessions (
  id TEXT PRIMARY KEY,           -- UUID
  username TEXT NOT NULL,
  encrypted_cookies TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL    -- 7 天
);
```

### 5.3 Cookie 注入

```
scraper engine
  → getDecryptedCookies()
  → newPage(cookieStr)
    → ctx.addCookies(cookieStr.split("; ")
        .map(pair => ({ name, value, domain: ".nga.cn", path: "/" }))
```

---

## 六、自动续期

### 6.1 凭据存储

```sql
CREATE TABLE IF NOT EXISTS credentials (
  id TEXT PRIMARY KEY,
  username TEXT NOT NULL UNIQUE,
  encrypted_password TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
```

### 6.2 续期流程

```
instrumentation.ts (每 30 分钟)
  → renewSessions()
    → getSession() → 检查是否 3h 内过期
    → getCredential() → 解密存储的密码
    → startLoginRSA(username, password, true) → 重登录
    → createSession → 更新 Cookie
```

---

## 七、受限板块机制

### 7.1 插件标记

```typescript
// src/plugins/spring-wind-village.ts
const plugin: ForumConfig = {
  fid: -7955747,
  name: "晴风村",
  requiresLogin: true,   // ← 标记为需要登录
};
```

### 7.2 前端守卫

- `AuthGate.tsx`: 包裹需要登录的页面组件，未登录时展示"去登录"引导页
- `BoardCard.tsx`: `requiresLogin` 板块显示 🔒 标记，未登录时 50% 透明度 + 点击拦截
- `Sidebar.tsx`: 订阅列表中的受限板块在未登录时显示 🔒 图标
- `GlassNav.tsx`: 受限板块导航栏显示绿色/橙色状态点

---

## 八、验证码处理

### 8.1 流程

```
_startLoginRSA:
  _checkCodeInput(loginBtn, "login")
  → NGA JS 创建 captcha img (login_check_code.php)
  → Playwright 轮询 img.complete && naturalWidth > 10
  → element.screenshot({ type: "png" })
  → base64 返回前端 LoginDialog 显示

_verifyCaptchaRSA:
  frame.evaluate: __checkCode = userInput
  _encrypt(plainPassword) + _submit(...)
  → callback: y.error? → 存储错误 | y.data[3]? → loginSuccess
```

### 8.2 刷新策略

- 刷新按钮 → `captchaCode = ""` → `verifyCaptchaRSA` 刷新分支
- 优先点击 NGA 的 "换一个" 链接
- 后备: 修改 `img.src` URL 重新加载
- 最后: 重新调用 `_checkCodeInput` 完全重建

### 8.3 错误处理

| 错误 | 含义 | 处理 |
|------|------|------|
| "图形验证码错误" | CAPTCHA 不匹配 | 自动刷新新验证码 |
| "缺少图形验证码" | 未加载验证码 | 触发 `_checkCodeInput` |
| "参数错误" | 请求格式问题 | 切换 `__output` 格式 |
| "返回数据错误" | 响应解析失败 | 回退到 L2 引擎 |
| "Unsupported state" | AES 解密失败 | 清空旧 sessions |

---

## 九、安全说明

- Cookie 经 AES-256-GCM 加密存储于本地 SQLite，密钥由 `AUTH_ENCRYPT_KEY` 控制
- 凭据（用户名+密码）同样加密存储，仅用于自动续期
- 所有网络通信通过 HTTPS (NGA 官方)
- RSA 密码加密使用 NGA 官方公钥
- 项目中不包含任何用户凭据的明文日志

---

## 十、已知限制

1. 限制网页只能登录一个账号（`getSession` 返回最近一个）
2. 验证码需人工输入（无 OCR 自动识别）
3. NGA 改版可能导致 XPath/CSS 选择器失效
4. 自动续期依赖浏览器 Chromium 进程
5. `account_copy.html` 直接访问在桌面 UA 下有 JS 错误（需通过 nuke.php iframe 访问）

---

## 十一、v5.0 性能基准

### 登录时延 (RSA 引擎)

| 阶段 | v4.11 | v5.0 | 改善 |
|------|-------|------|------|
| page.goto + 初始等待 | 2s | 1s | -50% |
| captcha 检测轮询 | 12s (6×2s) | 4s (4×1s) | -67% |
| post-submit 等待 | 5s | 2s | -60% |
| Cookie 确认轮询 | 20s (10×2s) | 9s (6×1.5s) | -55% |
| **总计 (无验证码)** | **~3s** | **~1.5s** | **-50%** |
| **总计 (有验证码+人工)** | **~5s** | **~3s** | **-40%** |

### 跨上下文 Cookie 恢复 (v5.0 新增)

```
/login 返回 captcha 时:
  ① ctx.cookies() 全量捕获
  ② 存入 session._captchaCookies
  ③ ctx 保持打开 (5min TTL 兜底)

/verify 时:
  ① frame 恢复 (keep existing logic)
  ② ctx.addCookies(session._captchaCookies)  ← 恢复会话
  ③ 填入验证码 → submit → 轮询 Cookie

效果: PHPSESSID 一致, 验证码 session 不失效
```
