import crypto from "crypto";
import { getDb } from "@/lib/cache/db";
import { encrypt, decrypt } from "./session-store";

export interface StoredCredential {
  id: string;
  username: string;
  encryptedPassword: string;
  createdAt: number;
}

function initCredentialTable() {
  const db = getDb();
  db.exec(`
    CREATE TABLE IF NOT EXISTS credentials (
      id TEXT PRIMARY KEY,
      username TEXT NOT NULL UNIQUE,
      encrypted_password TEXT NOT NULL,
      created_at INTEGER NOT NULL
    )
  `);
}

export function storeCredential(username: string, password: string): StoredCredential {
  initCredentialTable();
  const db = getDb();
  const id = crypto.randomUUID();
  const now = Date.now();
  const encrypted = encrypt(password);

  // Upsert: one credential per username
  db.prepare(`INSERT OR REPLACE INTO credentials (id, username, encrypted_password, created_at) VALUES (?, ?, ?, ?)`)
    .run(id, username, encrypted, now);

  return { id, username, encryptedPassword: encrypted, createdAt: now };
}

export function getCredential(username?: string): { username: string; password: string } | null {
  initCredentialTable();
  const db = getDb();
  const stmt = username
    ? db.prepare("SELECT * FROM credentials WHERE username = ? LIMIT 1")
    : db.prepare("SELECT * FROM credentials ORDER BY created_at DESC LIMIT 1");
  const row = (username ? stmt.get(username) : stmt.get()) as any;

  if (!row) return null;
  try {
    return { username: row.username, password: decrypt(row.encrypted_password) };
  } catch {
    return null;
  }
}

export function deleteCredential(username?: string): void {
  initCredentialTable();
  const db = getDb();
  if (username) {
    db.prepare("DELETE FROM credentials WHERE username = ?").run(username);
  } else {
    db.exec("DELETE FROM credentials");
  }
}

export function hasCredential(): boolean {
  initCredentialTable();
  const db = getDb();
  const row = db.prepare("SELECT COUNT(*) as c FROM credentials").get() as any;
  return row?.c > 0;
}
