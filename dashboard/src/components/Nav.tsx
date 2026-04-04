import { Link, useLocation, useNavigate } from "react-router-dom";
import { useApi } from "../hooks/useApi";
import type { AgentInfo } from "../lib/types";

export default function Nav() {
  const location = useLocation();
  const navigate = useNavigate();
  const { data: agents } = useApi<AgentInfo[]>("api/agents");

  const isActive = (path: string) => {
    if (path === "/")
      return location.pathname === "/" || location.pathname === "";
    return location.pathname.startsWith(path);
  };

  return (
    <nav className="sticky top-0 z-50 border-b border-border bg-deep/80 backdrop-blur-xl">
      <div className="max-w-6xl mx-auto px-4 h-14 flex items-center gap-6">
        <Link to="/" className="flex items-center gap-2.5 shrink-0 group">
          <div className="w-2 h-2 rounded-full bg-accent group-hover:shadow-[0_0_8px_rgba(255,92,92,0.5)] transition-shadow" />
          <span className="font-display font-bold text-primary text-[15px] tracking-tight">
            ClawLens
          </span>
        </Link>

        <div className="flex items-center gap-1 ml-2">
          <NavLink to="/" active={isActive("/")}>
            Overview
          </NavLink>
          <NavLink to="/activity" active={isActive("/activity")}>
            Activity
          </NavLink>
        </div>

        {agents && agents.length > 0 && (
          <div className="ml-auto">
            <select
              className="bg-surface border border-border rounded-lg px-3 py-1.5 text-sm text-secondary focus:outline-none focus:border-accent/50 font-body cursor-pointer"
              value=""
              onChange={(e) => {
                if (e.target.value)
                  navigate(
                    `/agent/${encodeURIComponent(e.target.value)}`,
                  );
              }}
            >
              <option value="">Jump to agent...</option>
              {agents.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                  {a.status === "active" ? " \u25cf" : ""}
                </option>
              ))}
            </select>
          </div>
        )}
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
      className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
        active
          ? "bg-surface text-primary"
          : "text-muted hover:text-secondary hover:bg-surface/50"
      }`}
    >
      {children}
    </Link>
  );
}
