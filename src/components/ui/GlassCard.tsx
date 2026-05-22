import React from "react";

interface GlassCardProps {
  children: React.ReactNode;
  className?: string;
  hover?: boolean;
  elevated?: boolean;
  onClick?: () => void;
  style?: React.CSSProperties;
}

export function GlassCard({ children, className = "", hover = false, elevated = false, onClick, style }: GlassCardProps) {
  return (
    <div onClick={onClick} style={style}
      className={`rounded-3xl glass-card ${elevated ? "glass-card-elevated" : ""}
        ${hover ? "transition-all duration-[var(--duration-medium)] ease-standard cursor-pointer hover:glass-card-elevated hover:-translate-y-0.5" : ""}
        ${className}`}>
      {children}
    </div>
  );
}

export function GlassCardHeader({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <div className={`px-5 py-3.5 border-b border-[var(--border-subtle)] ${className}`}>{children}</div>;
}

export function GlassCardContent({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <div className={`px-5 py-4 ${className}`}>{children}</div>;
}
