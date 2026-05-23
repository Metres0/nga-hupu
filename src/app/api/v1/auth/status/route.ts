import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function GET(_request: NextRequest) {
  try {
    const { getSession, isExpiringSoon } = await import("@/lib/auth/session-store");
    const session = getSession();
    if (!session) return NextResponse.json({ loggedIn: false });
    return NextResponse.json({
      loggedIn: true,
      username: session.username,
      expiresAt: session.expiresAt,
      expiringSoon: isExpiringSoon(3),
    });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
