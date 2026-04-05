import type { AgentInfo } from "../lib/types";
import AgentAvatar from "./AgentAvatar";

interface FiltersProps {
  agents: AgentInfo[];
  selectedAgent: string;
  onAgentChange: (agent: string) => void;
  selectedRisk: string;
  onRiskChange: (risk: string) => void;
  selectedTime: string;
  onTimeChange: (time: string) => void;
}

export default function Filters({
  agents,
  selectedAgent,
  onAgentChange,
  selectedRisk,
  onRiskChange,
  selectedTime,
  onTimeChange,
}: FiltersProps) {
  return (
    <div className="flex flex-wrap items-center gap-2 mb-5">
      {/* Agent pills */}
      <div className="flex items-center gap-1.5">
        <Pill active={!selectedAgent} onClick={() => onAgentChange("")}>
          All
        </Pill>
        {agents.map((a) => (
          <Pill
            key={a.id}
            active={selectedAgent === a.id}
            onClick={() => onAgentChange(selectedAgent === a.id ? "" : a.id)}
          >
            <AgentAvatar agentId={a.id} size="sm" />
            <span className="hidden sm:inline">{a.name}</span>
          </Pill>
        ))}
      </div>

      <div className="w-px h-5 bg-border mx-1 hidden sm:block" />

      {/* Risk pills */}
      <div className="flex items-center gap-1">
        {(["low", "medium", "high", "critical"] as const).map((r) => (
          <Pill
            key={r}
            active={selectedRisk === r}
            onClick={() => onRiskChange(selectedRisk === r ? "" : r)}
          >
            <span
              className="w-1.5 h-1.5 rounded-full"
              style={{
                backgroundColor:
                  r === "low" ? "#34d399" : r === "medium" ? "#fbbf24" : r === "high" ? "#f87171" : "#ff4040",
              }}
            />
            <span className="hidden sm:inline capitalize">{r}</span>
          </Pill>
        ))}
      </div>

      <div className="w-px h-5 bg-border mx-1 hidden sm:block" />

      {/* Time pills */}
      <div className="flex items-center gap-1">
        {[
          { value: "1h", label: "1h" },
          { value: "6h", label: "6h" },
          { value: "24h", label: "24h" },
          { value: "7d", label: "7d" },
          { value: "", label: "All" },
        ].map((t) => (
          <Pill
            key={t.value}
            active={selectedTime === t.value}
            onClick={() => onTimeChange(t.value)}
          >
            {t.label}
          </Pill>
        ))}
      </div>
    </div>
  );
}

function Pill({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium transition-all duration-200 ${
        active
          ? "bg-elevated text-primary border border-border-hover shadow-sm"
          : "text-muted hover:text-secondary hover:bg-surface/60 border border-transparent"
      }`}
    >
      {children}
    </button>
  );
}
