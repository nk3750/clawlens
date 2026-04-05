import { Link, useLocation, useNavigate } from "react-router-dom";
import { useApi } from "../hooks/useApi";
import type { AgentInfo } from "../lib/types";
import AgentAvatar from "./AgentAvatar";

export default function Nav() {
  const location = useLocation();
  const navigate = useNavigate();
  const { data: agents } = useApi<AgentInfo[]>("api/agents");

  const activeCount = agents?.filter((a) => a.status === "active").length || 0;

  const isActive = (path: string) => {
    if (path === "/") return location.pathname === "/" || location.pathname === "";
    return location.pathname.startsWith(path);
  };

  return (
    <nav className="sticky top-0 z-50 border-b border-border/60 bg-deep/70 backdrop-blur-2xl">
      <div className="max-w-5xl mx-auto px-4 sm:px-6 h-14 flex items-center gap-5">
        {/* Brand */}
        <Link to="/" className="flex items-center gap-2.5 shrink-0 group">
          <div className="w-2 h-2 rounded-full bg-accent group-hover:shadow-[0_0_10px_rgba(255,92,92,0.6)] transition-shadow duration-300" />
          <span className="font-display font-bold text-primary text-[15px] tracking-tight">
            ClawLens
          </span>
          {activeCount > 0 && (
            <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-status-active/10 text-status-active font-medium">
              {activeCount} live
            </span>
          )}
        </Link>

        {/* Nav links */}
        <div className="flex items-center gap-1">
          <NavLink to="/" active={isActive("/")}>Overview</NavLink>
          <NavLink to="/activity" active={isActive("/activity")}>Activity</NavLink>
        </div>

        {/* Agent jump */}
        {agents && agents.length > 1 && (
          <div className="ml-auto hidden sm:flex items-center gap-2">
            {agents.slice(0, 4).map((a) => (
              <button
                key={a.id}
                onClick={() => navigate(`/agent/${encodeURIComponent(a.id)}`)}
                className="opacity-60 hover:opacity-100 transition-opacity"
                title={a.name}
              >
                <AgentAvatar agentId={a.id} size="sm" showPulse={a.status === "active"} />
              </button>
            ))}
          </div>
        )}
      </div>
    </nav>
  );
}

function NavLink({ to, active, children }: { to: string; active: boolean; children: React.ReactNode }) {
  return (
    <Link
      to={to}
      className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-all duration-200 ${
        active
          ? "bg-elevated text-primary shadow-sm"
          : "text-muted hover:text-secondary hover:bg-surface/60"
      }`}
    >
      {children}
    </Link>
  );
}
