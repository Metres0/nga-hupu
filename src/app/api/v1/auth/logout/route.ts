import { NextRequest, NextResponse } from "next/server";
import { deleteSession } from "@/lib/auth/session-store";
import { deleteCredential } from "@/lib/auth/credential-store";

export const dynamic = "force-dynamic";

export async function POST(_request: NextRequest) {
  deleteSession();
  deleteCredential();
  return NextResponse.json({ success: true });
}
