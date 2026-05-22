/**
 * Incremental scraper: only fetch threads newer than what's in SQLite.
 * Run: npx tsx scripts/scrape-incremental.ts
 *
 * Based on FluxDO's preloaded data service principle:
 * minimal delta fetch instead of full re-scrape.
 */
import {
  scrapeThreadList,
  scrapeThreadDetail,
  closeBrowser,
} from "../src/lib/scraper/engine";
import { cacheThreads, cachePosts } from "../src/lib/cache/db";

import { execSync } from "child_process";
try { execSync("taskkill /F /IM chrome.exe 2>nul", { stdio: "ignore" }); } catch {}

const FORUMS = (() => {
  const priority = (process.env.PRIORITY_FIDS || "").split(",").filter(Boolean).map(Number);
  const defaults = [
    { fid: -343809, name: "汽车俱乐部" },
    { fid: -576177, name: "音乐影视" },
  ];
  if (priority.length > 0) {
    const merged = priority.map((fid) => {
      const found = defaults.find((d) => d.fid === fid);
      return { fid, name: found?.name || `板块 ${fid}` };
    });
    defaults.forEach((d) => { if (!merged.find((m) => m.fid === d.fid)) merged.push(d); });
    return merged;
  }
  return defaults;
})();

const MAX_THREAD_PAGES = 2;
const MAX_DETAIL_THREADS = 20;

async function scrapeForumIncremental(fid: number, name: string) {
  console.log(`\n=== ${name} (FID=${fid}) 增量抓取 ===`);

  const { getCachedThreads } = await import("../src/lib/cache/db");
  const existing = getCachedThreads(fid);
  const existingTids = new Set(existing.map((t: any) => t.tid));

  let allThreads: any[] = [];

  for (let page = 1; page <= MAX_THREAD_PAGES; page++) {
    const result = await scrapeThreadList(fid, page);
    console.log(`  第${page}页: ${result.threads.length} 帖`);
    allThreads.push(...result.threads);
    if (page >= result.totalPages) break;
  }

  const newThreads = allThreads.filter((t) => !existingTids.has(t.tid));
  console.log(`  新帖: ${newThreads.length}, 已有: ${existingTids.size}`);

  if (newThreads.length > 0) {
    cacheThreads(allThreads);
  }

  const threadsToFetch = allThreads
    .filter((t) => t.replyCount > 0 && !t.sticky)
    .slice(0, MAX_DETAIL_THREADS);

  let done = 0;
  for (const t of threadsToFetch) {
    done++;
    const totalPages = Math.min(Math.ceil(t.replyCount / 20), 5);
    try {
      for (let p = 1; p <= totalPages; p++) {
        const detail = await scrapeThreadDetail(t.tid, p);
        if (detail && detail.posts.length > 0) {
          cachePosts(detail.posts, p);
        }
      }
    } catch (e: any) {
      console.log(`  TID=${t.tid} 失败: ${e.message}`);
    }
    if (done % 10 === 0) console.log(`  [${done}/${threadsToFetch.length}]`);
  }
  console.log(`  -> ${name} 完成`);
}

async function main() {
  console.log("=== NGA 增量抓取 ===");
  for (const f of FORUMS) {
    await scrapeForumIncremental(f.fid, f.name);
  }
  await closeBrowser();
  console.log("\n=== 增量抓取完成 ===");
}

main().catch((err) => {
  console.error("失败:", err);
  process.exit(1);
});
