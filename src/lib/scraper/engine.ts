import type { Thread, ThreadDetail } from "@/lib/types";
import { newPage, closeBrowser, skipAdIfPresent } from "./browser";
import { extractThreadList, extractThreadDetail } from "./extractor";
import { resolveReplyTargets } from "./parser";
import { withRetry } from "@/lib/middleware/retry";
import { NetworkError, ServerError } from "@/lib/middleware/error-handler";
import { getDecryptedCookies } from "@/lib/auth/session-store";

function classifyStatus(status: number): void {
  if (status === 403) throw new NetworkError("NGA 拒绝访问 (403)");
  if (status >= 500) throw new ServerError(`服务端错误 (${status})`, status);
}

// Fast-path circuit breaker: when NGA starts blocking fetch requests,
// temporarily disable fast path to avoid cascading Playwright fallbacks.
// Adaptive windows: short bursts → short cooldown; sustained blocks → exponential backoff.
let _fastFails = 0;
const _circuit: { open: boolean; until: number } = { open: false, until: 0 };

function breakerWindow(failures: number): number {
  if (failures <= 2)  return 30 * 1000;       // 30s
  if (failures <= 5)  return 2 * 60 * 1000;   // 2min
  if (failures <= 10) return 10 * 60 * 1000;  // 10min
  return 60 * 60 * 1000;                       // 1h
}

function tryFastPath(): boolean {
  if (!_circuit.open) return true;
  if (Date.now() >= _circuit.until) {
    // Half-open: allow one probe request from real user (not prefetch)
    _circuit.open = false;
    return true;
  }
  return false;
}

function recordFastSuccess() {
  _fastFails = 0;
  _circuit.open = false;
}

function recordFastFailure() {
  _fastFails++;
  _circuit.open = true;
  _circuit.until = Date.now() + breakerWindow(_fastFails);
  console.log(`[Scraper] Fast-path circuit breaker OPEN (${_fastFails} fails, ${Math.round(breakerWindow(_fastFails)/1000)}s) — NGA may be rate-limiting`);
}

// Strip NGA JavaScript from post content (ubbcode.attach.load, commonui.*, etc.)
function cleanPostHtml(html: string): string {
  // Remove ubbcode.attach.load() calls using balanced parenthesis matching
  const startTag = "ubbcode.attach.load(";
  let idx = html.indexOf(startTag);
  while (idx !== -1) {
    let depth = 0;
    let end = idx + startTag.length;
    for (; end < html.length; end++) {
      if (html[end] === "(") depth++;
      if (html[end] === ")") { if (depth === 0) break; depth--; }
    }
    if (end < html.length && html[end] === ")") {
      let after = end + 1;
      while (after < html.length && (html[after] === " " || html[after] === ";")) after++;
      html = html.substring(0, idx) + html.substring(after);
    } else break;
    idx = html.indexOf(startTag);
  }
  html = html.replace(/显示全部附件/g, "");
  html = html.replace(/commonui\.\w+\s*\([^)]*\)\s*;?/g, "");
  html = html.replace(/改动在\d{4}-\d{2}-\d{2}\s*\d{2}:\d{2}修改/g, "");
  html = html.replace(/#\d+\s+\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}\s+\d+/g, "");
  return html;
}

export async function scrapeThreadList(
  fid: number,
  page: number = 1
): Promise<{
  threads: Thread[];
  totalPages: number;
  forumName: string;
  subForums: Array<{ fid: number; name: string }>;
}> {
  const url = `https://bbs.nga.cn/thread.php?fid=${fid}&page=${page}`;
  const cookieStr = getDecryptedCookies() ?? undefined;

  // Fast path: fetch + Cheerio (no Playwright overhead, ~300ms)
  // Circuit breaker: skip fast path if NGA is blocking fetch requests
  if (tryFastPath()) {
    const fastResult = await scrapeThreadListFast(url, fid, cookieStr);
    if (fastResult) {
      recordFastSuccess();
      return fastResult;
    }
    recordFastFailure();
  }

  // Degraded mode: circuit breaker open → skip Playwright → return null
  // Caller (API route) should fall back to stale SQLite cache
  if (_circuit.open) {
    console.log("[Scraper] Circuit breaker open — returning null for stale cache fallback");
    return { threads: [], totalPages: 1, forumName: "", subForums: [] };
  }

  // Fallback: Playwright full browser (for anti-bot or JS-required pages)
  return withRetry(async () => {
    const p = await newPage(cookieStr);
    try {
      console.log(`[Scraper/Playwright] 抓取板块列表: ${url}`);
      const resp = await p.goto(url, { waitUntil: "domcontentloaded", timeout: 20000 });
      if (!resp || resp.status() !== 200) {
        if (resp) classifyStatus(resp.status());
        return { threads: [], totalPages: 1, forumName: "", subForums: [] };
      }
      await skipAdIfPresent(p);
      const html = await p.content();
      const result = extractThreadList(html, fid);
      console.log(`[Scraper/Playwright] 板块抓取完成: ${result.threads.length} 帖`);
      return result;
    } finally {
      await p.context().close();
    }
  });
}

async function scrapeThreadListFast(
  url: string,
  fid: number,
  cookieStr?: string
): Promise<{
  threads: Thread[];
  totalPages: number;
  forumName: string;
  subForums: Array<{ fid: number; name: string }>;
} | null> {
  try {
    const headers: Record<string, string> = {
      "User-Agent": process.env.NGA_MOBILE_UA || "Nga_Official/9.9.9",
      "Accept": "text/html,application/xhtml+xml",
      "Accept-Language": "zh-CN,zh;q=0.9",
    };
    if (cookieStr) headers["Cookie"] = cookieStr;

    console.log(`[Scraper/Fast] 抓取板块列表: ${url}`);
    const resp = await fetch(url, { headers, redirect: "manual" });

    if (resp.status === 302 || resp.status === 301) {
      const location = resp.headers.get("location") || "";
      if (location.includes("login") || location.includes("nuke")) {
        return null; // NGA redirects to login → need Playwright
      }
    }
    if (resp.status === 403 || resp.status >= 500) return null;

    const html = await resp.text();
    if (html.length < 500 || html.includes("安全检查")) return null;

    const result = extractThreadList(html, fid);
    if (result.threads.length === 0) return null; // Empty means Need Playwright

    console.log(`[Scraper/Fast] 板块抓取完成: ${result.threads.length} 帖`);
    return result;
  } catch {
    return null; // Network error → fall back to Playwright
  }
}

export async function scrapeThreadDetail(
  tid: number,
  page: number = 1
): Promise<ThreadDetail | null> {
  const cookieStr = getDecryptedCookies() ?? undefined;
  return withRetry(async () => {
    const p = await newPage(cookieStr);
    try {
      const url = `https://bbs.nga.cn/read.php?tid=${tid}&page=${page}`;
      console.log(`[Scraper] 抓取帖子: ${url}`);
      const resp = await p.goto(url, { waitUntil: "domcontentloaded", timeout: 20000 });
      if (!resp || resp.status() !== 200) {
        if (resp) classifyStatus(resp.status());
        return null;
      }
      await skipAdIfPresent(p);
      const html = await p.content();
      const result = extractThreadDetail(html, tid, page);
      if (!result) return null;
      const posts = resolveReplyTargets(result.posts);
      // Inline: strip NGA JavaScript residue from each post's contentHtml
      for (const post of posts) {
        post.contentHtml = cleanPostHtml(post.contentHtml);
      }
      console.log(`[Scraper] 帖子抓取完成: ${posts.length} 楼`);
      return { thread: result.thread, posts, totalPages: result.totalPages };
    } finally {
      await p.context().close();
    }
  });
}

export async function scrapeForumInfo(
  fid: number
): Promise<{ name: string; subForums: Array<{ fid: number; name: string }> }> {
  const cookieStr = getDecryptedCookies() ?? undefined;
  return withRetry(async () => {
    const p = await newPage(cookieStr);
    try {
      const url = `https://bbs.nga.cn/thread.php?fid=${fid}`;
      await p.goto(url, { waitUntil: "domcontentloaded", timeout: 20000 });
      await skipAdIfPresent(p);
      const html = await p.content();
      const { load } = await import("cheerio");
      const $ = load(html);
      const name = $("title").text().replace("NGA玩家社区", "").trim() || `板块 ${fid}`;
      const subForums: Array<{ fid: number; name: string }> = [];
      $(".subforum a, .subforums a, .childforum a, a[href*='fid=']").each((_, el) => {
        const href = $(el).attr("href") || "";
        const subFidMatch = href.match(/fid=(-?\d+)/);
        const subName = $(el).text().trim();
        if (subFidMatch && subName && subName.length > 1) {
          const subFid = parseInt(subFidMatch[1]);
          if (!subForums.find((s) => s.fid === subFid) && subFid !== fid) {
            subForums.push({ fid: subFid, name: subName });
          }
        }
      });
      return { name, subForums };
    } finally {
      await p.context().close();
    }
  });
}

// ─── Reply to post ───

interface ReplyResult { success: boolean; error?: string; }

export async function scrapeReplyToPost(
  tid: number,
  pid: number,
  content: string,
  subject?: string
): Promise<ReplyResult> {
  const cookieStr = getDecryptedCookies() ?? undefined;
  if (!cookieStr) return { success: false, error: "请先登录 NGA 账号" };

  return withRetry(async () => {
    const p = await newPage(cookieStr);
    try {
      const url = `https://bbs.nga.cn/read.php?tid=${tid}&page=e`;
      await p.goto(url, { waitUntil: "domcontentloaded", timeout: 15000 });
      await skipAdIfPresent(p);

      // Locate the fast reply textarea
      const textarea = p.locator("textarea#postcontent, textarea[name='postcontent'], textarea").first();
      if ((await textarea.count()) === 0) {
        return { success: false, error: "未找到回复输入框，请直接在 NGA 回复" };
      }
      await textarea.fill(content);

      if (subject) {
        const subjInput = p.locator("input#postsubject, input[name='postsubject']").first();
        if ((await subjInput.count()) > 0) await subjInput.fill(subject);
      }

      // Click submit
      const submitBtn = p.locator([
        'button:has-text("发布")', 'button:has-text("发表")', 'button:has-text("提交")',
        'input[type="submit"][value*="发"]', 'input[type="submit"][value*="提"]',
        'button[type="submit"]:has-text("回")',
      ].join(", ")).first();
      if ((await submitBtn.count()) === 0) {
        return { success: false, error: "未找到发布按钮" };
      }
      await submitBtn.click();
      await p.waitForTimeout(3000);

      // Check result
      const currentUrl = p.url();
      if (currentUrl.includes("error") || currentUrl.includes("nuke")) {
        const body = await p.content();
        if (body.includes("验证码") || body.includes("captcha")) {
          return { success: false, error: "NGA 要求验证码，请直接在 NGA 回复" };
        }
        return { success: false, error: "回复失败，可能触发了 NGA 风控" };
      }

      return { success: true };
    } finally {
      await p.context().close();
    }
  });
}

// ─── Like / Dislike ───

interface LikeResult { success: boolean; newCount?: number; error?: string; }

export async function scrapeLikeAction(
  tid: number,
  pid: number,
  action: "agree" | "disagree"
): Promise<LikeResult> {
  const cookieStr = getDecryptedCookies() ?? undefined;
  if (!cookieStr) return { success: false, error: "请先登录 NGA 账号" };

  // Fast path: try HTTP GET with cookie
  try {
    const resp = await fetch(
      `https://bbs.nga.cn/nuke.php?__lib=agree&__act=${action}&tid=${tid}&pid=${pid}&__output=8`,
      { headers: { Cookie: cookieStr, "User-Agent": process.env.NGA_MOBILE_UA || "Nga_Official/9.9.9" } }
    );
    if (resp.ok) {
      const text = await resp.text();
      if (text.includes("success") || text.includes('"error":0')) {
        return { success: true };
      }
    }
  } catch {}

  // Fallback: Playwright
  return withRetry(async () => {
    const p = await newPage(cookieStr);
    try {
      await p.goto(`https://bbs.nga.cn/read.php?tid=${tid}&page=1`, {
        waitUntil: "domcontentloaded", timeout: 15000,
      });
      await skipAdIfPresent(p);

      const agreeBtn = p.locator(
        `a[href*="agree"][href*="pid=${pid}"], a[onclick*="agree"][onclick*="${pid}"]`
      ).first();
      if ((await agreeBtn.count()) === 0) {
        return { success: false, error: "未找到点赞按钮" };
      }
      await agreeBtn.click();
      await p.waitForTimeout(2000);
      return { success: true };
    } finally {
      await p.context().close();
    }
  });
}

export { closeBrowser };
