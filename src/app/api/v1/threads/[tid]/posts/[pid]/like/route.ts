import { NextRequest, NextResponse } from "next/server";
import { scrapeLikeAction } from "@/lib/scraper/engine";

export const dynamic = "force-dynamic";

export async function POST(
  request: NextRequest,
  { params }: { params: { tid: string; pid: string } }
) {
  try {
    const tid = parseInt(params.tid);
    const pid = parseInt(params.pid);
    const body = await request.json().catch(() => ({}));
    const action = body.action === "disagree" ? "disagree" : "agree";

    const result = await scrapeLikeAction(tid, pid, action);
    if (result.success) {
      return NextResponse.json({ success: true });
    }
    return NextResponse.json({ success: false, error: result.error }, { status: 500 });
  } catch (err) {
    return NextResponse.json({ success: false, error: (err as Error).message }, { status: 500 });
  }
}
