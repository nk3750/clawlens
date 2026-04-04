import type { Config } from "tailwindcss";

export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        deep: "#06070b",
        surface: "#0f1117",
        card: "#141620",
        elevated: "#1a1d28",
        border: "#1e2130",
        "border-hover": "#2d3148",
        primary: "#eeeef0",
        secondary: "#9395a1",
        muted: "#55576a",
        accent: "#ff5c5c",
        risk: {
          low: "#34d399",
          medium: "#fbbf24",
          high: "#f87171",
          critical: "#ff4040",
        },
        status: {
          active: "#34d399",
          idle: "#55576a",
        },
      },
      fontFamily: {
        display: ['"Bricolage Grotesque"', "sans-serif"],
        body: ['"DM Sans"', "sans-serif"],
        mono: ['"JetBrains Mono"', "ui-monospace", "monospace"],
      },
      animation: {
        "fade-in": "fadeIn 0.4s ease-out both",
        "slide-in": "slideIn 0.3s ease-out both",
        "pulse-critical": "pulseCritical 2s ease-in-out infinite",
        "status-pulse": "statusPulse 2s ease-in-out infinite",
      },
      keyframes: {
        fadeIn: {
          from: { opacity: "0", transform: "translateY(8px)" },
          to: { opacity: "1", transform: "translateY(0)" },
        },
        slideIn: {
          from: { opacity: "0", transform: "translateY(-12px)" },
          to: { opacity: "1", transform: "translateY(0)" },
        },
        pulseCritical: {
          "0%, 100%": { opacity: "1" },
          "50%": { opacity: "0.6" },
        },
        statusPulse: {
          "0%, 100%": { boxShadow: "0 0 0 0 rgba(52, 211, 153, 0.4)" },
          "50%": { boxShadow: "0 0 0 4px rgba(52, 211, 153, 0)" },
        },
      },
    },
  },
  plugins: [],
} satisfies Config;
