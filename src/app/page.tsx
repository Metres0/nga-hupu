import { getAllCachedForums } from "@/lib/cache/db";
import HomeClient from "./HomeClient";

function buildTree(
  forums: Array<{ fid: number; name: string; parent_fid: number | null }>
) {
  const map = new Map<number, any>();
  const roots: any[] = [];

  forums.forEach((f) => {
    map.set(f.fid, { fid: f.fid, name: f.name, parentFid: f.parent_fid, children: [] });
  });

  forums.forEach((f) => {
    const node = map.get(f.fid)!;
    if (f.parent_fid && map.has(f.parent_fid)) {
      map.get(f.parent_fid).children.push(node);
    } else {
      roots.push(node);
    }
  });

  roots.sort((a, b) => {
    const aIsNeg = a.fid < 0;
    const bIsNeg = b.fid < 0;
    if (aIsNeg && !bIsNeg) return -1;
    if (!aIsNeg && bIsNeg) return 1;
    return a.name.localeCompare(b.name, "zh");
  });

  return roots;
}

export const dynamic = "force-dynamic";

export default function HomePage() {
  let boards: any[] = [];
  let lastUpdated: number | null = null;
  let staleMinutes = 0;

  try {
    const forums = getAllCachedForums();
    if (forums.length > 0) {
      boards = buildTree(forums);
      const now = Date.now();
      const latest = Math.max(...forums.map((f: any) => f.updated_at || 0));
      lastUpdated = latest || null;
      staleMinutes = lastUpdated ? Math.floor((now - lastUpdated) / 60000) : 0;
    }
  } catch {}

  return (
    <HomeClient
      initialBoards={boards}
      lastUpdated={lastUpdated}
      staleMinutes={staleMinutes}
    />
  );
}
