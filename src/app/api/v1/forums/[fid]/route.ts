import { NextRequest, NextResponse } from "next/server";
import { getCachedThreads } from "@/lib/cache/db";
import { getPlugin } from "@/plugins/registry";
import { pipeline } from "@/lib/middleware/pipeline";

export async function GET(
  request: NextRequest,
  { params }: { params: { fid: string } }
) {
  const piped = pipeline(async (req: Request) => {
    const fid = parseInt(params.fid);
    const page = parseInt(new URL(req.url).searchParams.get("page") || "1");

    const cached = getCachedThreads(fid, 0);
    const plugin = getPlugin(fid);

    if (cached && cached.length > 0) {
      const perPage = 50;
      const totalPages = Math.max(Math.ceil(cached.length / perPage), 1);
      const start = (page - 1) * perPage;
      const pagedData = cached.slice(start, start + perPage);

      return NextResponse.json(
        {
          data: pagedData.map((row: any) => ({
            tid: row.tid, fid: row.fid, title: row.title,
            author: row.author, authorId: row.author_id,
            createTime: row.create_time, lastReplyTime: row.last_reply_time,
            replyCount: row.reply_count, sticky: !!row.sticky,
            digest: !!row.digest, categories: JSON.parse(row.categories || "[]"),
            pageCount: row.page_count,
          })),
          page, totalPages, hasMore: page < totalPages,
          forum: plugin || { fid, name: `板块 ${fid}`, subForums: [] },
          cached: true,
        },
        { headers: { "Cache-Control": "public, max-age=30" } }
      );
    }

    const { scrapeThreadList } = await import("@/lib/scraper/engine");
    const { cacheThreads } = await import("@/lib/cache/db");
    const result = await scrapeThreadList(fid, page);
    if (result.threads.length > 0) cacheThreads(result.threads);

    return NextResponse.json(
      {
        data: result.threads, page, totalPages: result.totalPages,
        hasMore: page < result.totalPages,
        forum: { fid, name: result.forumName, subForums: result.subForums },
        cached: false,
      },
      { headers: { "Cache-Control": "public, max-age=60" } }
    );
  });

  return piped(request);
}
