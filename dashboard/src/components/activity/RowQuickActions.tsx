import type { MouseEvent } from "react";
import { useNavigate } from "react-router-dom";
import type { EntryResponse } from "../../lib/types";

interface Props {
  entry: EntryResponse;
  /**
   * Phase 2.6: ActivityRow owns the GuardrailModal mount/unmount state so
   * the modal survives a hover-out (which unmounts this strip). When the
   * shield is clicked, we propagate up via this callback instead of
   * managing modal state locally.
   */
  onAddGuardrail: () => void;
}

/**
 * Hover-revealed trio of compact action buttons (22×22) that sits between
 * the tool text and the inline tag pills in an activity row. Each button
 * stops propagation so clicking it never toggles the parent row's expanded
 * state (Phase 2.2 — see activity-page-overhaul-spec.md §2.2).
 */
export default function RowQuickActions({ entry, onAddGuardrail }: Props) {
  const navigate = useNavigate();
  const command = toolString(entry);
  const sessionKey = entry.sessionKey;

  const handleCopy = (e: MouseEvent<HTMLButtonElement>) => {
    e.stopPropagation();
    navigator.clipboard?.writeText(command);
  };

  const handleAddGuardrail = (e: MouseEvent<HTMLButtonElement>) => {
    e.stopPropagation();
    onAddGuardrail();
  };

  const handleOpenSession = (e: MouseEvent<HTMLButtonElement>) => {
    e.stopPropagation();
    if (sessionKey) navigate(`/session/${encodeURIComponent(sessionKey)}`);
  };

  return (
    <span
      data-testid="activity-row-quick-actions"
      // React suppresses onClick on disabled <button>s, so the wrapper still
      // catches anything that bubbles up from a disabled child (open-session
      // when no sessionKey) before it reaches the row root.
      onClick={(e) => e.stopPropagation()}
      style={{ display: "inline-flex", gap: 4, flexShrink: 0 }}
    >
      <QuickButton
        testid="activity-row-quick-copy"
        title="copy command"
        onClick={handleCopy}
      >
        <CopyIcon />
      </QuickButton>
      <QuickButton
        testid="activity-row-quick-add-guardrail"
        title="add guardrail"
        onClick={handleAddGuardrail}
      >
        <ShieldIcon />
      </QuickButton>
      <QuickButton
        testid="activity-row-quick-open-session"
        title={sessionKey ? "open session" : "no session"}
        disabled={!sessionKey}
        onClick={handleOpenSession}
      >
        <ArrowIcon />
      </QuickButton>
    </span>
  );
}

interface QuickButtonProps {
  testid: string;
  title: string;
  onClick: (e: MouseEvent<HTMLButtonElement>) => void;
  disabled?: boolean;
  children: React.ReactNode;
}

function QuickButton({ testid, title, onClick, disabled, children }: QuickButtonProps) {
  return (
    <button
      type="button"
      data-testid={testid}
      title={title}
      onClick={onClick}
      disabled={disabled}
      style={{
        width: 22,
        height: 22,
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        background: "var(--cl-bg-04)",
        border: "1px solid var(--cl-border-subtle)",
        borderRadius: 4,
        color: "var(--cl-text-secondary)",
        padding: 0,
        cursor: disabled ? "not-allowed" : "pointer",
        opacity: disabled ? 0.55 : 1,
      }}
    >
      {children}
    </button>
  );
}

function CopyIcon() {
  return (
    <svg
      width="11"
      height="11"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <rect x="9" y="9" width="13" height="13" rx="2" />
      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
    </svg>
  );
}

function ShieldIcon() {
  return (
    <svg
      width="11"
      height="11"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
    </svg>
  );
}

function ArrowIcon() {
  return (
    <svg
      width="11"
      height="11"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M5 12h14M13 6l6 6-6 6" />
    </svg>
  );
}

/**
 * The string a "copy" action should put on the clipboard. For exec entries
 * we prefer the literal command (params.command); otherwise the tool name
 * is the most useful fallback the operator can paste.
 */
export function toolString(entry: EntryResponse): string {
  const cmd = entry.params?.command;
  if (typeof cmd === "string" && cmd.length > 0) return cmd;
  return entry.toolName;
}
