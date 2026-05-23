/**
 * CLI Scraper: pre-populate SQLite with NGA forum data.
 * Run: npx tsx scripts/scrape.ts
 * This moves Playwright out of the web request path.
 */
import {
  scrapeThreadList,
  scrapeThreadDetail,
  closeBrowser,
} from "../src/lib/scraper/engine";
import { cacheThreads, cachePosts } from "../src/lib/cache/db";

// Cleanup orphaned Chrome processes from previous interrupted runs
import { execSync } from "child_process";
try { execSync("taskkill /F /IM chrome.exe 2>nul", { stdio: "ignore" }); } catch {}

const FID = -576177;
const MAX_THREAD_PAGES = 2;
const MAX_DETAIL_THREADS = 100;

async function main() {
  console.log("=== NGA 预抓取开始 ===");
  console.log(`板块 FID=${FID}, 最多 ${MAX_THREAD_PAGES} 页帖子列表, ${MAX_DETAIL_THREADS} 个帖子详情\n`);

  let allThreads: any[] = [];

  for (let page = 1; page <= MAX_THREAD_PAGES; page++) {
    console.log(`[${page}/${MAX_THREAD_PAGES}] 抓取板块列表...`);
    const result = await scrapeThreadList(FID, page);
    console.log(`  → ${result.threads.length} 帖, 论坛: ${result.forumName}`);
    allThreads.push(...result.threads);
    if (page >= result.totalPages) break;
  }

  console.log(`\n总计 ${allThreads.length} 个帖子`);
  cacheThreads(allThreads);
  console.log("论坛列表已缓存");

  // Scrape thread details (with replies)
  const threadsWithReplies = allThreads
    .filter((t) => t.replyCount > 0 && !t.sticky)
    .slice(0, MAX_DETAIL_THREADS);

    console.log(`\n抓取 ${threadsWithReplies.length} 个帖子详情(含多页)...`);
    let done = 0;
    for (const t of threadsWithReplies) {
      done++;
      const totalPages = Math.min(Math.ceil(t.replyCount / 20), 5);
      console.log(`[${done}/${threadsWithReplies.length}] TID=${t.tid} "${t.title.substring(0, 40)}" (${t.replyCount}回复 ${totalPages}页)`);
      try {
        for (let p = 1; p <= totalPages; p++) {
          const detail = await scrapeThreadDetail(t.tid, p);
          if (detail && detail.posts.length > 0) {
            cachePosts(detail.posts, t.tid, p);
            if (p === 1) console.log(`  → 共${detail.totalPages}页, p1:${detail.posts.length}楼`);
          }
        }
      } catch (e: any) {
        console.log(`  → 失败: ${e.message}`);
      }
    }

  await closeBrowser();
  console.log("\n=== 预抓取完成 ===");
  console.log(`数据已存入: data/nga-cache.db`);
  console.log(`启动网站: npm run dev`);
}

main().catch((err) => {
  console.error("抓取失败:", err);
  process.exit(1);
});
