"use client";

import { useState, useEffect } from "react";

const STORAGE_KEY = "nga-read-tids";

function loadReadTids(): Set<number> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return new Set(JSON.parse(raw));
  } catch {}
  return new Set();
}

function saveReadTids(tids: Set<number>) {
  try {
    const arr = [...tids].slice(-500);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(arr));
  } catch {}
}

let _readCache: Set<number> | null = null;

export function isRead(tid: number): boolean {
  if (!_readCache) _readCache = loadReadTids();
  return _readCache.has(tid);
}

export function markAsRead(tid: number): void {
  if (!_readCache) _readCache = loadReadTids();
  _readCache.add(tid);
  saveReadTids(_readCache);
}

export function useReadTids() {
  const [readTids, setReadTids] = useState<Set<number>>(() => loadReadTids());

  useEffect(() => {
    _readCache = readTids;
    saveReadTids(readTids);
  }, [readTids]);

  const mark = (tid: number) => {
    setReadTids((prev) => {
      const next = new Set(prev);
      next.add(tid);
      return next;
    });
  };

  return { readTids, markAsRead: mark, isRead: (tid: number) => readTids.has(tid) };
}
