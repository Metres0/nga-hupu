import type { Thread, ThreadDetail } from "@/lib/types";
import { newPage, newDesktopPage, closeBrowser, skipAdIfPresent } from "./browser";
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

  // Always use Playwright for correct encoding (NGA uses GBK, not UTF-8)
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

    const buffer = await resp.arrayBuffer();
    const html = new TextDecoder("gbk").decode(new Uint8Array(buffer));
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
  fid: number,
  pid: number,
  content: string,
  subject?: string
): Promise<ReplyResult> {
  const cookieStr = getDecryptedCookies() ?? undefined;
  if (!cookieStr) return { success: false, error: "请先登录 NGA 账号" };
  if (!cookieStr.includes("ngaPassportUid") && !cookieStr.includes("ngaPassportCid")) {
    return { success: false, error: "Cookie 认证信息缺失，请重新登录 NGA" };
  }

  return withRetry(async () => {
    // Use desktop page for reliable reply form (mobile may not have it)
    const p = await newDesktopPage(cookieStr);
    try {
      const url = `https://bbs.nga.cn/read.php?tid=${tid}&page=e`;
      await p.goto(url, { waitUntil: "domcontentloaded", timeout: 15000 });
      await skipAdIfPresent(p);
      await p.waitForTimeout(1000);

      // Dump available textareas for debugging
      const textareas = await p.locator("textarea").all();
      for (let i = 0; i < Math.min(textareas.length, 5); i++) {
        const info = await textareas[i].evaluate((el: any) => ({
          id: el.id || "", name: el.name || "", placeholder: el.placeholder || "", visible: el.offsetParent !== null,
        })).catch(() => ({}));
        console.log(`[Reply] Textarea ${i}:`, info);
      }

      // Check for login redirect
      const pageUrl = p.url();
      if (pageUrl.includes("login") || (pageUrl.includes("nuke.php") && !pageUrl.includes("read.php"))) {
        return { success: false, error: "登录已过期，请重新登录 NGA" };
      }

      // Find reply textarea — try all common NGA combos
      let textarea = p.locator("textarea#fastpostcontent").first();
      if ((await textarea.count()) === 0) textarea = p.locator("textarea[name='atc_content']").first();
      if ((await textarea.count()) === 0) textarea = p.locator("textarea").first();

      if ((await textarea.count()) === 0) {
        return { success: false, error: "未找到回复输入框，请直接在 NGA 回复" };
      }

      // Fill via JavaScript (handles hidden/obscured textareas)
      await textarea.evaluate((el: any, val: string) => {
        const ta = el as HTMLTextAreaElement;
        ta.value = val; ta.dispatchEvent(new Event("input", { bubbles: true }));
      }, content);

      if (subject) {
        const subj = p.locator("input[name='atc_title'], input[name='post_subject']").first();
        if ((await subj.count()) > 0) await subj.fill(subject);
      }

      // Submit: form submit (most reliable cross-platform)
      const form = p.locator("form").first();
      if ((await form.count()) > 0) {
        await form.evaluate((el: any) => (el as HTMLFormElement).submit());
      } else {
        const btn = p.locator("input[type='submit'], button[type='submit']").first();
        if ((await btn.count()) > 0) await btn.click();
      }
      await p.waitForTimeout(4000);

      const finalUrl = p.url();
      const body = await p.content();
      if (body.includes("验证码") || body.includes("captcha")) {
        return { success: false, error: "NGA 要求验证码，请直接在 NGA 回复" };
      }
      if (body.includes("发帖间隔") || body.includes("限制")) {
        return { success: false, error: "NGA 发帖间隔限制，请稍后重试" };
      }
      // Success: URL likely redirects back to thread (read.php)
      if (finalUrl.includes(`read.php?tid=${tid}`)) {
        return { success: true };
      }
      console.log("[Reply] Final URL:", finalUrl.substring(0, 100));
      return { success: true }; // Assume success if no error detected
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
