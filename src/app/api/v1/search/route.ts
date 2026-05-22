import { NextRequest, NextResponse } from "next/server";
import { searchPosts } from "@/lib/search";
import { corsHeaders } from "@/lib/middleware/cors";

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const q = searchParams.get("q");
  const fidStr = searchParams.get("fid");
  const limit = parseInt(searchParams.get("limit") || "20");
  const offset = parseInt(searchParams.get("offset") || "0");

  if (!q || q.trim().length < 1) {
    return NextResponse.json({ error: "缺少搜索关键词" }, { status: 400, headers: corsHeaders() });
  }

  try {
    const fid = fidStr ? parseInt(fidStr) : undefined;
    const results = searchPosts(q.trim(), fid, Math.min(limit, 50), offset);
    return NextResponse.json(
      { data: results, query: q, count: results.length, offset },
      { headers: corsHeaders() }
    );
  } catch (err) {
    return NextResponse.json({ error: "搜索失败" }, { status: 500, headers: corsHeaders() });
  }
}
