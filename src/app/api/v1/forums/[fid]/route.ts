import { NextRequest, NextResponse } from "next/server";
import { getCachedThreads, getCachedThreadCount } from "@/lib/cache/db";
import { getPlugin } from "@/plugins/registry";
import { pipeline } from "@/lib/middleware/pipeline";

export async function GET(
  request: NextRequest,
  { params }: { params: { fid: string } }
) {
  const piped = pipeline(async (req: Request) => {
    const fid = parseInt(params.fid);
    const page = parseInt(new URL(req.url).searchParams.get("page") || "1");
    const refresh = new URL(req.url).searchParams.get("refresh") === "1";
    const perPage = 50;
    const offset = (page - 1) * perPage;

    // Skip cache when user explicitly requests refresh
    if (!refresh) {
      const cached = getCachedThreads(fid, 0, perPage, offset);
      const totalCount = getCachedThreadCount(fid);
      const plugin = getPlugin(fid);

      if (cached && cached.length > 0) {
      const totalPages = Math.max(Math.ceil(totalCount / perPage), 1);

      return NextResponse.json(
        {
          data: cached.map((row: any) => ({
            tid: row.tid, title: row.title,
            author: row.author,
            createTime: row.create_time, lastReplyTime: row.last_reply_time,
            replyCount: row.reply_count, sticky: !!row.sticky,
            digest: !!row.digest, pageCount: row.page_count,
          })),
          page, totalPages, hasMore: page < totalPages,
          forum: plugin || { fid, name: `板块 ${fid}`, subForums: [] },
          cached: true,
        },
        { headers: { "Cache-Control": "public, max-age=300, stale-while-revalidate=600" } }
      );
    }
    }

    const { dedupedScrape } = await import("@/lib/cache/db");
    const result = await dedupedScrape(
      `forum:${fid}:${page}`,
      async () => {
        const { scrapeThreadList } = await import("@/lib/scraper/engine");
        const { cacheThreads } = await import("@/lib/cache/db");
        const data = await scrapeThreadList(fid, page);
        if (data.threads.length > 0) cacheThreads(data.threads);
        return data;
      }
    );

    // Degraded mode: scraper returned empty → serve stale cache from SQLite
    if (result.threads.length === 0) {
      const stale = getCachedThreads(fid, 0, perPage, offset);
      if (stale && stale.length > 0) {
        const totalCount = getCachedThreadCount(fid);
        const plugin = getPlugin(fid);
        const totalPages = Math.max(Math.ceil(totalCount / perPage), 1);
        return NextResponse.json(
          {
            data: stale.map((row: any) => ({
              tid: row.tid, title: row.title, author: row.author,
              createTime: row.create_time, lastReplyTime: row.last_reply_time,
              replyCount: row.reply_count, sticky: !!row.sticky,
              digest: !!row.digest, pageCount: row.page_count,
            })),
            page, totalPages, hasMore: page < totalPages,
            forum: plugin || { fid, name: `板块 ${fid}`, subForums: [] },
            cached: true, degraded: true,
          },
          { headers: { "Cache-Control": "public, max-age=60" } }
        );
      }
    }

    return NextResponse.json(
      {
        data: result.threads, page, totalPages: result.totalPages,
        hasMore: page < result.totalPages,
        forum: { fid, name: result.forumName, subForums: result.subForums },
        cached: false,
      },
      { headers: { "Cache-Control": "public, max-age=120" } }
    );
  });

  return piped(request);
}
