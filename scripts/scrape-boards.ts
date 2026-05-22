/**
 * Scrape NGA main page to build the complete board tree.
 * Can be called from CLI (npx tsx scripts/scrape-boards.ts)
 * or programmatically from API routes.
 */
import { chromium, Browser } from "playwright";
import { load } from "cheerio";
import { cacheForums } from "../src/lib/cache/db";

const MOBILE_UA = "Nga_Official/9.9.9 (iPhone; iOS 18.0; Scale/3.00)";

interface RawBoard {
  fid: number;
  name: string;
  parent_fid?: number;
}

let sharedBrowser: Browser | null = null;

export async function scrapeBoards(browser?: Browser): Promise<number> {
  console.log("=== 解析 NGA 板块树 ===\n");

  const ownBrowser = !browser;
  const b = browser || await chromium.launch({
    channel: "chrome", headless: true,
    args: ["--no-sandbox", "--disable-blink-features=AutomationControlled"],
  });
  const ctx = await b.newContext({
    userAgent: MOBILE_UA, locale: "zh-CN", viewport: { width: 390, height: 844 },
  });
  const p = await ctx.newPage();

  // Use networkidle to wait for JS-rendered board content
  await p.goto("https://bbs.nga.cn/", { waitUntil: "networkidle", timeout: 30000 });

  const html = await p.content();
  const $ = load(html);

  const boards: RawBoard[] = [];

  // Extract all forum links with fid=
  $("a[href*='fid=']").each((_, el) => {
    const $el = $(el);
    const href = $el.attr("href") || "";
    const fidMatch = href.match(/fid=(-?\d+)/);
    if (!fidMatch) return;
    const fid = parseInt(fidMatch[1]);
    const name = $el.text().trim();

    if (!name || name.length < 2 || name.length > 50) return;

    // Skip duplicate fids
    const existing = boards.find((b) => b.fid === fid);
    if (existing) {
      // Keep longer name if available
      if (name.length > existing.name.length) existing.name = name;
      return;
    }
    boards.push({ fid, name });
  });

  // Detect parent-child: look for forums nested inside containers
  $("a[href*='fid=']").each((_, el) => {
    const $el = $(el);
    const href = $el.attr("href") || "";
    const fidMatch = href.match(/fid=(-?\d+)/);
    if (!fidMatch) return;
    const fid = parseInt(fidMatch[1]);

    // Check if inside a sub-forum or child section
    const parent = $el.closest(".subforum, .childforum, .subforums, .subforumlist, .child");
    if (parent.length > 0) {
      // Find nearest preceding forum link as parent
      const prevBoard = parent.prevAll("a[href*='fid=']").first();
      const prevHref = prevBoard.attr("href") || "";
      const parentMatch = prevHref.match(/fid=(-?\d+)/);
      if (parentMatch) {
        const parentFid = parseInt(parentMatch[1]);
        if (parentFid !== fid) {
          const board = boards.find((b) => b.fid === fid);
          if (board && !board.parent_fid) {
            board.parent_fid = parentFid;
          }
        }
      }
    }
  });

  // Remove trade/wanted/spam boards (fid typically > 10000 for non-standard)
  const filtered = boards.filter(
    (b) => Math.abs(b.fid) < 50000 || b.name.length >= 3
  );

  console.log(`发现 ${filtered.length} 个板块`);
  filtered.slice(0, 20).forEach((b) =>
    console.log(`  fid=${b.fid} ${b.parent_fid ? "(parent=" + b.parent_fid + ")" : ""} "${b.name}"`)
  );

  if (filtered.length > 0) {
    // Fix NGA mobile abbreviated names
    const nameFixes: Record<number, string> = {
      [-343809]: "汽车俱乐部",
      [-7]: "网事杂谈",
    };
    filtered.forEach((b) => {
      if (nameFixes[b.fid]) b.name = nameFixes[b.fid];
    });
    cacheForums(filtered);
    console.log(`\n板块树已缓存到 forums 表 (${filtered.length} 个板块)`);
  }

  await ctx.close();
  if (ownBrowser) await b.close();
  console.log("=== 完成 ===");
  return filtered.length;
}

async function main() {
  const count = await scrapeBoards();
  console.log(`\n返回计数: ${count}`);
}

main().catch((err) => {
  console.error("失败:", err);
  process.exit(1);
});
