import { Link, useLocation } from "react-router-dom";
import GatewayHealthDot from "./GatewayHealthDot";

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
          <img
            src="/plugins/clawlens/logo-32.png"
            srcSet="/plugins/clawlens/logo-32.png 1x, /plugins/clawlens/logo-64.png 2x"
            width={24}
            height={24}
            alt=""
            aria-hidden="true"
            style={{ flexShrink: 0, display: "block" }}
          />
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
            gap: 12,
          }}
        >
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
            <NavLink to="/sessions" active={isActive("/sessions")}>
              Sessions
            </NavLink>
            <NavLink to="/activity" active={isActive("/activity")}>
              Activity
            </NavLink>
            <NavLink to="/guardrails" active={isActive("/guardrails")}>
              Guardrails
            </NavLink>
          </div>
          <GatewayHealthDot />
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
