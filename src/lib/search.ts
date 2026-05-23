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
  const q = query.trim();

  // Author search mode: query starts with "author:"
  const authorMode = q.startsWith("author:");
  const authorName = authorMode ? q.substring(7).trim() : "";

  const fidFilter = fid
    ? `AND p.tid IN (SELECT tid FROM threads WHERE fid = ?)`
    : "";

  // Author search: find by author name (may be stored as UID in posts)
  if (authorMode && authorName) {
    // Find UIDs from threads table for this author name
    const uidRows = db.prepare(
      `SELECT DISTINCT author_id FROM threads WHERE author = ? AND author_id > 0`
    ).all(authorName) as any[];
    const uidValues = uidRows.map((r: any) => `UID:${r.author_id}`);
    
    let whereClause = `p.author LIKE ?`;
    const params: any[] = [`%${authorName}%`];
    if (uidValues.length > 0) {
      whereClause = `(p.author LIKE ? OR p.author IN (${uidValues.map(() => "?").join(",")}))`;
      params.push(...uidValues);
    }

    const sql = `
      SELECT p.pid, p.tid, p.author, p.content, p.create_time, p.floor
      FROM posts p
      WHERE ${whereClause} ${fidFilter}
      ORDER BY p.create_time DESC
      LIMIT ? OFFSET ?
    `;
    if (fid) params.push(fid);
    params.push(limit, offset);
    const rows = db.prepare(sql).all(...params) as any[];
    _hits++;
    return rows.map((r: any) => ({
      pid: r.pid, tid: r.tid, author: r.author,
      content: r.content || "", createTime: r.create_time || 0, floor: r.floor || 0,
    }));
  }

  // Normal search: try FTS5 first, fallback to LIKE
  let rows: any[];
  let usedFts = false;

  try {
    // FTS5 MATCH requires special syntax — wrap query for prefix matching
    const ftsQuery = q.split(/\s+/).filter(Boolean).map((w) => `"${w}"*`).join(" ");
    const sql = `
      SELECT p.pid, p.tid, p.author, p.content, p.create_time, p.floor
      FROM posts_fts fts
      JOIN posts p ON p.id = fts.rowid
      WHERE posts_fts MATCH ? ${fidFilter}
      ORDER BY rank
      LIMIT ? OFFSET ?
    `;
    const params: any[] = [ftsQuery];
    if (fid) params.push(fid);
    params.push(limit, offset);
    rows = db.prepare(sql).all(...params) as any[];
    usedFts = true;
  } catch {
    rows = [];
  }

  // Fallback: LIKE fuzzy search if FTS5 returns nothing
  if (rows.length === 0) {
    try {
      const likeSql = `
        SELECT p.pid, p.tid, p.author, p.content, p.create_time, p.floor
        FROM posts p
        WHERE p.content LIKE ? ${fidFilter}
        ORDER BY p.create_time DESC
        LIMIT ? OFFSET ?
      `;
      const likeParams: any[] = [`%${q}%`];
      if (fid) likeParams.push(fid);
      likeParams.push(limit, offset);
      rows = db.prepare(likeSql).all(...likeParams) as any[];
      usedFts = false;
    } catch {
      rows = [];
    }
  }

  _hits++;
  return rows.map((r: any) => ({
    pid: r.pid, tid: r.tid, author: r.author,
    content: r.content || "", createTime: r.create_time || 0, floor: r.floor || 0,
  }));
}

export function getSearchStats() {
  return { hits: _hits, misses: _misses, ftsReady: _ftsReady };
}
