import { useEffect, useRef } from "react";

/**
 * Fire `handler` when the user presses `key` while focus is inside an element
 * matching `scopeSelector`. Typing inside form controls never fires the
 * shortcut — a reviewer holding 'a' in a search box must not ack anything.
 *
 * Scope example: AttentionInbox attaches `data-attention-inbox` on its wrapper
 * and passes `[data-attention-inbox]` here. The hook gates on
 * `document.activeElement.closest(selector)` at keydown time.
 */
export function useKeyboardShortcut(
  key: string,
  handler: () => void,
  scopeSelector?: string,
  enabled: boolean = true,
): void {
  const handlerRef = useRef(handler);
  handlerRef.current = handler;

  useEffect(() => {
    if (!enabled) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== key) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;

      const active = document.activeElement as HTMLElement | null;
      const tag = active?.tagName?.toLowerCase();
      if (
        active?.isContentEditable ||
        tag === "input" ||
        tag === "textarea" ||
        tag === "select"
      ) {
        return;
      }

      if (scopeSelector) {
        if (!active?.closest(scopeSelector)) return;
      }

      e.preventDefault();
      handlerRef.current();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [key, scopeSelector, enabled]);
}
