import { NextRequest, NextResponse } from "next/server";
import { scrapeReplyToPost } from "@/lib/scraper/engine";
import { pipeline } from "@/lib/middleware/pipeline";

export const dynamic = "force-dynamic";

export async function POST(
  request: NextRequest,
  { params }: { params: { tid: string } }
) {
  const piped = pipeline(async (req: Request) => {
    const tid = parseInt(params.tid);
    const body = await req.json().catch(() => ({}));
    const { pid = 0, fid = 0, content, subject } = body;

    if (!content || typeof content !== "string" || content.trim().length < 2) {
      return NextResponse.json({ success: false, error: "请输入回复内容" }, { status: 400 });
    }
    if (content.length > 5000) {
      return NextResponse.json({ success: false, error: "内容过长 (最多5000字)" }, { status: 400 });
    }

    const result = await scrapeReplyToPost(tid, fid, pid, content.trim(), subject?.trim() || undefined);
    if (result.success) {
      return NextResponse.json({ success: true });
    }
    return NextResponse.json({ success: false, error: result.error }, { status: 500 });
  });

  return piped(request);
}
