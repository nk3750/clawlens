import type { AgentInfo } from "../lib/types";

interface FiltersProps {
  agents: AgentInfo[];
  selectedAgent: string;
  onAgentChange: (agent: string) => void;
  selectedTool: string;
  onToolChange: (tool: string) => void;
  selectedRisk: string;
  onRiskChange: (risk: string) => void;
  selectedTime: string;
  onTimeChange: (time: string) => void;
  tools: string[];
}

const selectClass =
  "bg-surface border border-border rounded-lg px-3 py-2 text-sm text-secondary focus:outline-none focus:border-accent/50 font-body cursor-pointer";

export default function Filters({
  agents,
  selectedAgent,
  onAgentChange,
  selectedTool,
  onToolChange,
  selectedRisk,
  onRiskChange,
  selectedTime,
  onTimeChange,
  tools,
}: FiltersProps) {
  return (
    <div className="flex flex-wrap gap-2 mb-4">
      <select
        className={selectClass}
        value={selectedAgent}
        onChange={(e) => onAgentChange(e.target.value)}
      >
        <option value="">All Agents</option>
        {agents.map((a) => (
          <option key={a.id} value={a.id}>
            {a.name}
          </option>
        ))}
      </select>

      <select
        className={selectClass}
        value={selectedTool}
        onChange={(e) => onToolChange(e.target.value)}
      >
        <option value="">All Tools</option>
        {tools.map((t) => (
          <option key={t} value={t}>
            {t}
          </option>
        ))}
      </select>

      <select
        className={selectClass}
        value={selectedRisk}
        onChange={(e) => onRiskChange(e.target.value)}
      >
        <option value="">All Risk</option>
        <option value="low">Low</option>
        <option value="medium">Medium</option>
        <option value="high">High</option>
        <option value="critical">Critical</option>
      </select>

      <select
        className={selectClass}
        value={selectedTime}
        onChange={(e) => onTimeChange(e.target.value)}
      >
        <option value="1h">Last 1h</option>
        <option value="6h">Last 6h</option>
        <option value="24h">Last 24h</option>
        <option value="7d">Last 7d</option>
        <option value="">All time</option>
      </select>
    </div>
  );
}
