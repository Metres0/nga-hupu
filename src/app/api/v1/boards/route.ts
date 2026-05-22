import { NextRequest, NextResponse } from "next/server";
import { getDb, getAllCachedForums } from "@/lib/cache/db";
import { corsHeaders } from "@/lib/middleware/cors";

export async function GET(request: NextRequest) {
  try {
    const forums = getAllCachedForums();
    const db = getDb();
    const lastUpdate = db.prepare("SELECT MAX(updated_at) as ts FROM forums").get() as any;
    const age = lastUpdate?.ts ? Date.now() - lastUpdate.ts : Infinity;
    const staleMinutes = Math.floor(age / 60000);

    return NextResponse.json(
      { forums, lastUpdated: lastUpdate?.ts || null, staleMinutes },
      { headers: { ...corsHeaders(), "Cache-Control": "public, max-age=300" } }
    );
  } catch {
    return NextResponse.json({ forums: [], lastUpdated: null }, { headers: corsHeaders() });
  }
}
