import { agentColor, agentInitial } from "../lib/utils";

export default function AgentAvatar({
  agentId,
  size = "md",
  showPulse = false,
}: {
  agentId: string;
  size?: "sm" | "md" | "lg";
  showPulse?: boolean;
}) {
  const color = agentColor(agentId);
  const initial = agentInitial(agentId);

  const sizes = {
    sm: "w-6 h-6 text-[10px]",
    md: "w-8 h-8 text-xs",
    lg: "w-11 h-11 text-sm",
  };

  return (
    <div className="relative shrink-0">
      <div
        className={`${sizes[size]} rounded-full flex items-center justify-center font-display font-bold text-white`}
        style={{ backgroundColor: color }}
      >
        {initial}
      </div>
      {showPulse && (
        <div
          className="absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full border-2 border-deep bg-status-active animate-status-pulse"
        />
      )}
    </div>
  );
}
