"use client";

import dynamic from "next/dynamic";
import { ThemeProvider } from "@/lib/theme";
import ThemeToggle from "@/components/ui/ThemeToggle";
import Sidebar from "@/components/widgets/Sidebar";
import BottomNav from "@/components/widgets/BottomNav";
import BackToTop from "@/components/widgets/BackToTop";

const LoginDialog = dynamic(() => import("@/components/widgets/LoginDialog"), { ssr: false });

export default function ClientLayout({ children }: { children: React.ReactNode }) {
  return (
    <ThemeProvider>
      <div className="flex min-h-screen">
        <Sidebar />
        <main className="flex-1 min-w-0 pb-16 md:pb-0">
          {children}
        </main>
        <BottomNav />
      </div>
      <BackToTop />
      <ThemeToggle />
      <LoginDialog />
    </ThemeProvider>
  );
}
