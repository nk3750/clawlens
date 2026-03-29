import type { AuditEntry } from "./logger";

/**
 * Generate a narrative daily digest from audit log entries.
 */
export function generateDigest(
  entries: AuditEntry[],
  date?: Date,
): string {
  const now = date || new Date();
  const dateStr = now.toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
  });

  const lines: string[] = [];
  lines.push(`ClawClip Daily Summary (${dateStr})`);
  lines.push("");

  // Separate decision entries from result/resolution entries
  const decisions = entries.filter(
    (e) =>
      !e.executionResult &&
      !e.userResponse,
  );

  const resolutions = entries.filter((e) => e.userResponse);
  const approved = resolutions.filter((e) => e.userResponse === "approved");
  const denied = resolutions.filter((e) => e.userResponse === "denied");
  const timedOut = resolutions.filter((e) => e.userResponse === "timeout");

  const allowed = decisions.filter((e) => e.decision === "allow");
  const blocked = decisions.filter((e) => e.decision === "block");

  const total = decisions.length;
  if (total === 0) {
    lines.push("No tool calls recorded today.");
    return lines.join("\n");
  }

  lines.push(
    `Your agent made ${total} tool call${total !== 1 ? "s" : ""} today.`,
  );

  const parts: string[] = [];
  if (allowed.length > 0)
    parts.push(`${allowed.length} auto-allowed (reads, searches)`);
  if (approved.length > 0)
    parts.push(`${approved.length} approved by you`);
  if (blocked.length > 0)
    parts.push(`${blocked.length} blocked by policy`);
  if (timedOut.length > 0)
    parts.push(`${timedOut.length} timed out (denied)`);
  if (denied.length > 0)
    parts.push(`${denied.length} denied by you`);

  for (const part of parts) {
    lines.push(`- ${part}`);
  }

  // Highlight blocked actions (up to 5)
  if (blocked.length > 0) {
    lines.push("");
    for (const entry of blocked.slice(0, 5)) {
      const time = new Date(entry.timestamp).toLocaleTimeString("en-US", {
        hour: "numeric",
        minute: "2-digit",
      });
      const detail = entry.params?.command
        ? `\`${entry.params.command}\``
        : `\`${entry.toolName}\``;
      const rule = entry.policyRule || "policy";
      lines.push(
        `Blocked: Agent tried to run ${detail} at ${time} — blocked by "${rule}" rule.`,
      );
    }
  }

  // Highlight approved actions (up to 5)
  if (approved.length > 0) {
    lines.push("");
    for (const entry of approved.slice(0, 5)) {
      const time = new Date(entry.timestamp).toLocaleTimeString("en-US", {
        hour: "numeric",
        minute: "2-digit",
      });
      lines.push(
        `Approved: You approved \`${entry.toolName}\` at ${time}.`,
      );
    }
  }

  lines.push("");
  lines.push("No anomalies detected.");

  return lines.join("\n");
}
