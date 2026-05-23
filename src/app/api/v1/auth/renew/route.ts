import { NextRequest, NextResponse } from "next/server";
import { renewSessions } from "@/lib/auth/auto-renew";

export const dynamic = "force-dynamic";

export async function POST(_request: NextRequest) {
  try {
    const result = await renewSessions();
    return NextResponse.json({
      success: result.renewed > 0,
      renewed: result.renewed,
      needsManual: result.needsManual,
    });
  } catch (err) {
    return NextResponse.json({ success: false, error: (err as Error).message }, { status: 500 });
  }
}
