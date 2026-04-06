import { agentGradient } from "../lib/utils";

interface Props {
  agentId: string;
  size?: "sm" | "md" | "lg";
}

const SIZES = { sm: 32, md: 44, lg: 60 };

export default function GradientAvatar({ agentId, size = "md" }: Props) {
  const [c1, c2] = agentGradient(agentId);
  const px = SIZES[size];
  return (
    <div
      className="rounded-full shrink-0"
      style={{
        width: px,
        height: px,
        background: `linear-gradient(135deg, ${c1}, ${c2})`,
        boxShadow: `0 0 ${px / 3}px ${c1}25, inset 0 1px 2px rgba(255,255,255,0.15)`,
      }}
    />
  );
}
