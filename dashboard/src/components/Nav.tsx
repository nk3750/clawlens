import { Link, useLocation } from "react-router-dom";

export default function Nav() {
  const location = useLocation();

  const isActive = (path: string) => {
    if (path === "/") return location.pathname === "/" || location.pathname === "";
    return location.pathname.startsWith(path);
  };

  return (
    <nav className="sticky top-0 z-50 cl-glass-nav">
      <div className="max-w-6xl mx-auto px-6 h-16 flex items-center justify-between">
        {/* Brand — Syne font, gradient text, glow */}
        <Link to="/" className="flex items-center gap-3 shrink-0 group">
          {/* Hexagonal brand mark */}
          <svg width="28" height="28" viewBox="0 0 28 28" className="shrink-0">
            <defs>
              <linearGradient id="brand-grad" x1="0%" y1="0%" x2="100%" y2="100%">
                <stop offset="0%" stopColor="#d4a574" />
                <stop offset="100%" stopColor="#a78bfa" />
              </linearGradient>
            </defs>
            <polygon
              points="14,1 25.5,7.5 25.5,20.5 14,27 2.5,20.5 2.5,7.5"
              fill="none"
              stroke="url(#brand-grad)"
              strokeWidth="1.5"
              className="transition-all duration-500 group-hover:[filter:drop-shadow(0_0_8px_rgba(212,165,116,0.5))]"
            />
            <circle cx="14" cy="14" r="3" fill="url(#brand-grad)" opacity="0.8" />
          </svg>
          <span
            className="text-[18px] font-bold tracking-wide"
            style={{
              fontFamily: "'Syne', sans-serif",
              background: "linear-gradient(135deg, #ede9e3 30%, #d4a574 100%)",
              WebkitBackgroundClip: "text",
              WebkitTextFillColor: "transparent",
              backgroundClip: "text",
            }}
          >
            CLAWLENS
          </span>
        </Link>

        {/* Page links */}
        <div className="flex items-center gap-1">
          <NavLink to="/" active={isActive("/")}>Agents</NavLink>
          <NavLink to="/activity" active={isActive("/activity")}>Activity</NavLink>
          <NavLink to="/guardrails" active={isActive("/guardrails")}>Guardrails</NavLink>
        </div>
      </div>
    </nav>
  );
}

function NavLink({ to, active, children }: { to: string; active: boolean; children: React.ReactNode }) {
  return (
    <Link
      to={to}
      className="relative px-4 py-2 text-[13px] font-medium transition-colors duration-200"
      style={{
        fontFamily: "'DM Sans', sans-serif",
        color: active ? "var(--cl-text-primary)" : "var(--cl-text-muted)",
      }}
    >
      {children}
      {active && (
        <span
          className="absolute bottom-1 left-4 right-4 h-[2px] rounded-full"
          style={{
            backgroundColor: "var(--cl-accent)",
            boxShadow: "0 0 8px rgba(212, 165, 116, 0.4)",
          }}
        />
      )}
    </Link>
  );
}
