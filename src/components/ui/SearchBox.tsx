"use client";

import { useState, useRef, useEffect } from "react";

interface SearchBoxProps {
  onSearch: (query: string) => void;
  placeholder?: string;
}

export default function SearchBox({ onSearch, placeholder = "搜索帖子内容..." }: SearchBoxProps) {
  const [query, setQuery] = useState("");
  const [focused, setFocused] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "k" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        inputRef.current?.focus();
      }
      if (e.key === "Escape") {
        inputRef.current?.blur();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  return (
    <div className={`relative transition-all duration-300 ${focused ? "scale-[1.02]" : ""}`}>
      <div className="absolute inset-y-0 left-3 flex items-center pointer-events-none">
        <svg className="w-4 h-4 text-white/30" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
        </svg>
      </div>
      <input
        ref={inputRef}
        type="text"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && query.trim()) {
            onSearch(query.trim());
          }
        }}
        placeholder={placeholder}
        className="w-full pl-10 pr-4 py-2.5 rounded-xl bg-white/5 backdrop-blur-md border border-white/10 text-white/85 text-sm placeholder-white/25 focus:outline-none focus:border-white/20 focus:bg-white/[0.07] transition-all"
      />
      <div className="absolute inset-y-0 right-3 flex items-center pointer-events-none">
        <kbd className="hidden sm:inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded bg-white/10 text-white/25 text-[10px]">
          Ctrl+K
        </kbd>
      </div>
    </div>
  );
}
