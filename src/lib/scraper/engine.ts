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

export async function scrapeThreadList(
  fid: number,
  page: number = 1
): Promise<{
  threads: Thread[];
  totalPages: number;
  forumName: string;
  subForums: Array<{ fid: number; name: string }>;
}> {
  const cookieStr = getDecryptedCookies() ?? undefined;
  return withRetry(async () => {
    const p = await newPage(cookieStr);
    try {
      const url = `https://bbs.nga.cn/thread.php?fid=${fid}&page=${page}`;
      console.log(`[Scraper] 抓取板块列表: ${url}`);
      const resp = await p.goto(url, { waitUntil: "domcontentloaded", timeout: 20000 });
      if (!resp || resp.status() !== 200) {
        if (resp) classifyStatus(resp.status());
        return { threads: [], totalPages: 1, forumName: "", subForums: [] };
      }
      await skipAdIfPresent(p);
      const html = await p.content();
      const result = extractThreadList(html, fid);
      console.log(`[Scraper] 板块抓取完成: ${result.threads.length} 帖`);
      return result;
    } finally {
      await p.context().close();
    }
  });
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

export { closeBrowser };
