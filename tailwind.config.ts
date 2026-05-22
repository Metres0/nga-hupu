import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        md: {
          primary: "var(--md-primary)", "on-primary": "var(--md-on-primary)",
          "primary-container": "var(--md-primary-container)",
          secondary: "var(--md-secondary)", "on-secondary": "var(--md-on-secondary)",
          "secondary-container": "var(--md-secondary-container)",
          tertiary: "var(--md-tertiary)", error: "var(--md-error)",
          "error-container": "var(--md-error-container)",
          surface: "var(--md-surface)", "surface-container": "var(--md-surface-container)",
          "surface-container-low": "var(--md-surface-container-low)",
          "surface-container-high": "var(--md-surface-container-high)",
          "surface-container-highest": "var(--md-surface-container-highest)",
          "on-surface": "var(--md-on-surface)",
          "on-surface-variant": "var(--md-on-surface-variant)",
          outline: "var(--md-outline)", "outline-variant": "var(--md-outline-variant)",
        },
        surface: { card: "var(--surface-card)", hover: "var(--surface-hover)", active: "var(--surface-active)" },
        border: { DEFAULT: "var(--border-default)", muted: "var(--border-muted)", subtle: "var(--md-outline-subtle)" },
        accent: { blue: "var(--accent-blue)", green: "var(--accent-green)", orange: "var(--accent-orange)", purple: "var(--accent-purple)", red: "var(--accent-red)" },
        card: { warm: "var(--card-warm)", cool: "var(--card-cool)", cream: "var(--card-cream)", plum: "var(--card-plum)", slate: "var(--card-slate)", mint: "var(--card-mint)", peach: "var(--card-peach)" },
      },
      textColor: { primary: "var(--text-primary)", secondary: "var(--text-secondary)", tertiary: "var(--text-tertiary)", link: "var(--text-link)" },
      backgroundColor: { primary: "var(--bg-primary)", secondary: "var(--bg-secondary)", tertiary: "var(--bg-tertiary)", overlay: "var(--bg-overlay)", glass: "var(--glass-bg)" },
      borderColor: { glass: "var(--glass-border)" },
      boxShadow: { card: "var(--shadow-card)", elevated: "var(--shadow-elevated)", modal: "var(--shadow-modal)", nav: "var(--shadow-nav)" },
      borderRadius: { card: "var(--radius-xl)", btn: "var(--radius-sm)", badge: "var(--radius-full)" },
      fontSize: {
        display: ["var(--fs-display)", { lineHeight: "1.2", fontWeight: "700" }],
        headline: ["var(--fs-headline)", { lineHeight: "1.3", fontWeight: "600" }],
        title: ["var(--fs-title)", { lineHeight: "1.4", fontWeight: "600" }],
        "body-lg": ["var(--fs-body-lg)", { lineHeight: "1.5" }], body: ["var(--fs-body)", { lineHeight: "1.55" }],
        "body-sm": ["var(--fs-body-sm)", { lineHeight: "1.45" }], label: ["var(--fs-label)", { lineHeight: "1.3", fontWeight: "500" }],
      },
      transitionTimingFunction: { standard: "var(--ease-standard)", emphasized: "var(--ease-emphasized)", decelerate: "var(--ease-decelerate)", accelerate: "var(--ease-accelerate)" },
      transitionDuration: { short: "var(--duration-short)", medium: "var(--duration-medium)", long: "var(--duration-long)" },
      animation: { "fade-in": "fade-in-up 0.25s var(--ease-decelerate)", "slide-up": "fade-in-up 0.3s var(--ease-emphasized)" },
    },
  },
  plugins: [],
};

export default config;
