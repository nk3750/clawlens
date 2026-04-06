import { Link, useLocation } from "react-router-dom";

export default function Nav() {
  const location = useLocation();

  const isActive = (path: string) => {
    if (path === "/") return location.pathname === "/" || location.pathname === "";
    return location.pathname.startsWith(path);
  };

  return (
    <nav className="sticky top-0 z-50 cl-glass-nav">
      <div className="max-w-6xl mx-auto px-6 h-14 flex items-center justify-between">
        {/* Brand */}
        <Link to="/" className="flex items-center gap-2.5 shrink-0 group">
          <span
            className="inline-block w-2.5 h-2.5 rounded-full transition-shadow duration-300"
            style={{
              backgroundColor: "var(--cl-accent)",
              boxShadow: "0 0 8px rgba(212, 165, 116, 0.4)",
            }}
          />
          <span
            className="font-display font-bold text-[15px] tracking-tight"
            style={{ color: "var(--cl-text-primary)" }}
          >
            ClawLens
          </span>
        </Link>

        {/* Page links */}
        <div className="flex items-center gap-1">
          <NavLink to="/" active={isActive("/")}>Agents</NavLink>
          <NavLink to="/activity" active={isActive("/activity")}>Activity</NavLink>
        </div>
      </div>
    </nav>
  );
}

function NavLink({ to, active, children }: { to: string; active: boolean; children: React.ReactNode }) {
  return (
    <Link
      to={to}
      className="relative px-3 py-1.5 text-sm font-medium transition-colors duration-200"
      style={{
        color: active ? "var(--cl-text-primary)" : "var(--cl-text-muted)",
      }}
    >
      {children}
      {active && (
        <span
          className="absolute bottom-0 left-3 right-3 h-0.5 rounded-full"
          style={{
            backgroundColor: "var(--cl-accent)",
            boxShadow: "0 0 6px rgba(212, 165, 116, 0.3)",
          }}
        />
      )}
    </Link>
  );
}
