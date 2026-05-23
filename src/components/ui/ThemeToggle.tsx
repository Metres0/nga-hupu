"use client";

import { useTheme } from "@/lib/theme";

export default function ThemeToggle() {
  const { theme, toggle } = useTheme();
  return (
    <button
      onClick={toggle}
      className="fixed bottom-24 md:bottom-6 right-6 md:right-[108px] z-50 w-10 h-10 rounded-2xl border border-[var(--border-subtle)] bg-[var(--card-cream)] shadow-card hover:shadow-elevated backdrop-blur-sm transition-all duration-[var(--duration-medium)] ease-standard hover:scale-105 active:scale-95 flex items-center justify-center text-sm"
      title={theme === "dark" ? "亮色模式" : "暗色模式"}
    >
      {theme === "dark" ? "☀" : "☾"}
    </button>
  );
}
