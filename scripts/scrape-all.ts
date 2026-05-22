/**
 * Multi-forum scraper: scrape all configured forums in sequence.
 * Run: npx tsx scripts/scrape-all.ts
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

const FORUMS = [
  { fid: -343809, name: "汽车俱乐部" },
  { fid: -576177, name: "音乐影视" },
  { fid: -7955747, name: "晴风村" },
];

const MAX_THREAD_PAGES = 2;
const MAX_DETAIL_THREADS = 100;

async function scrapeForum(fid: number, name: string) {
  console.log(`\n=== ${name} (FID=${fid}) ===`);
  let allThreads: any[] = [];

  for (let page = 1; page <= MAX_THREAD_PAGES; page++) {
    console.log(`[${page}/${MAX_THREAD_PAGES}] 抓取板块列表...`);
    const result = await scrapeThreadList(fid, page);
    console.log(`  → ${result.threads.length} 帖, 论坛: ${result.forumName}`);
    allThreads.push(...result.threads);
    if (page >= result.totalPages) break;
  }

  console.log(`总计 ${allThreads.length} 个帖子`);
  cacheThreads(allThreads);

  const threadsWithReplies = allThreads
    .filter((t) => t.replyCount > 0 && !t.sticky)
    .slice(0, MAX_DETAIL_THREADS);

  console.log(`抓取 ${threadsWithReplies.length} 个帖子详情(含多页)...`);
  let done = 0;
  for (const t of threadsWithReplies) {
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
    if (done % 10 === 0) console.log(`  [${done}/${threadsWithReplies.length}]`);
  }
  console.log(`  → ${name} 完成`);
}

async function main() {
  console.log("=== NGA 多板块预抓取 ===");
  for (const f of FORUMS) {
    await scrapeForum(f.fid, f.name);
  }
  await closeBrowser();
  console.log("\n=== 全部完成 ===\n启动: npm run start");
}

main().catch((err) => {
  console.error("失败:", err);
  process.exit(1);
});
