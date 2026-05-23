import { NextRequest, NextResponse } from "next/server";
import { startLogin } from "@/lib/auth/login-engine";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    const { username, password, method, saveCredential } = await request.json();
    if (!username || !password) return NextResponse.json({ error: "缺少用户名或密码" }, { status: 400 });
    const result = await startLogin(username, password, method || "rsa", !!saveCredential);
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
