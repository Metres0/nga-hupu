"use client";

import Link from "next/link";

export default function NotFound() {
  return (
    <div className="flex items-center justify-center min-h-[60vh]">
      <div className="text-center px-4">
        <h1 className="text-6xl font-bold text-[var(--text-tertiary)] mb-3">404</h1>
        <p className="text-[var(--text-secondary)] mb-6">页面不存在</p>
        <div className="flex gap-3 justify-center">
          <Link href="/" className="no-underline">
            <span className="px-4 py-2 rounded-md bg-[var(--accent-blue)] text-white text-sm font-medium hover:bg-[#4090e0] transition-colors">返回首页</span>
          </Link>
        </div>
      </div>
    </div>
  );
}
