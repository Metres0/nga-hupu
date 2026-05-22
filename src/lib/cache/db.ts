import Database from "better-sqlite3";
import path from "path";

const DB_PATH = path.join(process.cwd(), "data", "nga-cache.db");

let db: Database.Database | null = null;

function ensureDir() {
  const fs = require("fs");
  const dir = path.dirname(DB_PATH);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

export function getDb(): Database.Database {
  if (!db) {
    ensureDir();
    db = new Database(DB_PATH);
    db.pragma("journal_mode = WAL");
    db.pragma("busy_timeout = 5000");
    initSchema(db);
  }
  return db;
}

function initSchema(database: Database.Database) {
  database.exec(`
    CREATE TABLE IF NOT EXISTS forums (
      fid INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      parent_fid INTEGER,
      description TEXT,
      icon TEXT,
      thread_count INTEGER DEFAULT 0,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS threads (
      tid INTEGER PRIMARY KEY,
      fid INTEGER NOT NULL,
      title TEXT NOT NULL,
      author TEXT NOT NULL,
      author_id INTEGER NOT NULL,
      create_time INTEGER NOT NULL,
      last_reply_time INTEGER NOT NULL,
      reply_count INTEGER NOT NULL DEFAULT 0,
      sticky INTEGER NOT NULL DEFAULT 0,
      digest INTEGER NOT NULL DEFAULT 0,
      categories TEXT DEFAULT '[]',
      page_count INTEGER DEFAULT 1,
      updated_at INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_threads_fid ON threads(fid);
    CREATE INDEX IF NOT EXISTS idx_threads_updated ON threads(updated_at);

    CREATE TABLE IF NOT EXISTS posts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      pid INTEGER NOT NULL,
      tid INTEGER NOT NULL,
      page INTEGER NOT NULL DEFAULT 1,
      author TEXT NOT NULL,
      author_id INTEGER NOT NULL,
      content TEXT NOT NULL,
      content_html TEXT NOT NULL DEFAULT '',
      create_time INTEGER NOT NULL,
      reply_to INTEGER,
      floor INTEGER NOT NULL,
      images TEXT DEFAULT '[]',
      attachments TEXT DEFAULT '[]',
      likes INTEGER DEFAULT 0,
      UNIQUE(pid, page)
    );
    CREATE INDEX IF NOT EXISTS idx_posts_tid ON posts(tid);
    CREATE INDEX IF NOT EXISTS idx_posts_floor ON posts(tid, floor);
    CREATE INDEX IF NOT EXISTS idx_posts_tid_page ON posts(tid, page, floor);

    CREATE VIRTUAL TABLE IF NOT EXISTS posts_fts USING fts5(
      content, content='posts', content_rowid='id'
    );

    CREATE TABLE IF NOT EXISTS auth_sessions (
      id TEXT PRIMARY KEY,
      username TEXT NOT NULL,
      encrypted_cookies TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      expires_at INTEGER NOT NULL
    );
  `);

  try {
    database.prepare(`INSERT INTO posts_fts(posts_fts) VALUES('rebuild')`).run();
  } catch {}
}

export function getCachedThreads(fid: number, maxAge: number = 300000) {
  const database = getDb();
  if (maxAge <= 0) {
    return database
      .prepare(`SELECT * FROM threads WHERE fid = ? ORDER BY last_reply_time DESC`)
      .all(fid);
  }
  const cutoff = Date.now() - maxAge;
  return database
    .prepare(
      `SELECT * FROM threads WHERE fid = ? AND updated_at > ? ORDER BY last_reply_time DESC`
    )
    .all(fid, cutoff);
}

export function getCachedPosts(tid: number, maxAge: number = 300000, page: number = 1) {
  const database = getDb();
  const rows = database
    .prepare(`SELECT * FROM posts WHERE tid = ? AND page = ? ORDER BY floor ASC`)
    .all(tid, page);
  if (rows.length === 0) return null;
  if (maxAge <= 0) return rows;
  const threadRow = database
    .prepare(`SELECT * FROM threads WHERE tid = ?`)
    .get(tid) as any;
  if (threadRow && threadRow.updated_at < Date.now() - maxAge) return null;
  return rows;
}

export function getThreadPageInfo(tid: number): {
  title: string;
  author: string;
  reply_count: number;
  page_count: number;
} | null {
  const database = getDb();

  // Primary: count distinct pages from posts table (most accurate)
  const pageResult = database
    .prepare(`SELECT COUNT(DISTINCT page) as cnt FROM posts WHERE tid = ?`)
    .get(tid) as any;
  const actualPageCount = pageResult?.cnt ?? 0;

  const threadRow = database
    .prepare(`SELECT title, author, reply_count, page_count FROM threads WHERE tid = ?`)
    .get(tid) as any;

  if (actualPageCount > 0) {
    return {
      title: threadRow?.title ?? `帖子 #${tid}`,
      author: threadRow?.author ?? "",
      reply_count: threadRow?.reply_count ?? 0,
      page_count: actualPageCount,
    };
  }

  if (threadRow) return threadRow;
  return null;
}

export function cacheThreads(threads: any[]) {
  const database = getDb();
  const stmt = database.prepare(`
    INSERT OR REPLACE INTO threads
    (tid, fid, title, author, author_id, create_time, last_reply_time,
     reply_count, sticky, digest, categories, page_count, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const now = Date.now();
  const insertMany = database.transaction((items: any[]) => {
    for (const t of items) {
      stmt.run(
        t.tid, t.fid, t.title, t.author, t.authorId ?? t.author_id,
        t.createTime ?? t.create_time, t.lastReplyTime ?? t.last_reply_time,
        t.replyCount ?? t.reply_count, t.sticky ? 1 : 0, t.digest ? 1 : 0,
        JSON.stringify(t.categories || []), t.pageCount ?? 1, now
      );
    }
  });
  insertMany(threads);
}

export function cachePosts(posts: any[], page: number = 1) {
  const database = getDb();
  const stmt = database.prepare(`
    INSERT OR REPLACE INTO posts
    (pid, tid, page, author, author_id, content, content_html, create_time,
     reply_to, floor, images, attachments, likes)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const insertMany = database.transaction((items: any[]) => {
    for (const p of items) {
      stmt.run(
        p.pid, p.tid, page, p.author, p.authorId ?? p.author_id,
        p.content, p.contentHtml ?? p.content_html ?? "",
        p.createTime ?? p.create_time, p.replyTo ?? p.reply_to ?? null,
        p.floor, JSON.stringify(p.images || []),
        JSON.stringify(p.attachments || []), p.likes ?? 0
      );
    }
  });
  insertMany(posts);
  try {
    database.prepare(`INSERT INTO posts_fts(posts_fts) VALUES('rebuild')`).run();
  } catch {}
}

export function updateThreadCacheTime(tid: number) {
  const database = getDb();
  database
    .prepare(`UPDATE threads SET updated_at = ? WHERE tid = ?`)
    .run(Date.now(), tid);
}

export function clearThreadCache(tid: number) {
  const database = getDb();
  database.prepare(`DELETE FROM posts WHERE tid = ?`).run(tid);
  database.prepare(`DELETE FROM threads WHERE tid = ?`).run(tid);
}

export function cacheForums(forums: Array<{ fid: number; name: string; parent_fid?: number }>) {
  const database = getDb();
  const stmt = database.prepare(`
    INSERT OR REPLACE INTO forums (fid, name, parent_fid, updated_at)
    VALUES (?, ?, ?, ?)
  `);
  const now = Date.now();
  const insertMany = database.transaction((items: any[]) => {
    for (const f of items) {
      stmt.run(f.fid, f.name, f.parent_fid ?? f.parentFid ?? null, now);
    }
  });
  insertMany(forums);
}

export function getAllCachedForums(): Array<{ fid: number; name: string; parent_fid: number | null }> {
  return getDb().prepare(`SELECT * FROM forums ORDER BY name ASC`).all() as any[];
}

export function clearCache(fid?: number) {
  const database = getDb();
  if (fid) {
    database.prepare(`DELETE FROM threads WHERE fid = ?`).run(fid);
    database
      .prepare(
        `DELETE FROM posts WHERE tid IN (SELECT tid FROM threads WHERE fid = ?)`
      )
      .run(fid);
  } else {
    database.exec(`DELETE FROM posts`);
    database.exec(`DELETE FROM threads`);
  }
}
