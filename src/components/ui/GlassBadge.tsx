interface GlassBadgeProps { children: React.ReactNode; variant?: "default" | "accent" | "sticky" | "digest" | "hot"; className?: string; }

export function GlassBadge({ children, variant = "default", className = "" }: GlassBadgeProps) {
  const bg: Record<string, string> = {
    default: "bg-[var(--surface-hover)] text-[var(--text-secondary)]",
    accent: "bg-[var(--md-primary-container)] text-[var(--md-on-primary-container)]",
    sticky: "bg-[rgba(198,40,40,0.08)] text-[var(--accent-red)]",
    digest: "bg-[rgba(184,134,11,0.08)] text-[#b8860b]",
    hot: "bg-[rgba(230,81,0,0.08)] text-[var(--accent-orange)]",
  };
  return <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${bg[variant]} ${className}`}>{children}</span>;
}
