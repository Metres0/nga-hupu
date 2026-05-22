import { NextRequest, NextResponse } from "next/server";
import { getRecentLogs } from "@/lib/middleware/logger";
import { getStats } from "@/lib/middleware/rate-limiter";
import { getSearchStats } from "@/lib/search";
import { execSync } from "child_process";

export async function GET() {
  let chromeProcesses = 0;
  try {
    const out = execSync('tasklist /FI "IMAGENAME eq chrome.exe" 2>nul', {
      encoding: "utf-8",
      timeout: 5000,
    });
    chromeProcesses = (out.match(/chrome\.exe/gi) || []).length;
  } catch {}

  const memory = process.memoryUsage();
  const rateLimiterStats = getStats();
  const searchStats = getSearchStats();
  const recentLogs = getRecentLogs(10);

  return NextResponse.json({
    status: "ok",
    uptime: process.uptime(),
    memory: {
      heapUsed: Math.round(memory.heapUsed / 1024 / 1024),
      heapTotal: Math.round(memory.heapTotal / 1024 / 1024),
      rss: Math.round(memory.rss / 1024 / 1024),
    },
    chromeProcesses,
    rateLimiter: rateLimiterStats,
    search: searchStats,
    recentLogs,
  });
}
