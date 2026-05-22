import { getDb } from "./cache/db";

let _ftsReady = false;
let _hits = 0;
let _misses = 0;

export function ensureFtsIndex(): void {
  if (_ftsReady) return;
  const db = getDb();
  try {
    db.prepare(`
      CREATE VIRTUAL TABLE IF NOT EXISTS posts_fts USING fts5(
        content, content='posts', content_rowid='id'
      )
    `).run();
  } catch {}
  try {
    db.prepare(`INSERT INTO posts_fts(posts_fts) VALUES('rebuild')`).run();
  } catch {}
  _ftsReady = true;
}

export function invalidateFtsIndex(): void {
  _ftsReady = false;
}

export function searchPosts(
  query: string,
  fid?: number,
  limit: number = 20,
  offset: number = 0
): Array<{
  pid: number;
  tid: number;
  author: string;
  content: string;
  createTime: number;
  floor: number;
}> {
  ensureFtsIndex();
  const db = getDb();

  const fidFilter = fid
    ? `AND p.tid IN (SELECT tid FROM threads WHERE fid = ?)`
    : "";
  const sql = `
    SELECT p.pid, p.tid, p.author, p.content, p.create_time, p.floor
    FROM posts_fts fts
    JOIN posts p ON p.id = fts.rowid
    WHERE posts_fts MATCH ? ${fidFilter}
    ORDER BY rank
    LIMIT ? OFFSET ?
  `;
  const params: any[] = [query];
  if (fid) params.push(fid);
  params.push(limit, offset);

  const rows = db.prepare(sql).all(...params) as any[];
  _hits++;
  return rows.map((r) => ({
    pid: r.pid, tid: r.tid, author: r.author,
    content: r.content, createTime: r.create_time, floor: r.floor,
  }));
}

export function getSearchStats() {
  return { hits: _hits, misses: _misses, ftsReady: _ftsReady };
}
