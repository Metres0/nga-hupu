import crypto from "crypto";
import { getDb } from "@/lib/cache/db";

function getKey(): Buffer {
  const raw = process.env.AUTH_ENCRYPT_KEY || "nga-mirror-default-key-change-me";
  return crypto.createHash("sha256").update(raw).digest();
}

export function encrypt(text: string): string {
  const key = getKey();
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([cipher.update(text, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, encrypted]).toString("base64");
}

export function decrypt(payload: string): string {
  const key = getKey();
  const buf = Buffer.from(payload, "base64");
  const iv = buf.subarray(0, 16);
  const tag = buf.subarray(16, 32);
  const encrypted = buf.subarray(32);
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString("utf8");
}

export interface AuthSession {
  id: string;
  username: string;
  encryptedCookies: string;
  cookies: string;
  createdAt: number;
  expiresAt: number;
}

export function createSession(username: string, cookies: string): AuthSession {
  const db = getDb();
  const id = crypto.randomUUID();
  const now = Date.now();
  const expiresAt = now + 7 * 24 * 60 * 60 * 1000;
  const encrypted = encrypt(cookies);
  db.prepare(`INSERT OR REPLACE INTO auth_sessions (id, username, encrypted_cookies, created_at, expires_at) VALUES (?, ?, ?, ?, ?)`)
    .run(id, username, encrypted, now, expiresAt);
  return { id, username, encryptedCookies: encrypted, cookies, createdAt: now, expiresAt };
}

export function getSession(): AuthSession | null {
  const db = getDb();
  const row = db.prepare("SELECT * FROM auth_sessions ORDER BY created_at DESC LIMIT 1").get() as any;
  if (!row) return null;
  if (row.expires_at < Date.now()) { deleteSession(row.id); return null; }
  return { ...row, cookies: decrypt(row.encrypted_cookies), encryptedCookies: row.encrypted_cookies, createdAt: row.created_at, expiresAt: row.expires_at };
}

export function getDecryptedCookies(): string | null {
  const session = getSession();
  return session?.cookies ?? null;
}

export function deleteSession(id?: string): void {
  const db = getDb();
  if (id) db.prepare("DELETE FROM auth_sessions WHERE id = ?").run(id);
  else db.exec("DELETE FROM auth_sessions");
}

export function isExpiringSoon(thresholdHours: number = 3): boolean {
  const session = getSession();
  if (!session) return false;
  return session.expiresAt < Date.now() + thresholdHours * 60 * 60 * 1000;
}

export function needsRenew(): boolean {
  const session = getSession();
  return !session || session.expiresAt < Date.now() + 60 * 60 * 1000;
}
