import fs from "fs";
import path from "path";

const LOCK_DIR = path.join(process.cwd(), "data", "locks");

function tryAcquireGlobalLock(name: string): boolean {
  try { fs.mkdirSync(LOCK_DIR, { recursive: true }); } catch {}
  const lockFile = path.join(LOCK_DIR, `${name}.lock`);
  try {
    fs.writeFileSync(lockFile, String(process.pid), { flag: "wx" });
    return true;
  } catch {
    try {
      const pid = parseInt(fs.readFileSync(lockFile, "utf-8"));
      try { process.kill(pid, 0); } catch {
        fs.writeFileSync(lockFile, String(process.pid), { flag: "w" });
        return true;
      }
    } catch { return false; }
    return false;
  }
}

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

    if (tryAcquireGlobalLock("db-maintenance")) {
      setInterval(() => {
        try {
          const db = require("@/lib/cache/db").getDb();
          db.pragma("optimize");
        } catch {}
      }, 6 * 60 * 60 * 1000);

      setInterval(() => {
        try {
          const { optimizeFtsIndex } = require("@/lib/cache/db");
          optimizeFtsIndex();
        } catch {}
      }, 24 * 60 * 60 * 1000);

      setInterval(() => {
        try {
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
    }

    if (tryAcquireGlobalLock("auth-renew")) {
      setInterval(async () => {
        try {
          const { renewSessions } = await import("@/lib/auth/auto-renew");
          const result = await renewSessions();
          if (result.needsManual > 0) console.log("[Auth] Cookie 即将过期，需要重新登录");
        } catch {}
      }, 30 * 60 * 1000);
    }

    if (process.env.ENABLE_AUTO_REFRESH === "1") {
      if (tryAcquireGlobalLock("scheduler")) {
        const intervalMin = parseInt(process.env.REFRESH_INTERVAL_MIN || "30");
        const priorityFids = (process.env.PRIORITY_FIDS || "").split(",").filter(Boolean);
        console.log(`[Instrumentation] 自动刷新已启用，间隔 ${intervalMin} 分钟`);
        if (priorityFids.length > 0) console.log(`[Instrumentation] 优先板块: ${priorityFids.join(",")}`);

        const { spawn } = await import("child_process");
        const activeChildren = new Set<import("child_process").ChildProcess>();

        process.on("exit", () => {
          for (const child of activeChildren) {
            if (child.pid) try { process.kill(-child.pid, "SIGTERM"); } catch {}
          }
        });

        setInterval(() => {
          console.log("[Scheduler] 开始增量抓取...");
          const args = ["tsx", "scripts/scrape-incremental.ts"];
          if (priorityFids.length > 0) {
            process.env.PRIORITY_FIDS = priorityFids.join(",");
          }
          const child = spawn("npx", args, {
            detached: false,
            stdio: "inherit",
            cwd: process.cwd(),
          });

          activeChildren.add(child);

          const timeout = setTimeout(() => {
            console.error("[Scheduler] 子进程超时 (10min)，强制终止");
            if (child.pid) {
              const pid = child.pid;
              try { process.kill(-pid, "SIGTERM"); } catch {}
              setTimeout(() => { try { process.kill(-pid, "SIGKILL"); } catch {} }, 5000);
            }
          }, 10 * 60 * 1000);

          child.on("error", (err) => {
            clearTimeout(timeout);
            activeChildren.delete(child);
            console.error("[Scheduler] 子进程启动失败:", err.message);
            if (child.pid) try { process.kill(-child.pid, "SIGKILL"); } catch {}
          });
          child.on("exit", (code) => {
            clearTimeout(timeout);
            activeChildren.delete(child);
            if (code !== 0) console.error(`[Scheduler] 增量抓取异常退出, code=${code}`);
          });
        }, intervalMin * 60 * 1000);
      }
    }
  }
}
