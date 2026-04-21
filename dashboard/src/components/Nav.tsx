import { Link, useLocation } from "react-router-dom";

export default function Nav() {
  const location = useLocation();

  const isActive = (path: string) => {
    if (path === "/") return location.pathname === "/" || location.pathname === "";
    return location.pathname.startsWith(path);
  };

  return (
    <nav
      style={{
        position: "sticky",
        top: 0,
        zIndex: "var(--cl-z-nav)" as unknown as number,
        background: "var(--cl-panel)",
        borderBottom: "1px solid var(--cl-border-subtle)",
      }}
    >
      <div
        style={{
          maxWidth: 1360,
          margin: "0 auto",
          height: 48,
          padding: "0 clamp(16px, 2.5vw, 32px)",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
        }}
      >
        <Link
          to="/"
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 10,
            color: "var(--cl-text-primary)",
            textDecoration: "none",
            flexShrink: 0,
          }}
        >
          <svg
            width="24"
            height="24"
            viewBox="0 0 28 28"
            aria-hidden="true"
            style={{ flexShrink: 0 }}
          >
            <polygon
              points="14,1 25.5,7.5 25.5,20.5 14,27 2.5,20.5 2.5,7.5"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
            />
            <circle cx="14" cy="14" r="3" fill="currentColor" />
          </svg>
          <span
            style={{
              fontFamily: "var(--cl-font-sans)",
              fontSize: 14,
              fontWeight: 510,
              letterSpacing: "-0.01em",
              color: "var(--cl-text-primary)",
            }}
          >
            ClawLens
          </span>
        </Link>

        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 4,
          }}
        >
          <NavLink to="/" active={isActive("/")}>
            Agents
          </NavLink>
          <NavLink to="/activity" active={isActive("/activity")}>
            Activity
          </NavLink>
          <NavLink to="/guardrails" active={isActive("/guardrails")}>
            Guardrails
          </NavLink>
        </div>
      </div>
    </nav>
  );
}

function NavLink({
  to,
  active,
  children,
}: {
  to: string;
  active: boolean;
  children: React.ReactNode;
}) {
  return (
    <Link
      to={to}
      style={{
        position: "relative",
        padding: "12px 12px",
        fontFamily: "var(--cl-font-sans)",
        fontSize: 13,
        fontWeight: 510,
        lineHeight: 1,
        color: active ? "var(--cl-text-primary)" : "var(--cl-text-secondary)",
        textDecoration: "none",
        transition: "color var(--cl-dur-fast) var(--cl-ease)",
      }}
    >
      {children}
      {active && (
        <span
          aria-hidden="true"
          style={{
            position: "absolute",
            left: 12,
            right: 12,
            bottom: -1,
            height: 2,
            background: "var(--cl-accent)",
          }}
        />
      )}
    </Link>
  );
}
