"use client";

import { useRef, useCallback } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useUiStore } from "@/store/ui-store";
import { useAuthStore } from "@/store/auth-store";
import { getPlugin } from "@/plugins/registry";

const DOUBLE_TAP_MS = 300;

export default function BottomNav() {
  const pathname = usePathname();
  const router = useRouter();
  const lastTap = useRef<{ href: string; time: number }>({ href: "", time: 0 });
  const subscriptions = useUiStore((s) => s.subscriptions);
  const loggedIn = useAuthStore((s) => s.loggedIn);

  const handleTap = useCallback((href: string, e: React.MouseEvent) => {
    const now = Date.now();
    const same = lastTap.current.href === href && (now - lastTap.current.time) < DOUBLE_TAP_MS;
    lastTap.current = { href, time: now };

    if (same) {
      e.preventDefault();
      window.scrollTo({ top: 0, behavior: "smooth" });
      router.refresh();
    }
  }, [router]);

  const dynamicTabs = (() => {
    const tabs: Array<{ href: string; label: string; icon: string; locked?: boolean }> = [
      { href: "/", label: "首页", icon: "⌂" },
    ];
    const top3 = subscriptions.slice(0, 3);
    for (const sub of top3) {
      const plugin = getPlugin(sub.fid);
      const label = plugin?.name || sub.name;
      const locked = (plugin?.requiresLogin && !loggedIn) || false;
      tabs.push({
        href: `/forum/${sub.fid}`,
        label: label.length > 2 ? label.slice(0, 2) : label,
        icon: locked ? "🔒" : "",
        locked,
      });
    }
    while (tabs.length < 4) {
      tabs.push({ href: "/forum/-7", label: "大漩涡", icon: "🌊" });
    }
    return tabs.slice(0, 4);
  })();

  return (
    <nav className="md:hidden fixed bottom-0 inset-x-0 z-50 border-t border-[var(--border-muted)] bg-[var(--glass-bg)] backdrop-blur-xl">
      <div className="flex">
        {dynamicTabs.map((tab) => {
          const active = tab.href === "/" ? pathname === "/" : pathname.startsWith(tab.href);
          return (
            <Link
              key={tab.href}
              href={tab.href}
              onClick={(e) => handleTap(tab.href, e)}
              className={`flex-1 flex flex-col items-center justify-center py-2 text-xs no-underline transition-colors active:scale-95
                ${active ? "text-[var(--accent-blue)]" : tab.locked ? "text-[var(--text-tertiary)] opacity-50" : "text-[var(--text-tertiary)] hover:text-[var(--text-secondary)]"}`}
            >
              <span className="text-lg mb-0.5">{tab.icon || tab.label.slice(0, 2)}</span>
              <span className="font-medium">{tab.label}</span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
