import { useCallback, useState } from "react";
import type { SummaryKind } from "../lib/types";

const BASE = "/plugins/clawlens";

interface SessionSummaryData {
  sessionKey: string;
  summary: string;
  generatedAt: string;
  isLlmGenerated?: boolean;
  summaryKind?: SummaryKind;
}

export function useSessionSummary(sessionKey: string) {
  const [summary, setSummary] = useState<string | null>(null);
  const [isLlmGenerated, setIsLlmGenerated] = useState(false);
  const [summaryKind, setSummaryKind] = useState<SummaryKind | undefined>(undefined);
  const [loading, setLoading] = useState(false);

  const generate = useCallback(() => {
    setLoading(true);
    setSummary(null);
    setIsLlmGenerated(false);
    setSummaryKind(undefined);

    fetch(`${BASE}/api/session/${encodeURIComponent(sessionKey)}/summary`)
      .then((res) => {
        if (!res.ok) return null;
        return res.json() as Promise<SessionSummaryData>;
      })
      .then((data) => {
        setSummary(data?.summary ?? null);
        setIsLlmGenerated(data?.isLlmGenerated ?? false);
        setSummaryKind(data?.summaryKind);
        setLoading(false);
      })
      .catch(() => {
        setSummary(null);
        setIsLlmGenerated(false);
        setSummaryKind(undefined);
        setLoading(false);
      });
  }, [sessionKey]);

  return { summary, isLlmGenerated, summaryKind, loading, generate };
}
