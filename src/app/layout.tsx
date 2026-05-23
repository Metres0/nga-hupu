import type { Metadata } from "next";
import "./globals.css";
import "@/plugins/car-club";
import "@/plugins/music-film";
import "@/plugins/spring-wind-village";
import ClientLayout from "./ClientLayout";

export const metadata: Metadata = {
  title: "NGA 镜像站",
  description: "NGA 论坛镜像阅读器，基于 FluxDO 架构理念改造",
  manifest: "/manifest.json",
};

export const viewport = {
  themeColor: "#1565c0",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN" suppressHydrationWarning>
      <body className="min-h-screen antialiased">
        <ClientLayout>{children}</ClientLayout>
      </body>
    </html>
  );
}
