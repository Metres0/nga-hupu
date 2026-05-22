export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { execSync } = await import("child_process");

    try { execSync("taskkill /F /IM chrome.exe 2>nul", { stdio: "ignore" }); } catch {}

    console.log("[Instrumentation] 预热 Playwright Chromium...");
    try {
      const { chromium } = await import("playwright");
      const browser = await chromium.launch({
        channel: "chrome",
        headless: true,
        args: ["--no-sandbox", "--disable-blink-features=AutomationControlled"],
      });
      await browser.close();
      console.log("[Instrumentation] Chromium 预热完成");
    } catch (e) {
      console.log("[Instrumentation] Chromium 预热跳过:", (e as Error).message);
    }

    console.log("[Instrumentation] 数据库维护...");
    try {
      const { getDb } = await import("@/lib/cache/db");
      const db = getDb();
      db.pragma("optimize");
      db.pragma("wal_checkpoint(TRUNCATE)");
      console.log("[Instrumentation] PRAGMA optimize + WAL checkpoint 完成");
    } catch (e) {
      console.log("[Instrumentation] DB 维护跳过:", (e as Error).message);
    }

    setInterval(() => {
      try {
        const db = require("@/lib/cache/db").getDb();
        db.pragma("optimize");
      } catch {}
    }, 6 * 60 * 60 * 1000);

    setInterval(async () => {
      try {
        const { renewSessions } = await import("@/lib/auth/auto-renew");
        const result = await renewSessions();
        if (result.needsManual > 0) console.log("[Auth] Cookie 即将过期，需要重新登录");
      } catch {}
    }, 30 * 60 * 1000);

    setInterval(() => {
      try {
        const fs = require("fs");
        const path = require("path");
        const src = path.join(process.cwd(), "data", "nga-cache.db");
        if (!fs.existsSync(src)) return;
        const backupDir = path.join(process.cwd(), "data", "backups");
        if (!fs.existsSync(backupDir)) fs.mkdirSync(backupDir, { recursive: true });
        const dest = path.join(backupDir, `nga-cache-${Date.now()}.db`);
        fs.copyFileSync(src, dest);
        const files = fs.readdirSync(backupDir).sort();
        while (files.length > 5) fs.unlinkSync(path.join(backupDir, files.shift()!));
      } catch {}
    }, 24 * 60 * 60 * 1000);

    if (process.env.ENABLE_AUTO_REFRESH === "1") {
      const intervalMin = parseInt(process.env.REFRESH_INTERVAL_MIN || "30");
      const priorityFids = (process.env.PRIORITY_FIDS || "").split(",").filter(Boolean);
      console.log(`[Instrumentation] 自动刷新已启用，间隔 ${intervalMin} 分钟`);
      if (priorityFids.length > 0) console.log(`[Instrumentation] 优先板块: ${priorityFids.join(",")}`);

      setInterval(() => {
        console.log("[Scheduler] 开始增量抓取...");
        if (priorityFids.length > 0) {
          try {
            execSync(`npx tsx scripts/scrape-incremental.ts`, {
              stdio: "inherit", timeout: 5 * 60 * 1000, cwd: process.cwd(),
            });
          } catch (e) {
            console.error("[Scheduler] 优先抓取失败:", (e as Error).message);
          }
        } else {
          try {
            execSync("npx tsx scripts/scrape-incremental.ts", {
              stdio: "inherit", timeout: 10 * 60 * 1000, cwd: process.cwd(),
            });
          } catch (e) {
            console.error("[Scheduler] 增量抓取失败:", (e as Error).message);
          }
        }
      }, intervalMin * 60 * 1000);
    }
  }
}
