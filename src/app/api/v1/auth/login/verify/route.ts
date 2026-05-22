import { NextRequest, NextResponse } from "next/server";
import { verifyCaptcha } from "@/lib/auth/login-engine";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    const { sessionId, captcha } = await request.json();
    if (!sessionId || !captcha) return NextResponse.json({ error: "缺少参数" }, { status: 400 });
    const result = await verifyCaptcha(sessionId, captcha);
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
