"use client";

import { create } from "zustand";

interface CacheEntry { data: unknown; timestamp: number; stale: boolean; }

interface CacheState {
  entries: Map<string, CacheEntry>;
  pendingFetches: Map<string, Promise<unknown>>;
  pinnedKeys: Set<string>;
  ttl: number;
  maxEntries: number;

  get: <T>(key: string) => { data: T; stale: boolean } | null;
  set: <T>(key: string, data: T) => void;
  prefetch: <T>(url: string, key: string, priority?: number) => Promise<T | null>;
  pin: (key: string) => void;
  unpin: (key: string) => void;
  clear: () => void;
  evictByPrefix: (prefix: string) => void;
  stats: () => { size: number; hits: number; misses: number; stale: number; pinned: number };
}

let _hits = 0;
let _misses = 0;
let _staleHits = 0;

function evictOne(state: CacheState) {
  const { entries, pinnedKeys } = state;
  for (const key of entries.keys()) {
    if (!pinnedKeys.has(key)) { entries.delete(key); return; }
  }
  if (entries.size > 0) { const firstKey = entries.keys().next().value; if (firstKey) entries.delete(firstKey); }
}

export const useCacheStore = create<CacheState>((set, get) => ({
  entries: new Map(),
  pendingFetches: new Map(),
  pinnedKeys: new Set(),
  ttl: 5 * 60 * 1000,
  maxEntries: 200,

  get: <T>(key: string) => {
    const { entries, ttl } = get();
    const entry = entries.get(key);
    if (!entry) { _misses++; return null; }
    if (Date.now() - entry.timestamp < ttl) { _hits++; return { data: entry.data as T, stale: false }; }
    _staleHits++;
    return { data: entry.data as T, stale: true };
  },

  set: <T>(key: string, data: T): void => {
    const state = get();
    if (state.entries.size >= state.maxEntries) evictOne(state);
    state.entries.set(key, { data, timestamp: Date.now(), stale: false });
  },

  prefetch: async <T>(url: string, key: string, _priority: number = 0): Promise<T | null> => {
    const state = get();
    const cached = state.get<T>(key);
    if (cached) return cached.data;

    if (state.pendingFetches.has(key)) return state.pendingFetches.get(key) as Promise<T>;
    const controller = new AbortController();
    const promise = fetch(url, { signal: controller.signal })
      .then((res) => { if (!res.ok) throw new Error("prefetch failed"); return res.json(); })
      .then((json) => { if (json.error) return null; state.set(key, json); return json as T; })
      .catch(() => null)
      .finally(() => { state.pendingFetches.delete(key); });
    state.pendingFetches.set(key, promise);
    return promise;
  },

  pin: (key: string) => { get().pinnedKeys.add(key); },
  unpin: (key: string) => { get().pinnedKeys.delete(key); },
  clear: () => { set({ entries: new Map(), pendingFetches: new Map(), pinnedKeys: new Set() }); _hits = 0; _misses = 0; _staleHits = 0; },
  evictByPrefix: (prefix: string) => {
    const { entries, pinnedKeys } = get();
    for (const key of entries.keys()) {
      if (key.startsWith(prefix)) { entries.delete(key); pinnedKeys.delete(key); }
    }
  },
  stats: () => ({ size: get().entries.size, hits: _hits, misses: _misses, stale: _staleHits, pinned: get().pinnedKeys.size }),
}));

export function getCacheKey(type: string, id: number, page?: number) {
  return page ? `${type}:${id}:${page}` : `${type}:${id}`;
}
