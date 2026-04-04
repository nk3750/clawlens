export default function RiskTags({ tags }: { tags?: string[] }) {
  if (!tags || tags.length === 0) return null;

  return (
    <div className="flex flex-wrap gap-1">
      {tags.map((tag) => (
        <span
          key={tag}
          className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-elevated text-muted border border-border/50"
        >
          {tag}
        </span>
      ))}
    </div>
  );
}
