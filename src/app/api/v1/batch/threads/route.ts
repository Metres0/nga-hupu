import { NextRequest, NextResponse } from "next/server";
import { getCachedPosts, getThreadPageInfo } from "@/lib/cache/db";

export async function GET(request: NextRequest) {
  try {
    const url = new URL(request.url);
    const tidsRaw = url.searchParams.get("tids");
    const page = parseInt(url.searchParams.get("page") || "1");

    if (!tidsRaw) {
      return NextResponse.json({ error: "Missing tids parameter" }, { status: 400 });
    }

    const tids = tidsRaw.split(",").map(Number).filter(Boolean).slice(0, 10);
    if (tids.length === 0) {
      return NextResponse.json({ threads: {} });
    }

    const result: Record<number, any> = {};
    for (const tid of tids) {
      const posts = getCachedPosts(tid, 0, page);
      const pageInfo = getThreadPageInfo(tid);
      if (posts && posts.length > 0) {
        result[tid] = {
          thread: pageInfo ? {
            tid, title: pageInfo.title, author: pageInfo.author,
            replyCount: pageInfo.reply_count, pageCount: pageInfo.page_count,
          } : { tid },
          posts: posts.map((row: any) => ({
            pid: row.pid, tid: row.tid, author: row.author,
            authorId: row.author_id, content: row.content,
            contentHtml: row.content_html, createTime: row.create_time,
            replyTo: row.reply_to, floor: row.floor,
            images: JSON.parse(row.images || "[]"),
            attachments: JSON.parse(row.attachments || "[]"),
            likes: row.likes,
          })),
          totalPages: pageInfo?.page_count ?? 1,
        };
      }
    }

    return NextResponse.json(
      { threads: result },
      { headers: { "Cache-Control": "public, max-age=60, stale-while-revalidate=300" } }
    );
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
