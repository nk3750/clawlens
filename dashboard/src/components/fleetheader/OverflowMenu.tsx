import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { todayLocalISO } from "./utils";

interface Props {
  /** Current guardrail count — surfaced inside the menu rather than as a tile. */
  guardrailCount: number;
  /** YYYY-MM-DD currently being viewed; null = today. Drives the export filter. */
  selectedDate: string | null;
  /** Current range pill, included in the copy-digest URL so reload matches state. */
  rangeParam: string;
}

const BASE = "/plugins/clawlens";

/**
 * "⋯" overflow menu — low-frequency actions that don't deserve a tile.
 * Per spec §9: View guardrails, Export audit log, Copy digest link, plus a
 * disabled placeholder for the future Generate Report button.
 *
 * `role="menu"` with arrow-key + Home/End navigation per spec §12. Closes on
 * Escape, click-outside, or item activation.
 */
export default function OverflowMenu({ guardrailCount, selectedDate, rangeParam }: Props) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const itemsRef = useRef<HTMLElement[]>([]);

  const close = useCallback(() => {
    setOpen(false);
    triggerRef.current?.focus();
  }, []);

  useEffect(() => {
    if (!open) return;
    function onDocClick(e: MouseEvent) {
      const target = e.target as Node;
      if (menuRef.current?.contains(target)) return;
      if (triggerRef.current?.contains(target)) return;
      setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        close();
      }
    }
    document.addEventListener("mousedown", onDocClick);
    window.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      window.removeEventListener("keydown", onKey);
    };
  }, [open, close]);

  // Focus the first menu item on open.
  useEffect(() => {
    if (!open) return;
    const focusables = Array.from(
      menuRef.current?.querySelectorAll<HTMLElement>("[role='menuitem']:not([aria-disabled='true'])") ?? [],
    );
    itemsRef.current = focusables;
    focusables[0]?.focus();
  }, [open]);

  function focusByDelta(delta: number) {
    const items = itemsRef.current;
    if (items.length === 0) return;
    const idx = items.findIndex((el) => el === document.activeElement);
    const nextIdx = (idx + delta + items.length) % items.length;
    items[nextIdx]?.focus();
  }

  function onMenuKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      focusByDelta(1);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      focusByDelta(-1);
    } else if (e.key === "Home") {
      e.preventDefault();
      itemsRef.current[0]?.focus();
    } else if (e.key === "End") {
      e.preventDefault();
      itemsRef.current[itemsRef.current.length - 1]?.focus();
    }
  }

  const exportDate = selectedDate ?? todayLocalISO();
  const exportHref = `${BASE}/api/audit/export?date=${exportDate}`;

  function copyDigestLink() {
    if (typeof window === "undefined") return;
    const url = new URL(window.location.href);
    if (selectedDate) {
      url.searchParams.set("date", selectedDate);
    } else {
      url.searchParams.delete("date");
    }
    url.searchParams.set("range", rangeParam);
    void navigator.clipboard?.writeText(url.toString()).catch(() => {
      /* clipboard may be denied — silent failure is fine, no crash */
    });
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1400);
  }

  return (
    <span style={{ position: "relative", display: "inline-flex" }}>
      <button
        ref={triggerRef}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="More actions"
        onClick={() => setOpen((v) => !v)}
        className="btn-press"
        style={{
          width: 28,
          height: 28,
          borderRadius: "var(--cl-radius-sm, 6px)",
          border: "1px solid var(--cl-border-subtle)",
          background: "transparent",
          color: "var(--cl-text-muted)",
          cursor: "pointer",
          display: "inline-grid",
          placeItems: "center",
          fontFamily: "ui-monospace, monospace",
          fontSize: 16,
          letterSpacing: "0.05em",
        }}
      >
        ⋯
      </button>

      {open && (
        <div
          ref={menuRef}
          role="menu"
          aria-label="More fleet actions"
          onKeyDown={onMenuKeyDown}
          style={{
            position: "absolute",
            top: "calc(100% + 6px)",
            right: 0,
            zIndex: 30,
            minWidth: 220,
            background: "var(--cl-surface)",
            border: "1px solid var(--cl-border-default)",
            borderRadius: "var(--cl-radius-md, 8px)",
            boxShadow: "0 8px 24px rgba(0,0,0,0.4)",
            padding: 4,
            display: "flex",
            flexDirection: "column",
            gap: 1,
            animation: "cascade-in 0.18s var(--cl-spring) both",
          }}
        >
          <Link
            role="menuitem"
            to="/guardrails"
            onClick={() => close()}
            style={menuItemStyle()}
          >
            <span>View guardrails</span>
            <span
              className="font-mono"
              style={{ color: "var(--cl-text-muted)", fontSize: 11 }}
            >
              {guardrailCount}
            </span>
          </Link>
          <a
            role="menuitem"
            href={exportHref}
            download={`clawlens-audit-${exportDate}.jsonl`}
            onClick={() => close()}
            style={menuItemStyle()}
          >
            <span>
              Export audit log{selectedDate ? ` (${selectedDate})` : " (today)"}
            </span>
          </a>
          <button
            role="menuitem"
            type="button"
            onClick={copyDigestLink}
            style={{ ...menuItemStyle(), background: "none", border: "none", textAlign: "left" }}
          >
            <span>{copied ? "Copied!" : "Copy digest link"}</span>
          </button>
          <span
            role="menuitem"
            aria-disabled="true"
            style={{
              ...menuItemStyle(),
              color: "var(--cl-text-muted)",
              opacity: 0.55,
              cursor: "not-allowed",
            }}
          >
            <span>Generate report</span>
            <span
              className="font-mono"
              style={{ fontSize: 10, color: "var(--cl-text-muted)" }}
            >
              soon
            </span>
          </span>
        </div>
      )}
    </span>
  );
}

function menuItemStyle(): React.CSSProperties {
  return {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
    padding: "8px 10px",
    borderRadius: "var(--cl-radius-sm, 6px)",
    background: "transparent",
    color: "var(--cl-text-primary)",
    fontFamily: "'DM Sans', sans-serif",
    fontSize: 12,
    cursor: "pointer",
    textDecoration: "none",
  };
}
