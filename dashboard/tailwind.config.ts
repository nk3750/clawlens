import type { Config } from "tailwindcss";

export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        cl: {
          bg: "#0d0f15",
          surface: "#14141c",
          elevated: "#1d1d29",
          "text-primary": "#ede9e3",
          "text-secondary": "#948e85",
          "text-muted": "#5c574f",
          accent: "#d4a574",
          "risk-low": "#4ade80",
          "risk-medium": "#fbbf24",
          "risk-high": "#f87171",
          "risk-critical": "#ef4444",
          "cat-exploring": "#60a5fa",
          "cat-changes": "#fbbf24",
          "cat-commands": "#a78bfa",
          "cat-web": "#22d3ee",
          "cat-comms": "#4ade80",
          "cat-data": "#fb923c",
        },
      },
      fontFamily: {
        // Phase-2 pivot: Syne / Bricolage Grotesque / DM Sans are retired.
        // All `font-brand|display|body` utility class usages now resolve to
        // Inter — matches the new design token system and keeps out-of-scope
        // pages (Activity, AgentHeader, SessionHeader, etc.) rendering with
        // the correct family until Stage D rewrites their class usage.
        brand: ['"Inter"', '"Inter Variable"', "ui-sans-serif", "system-ui", "sans-serif"],
        display: ['"Inter"', '"Inter Variable"', "ui-sans-serif", "system-ui", "sans-serif"],
        body: ['"Inter"', '"Inter Variable"', "ui-sans-serif", "system-ui", "sans-serif"],
        mono: ['"JetBrains Mono"', "ui-monospace", "monospace"],
      },
      borderRadius: {
        card: "16px",
      },
    },
  },
  plugins: [],
} satisfies Config;
