import { useState, useCallback } from "react";

const BASE = "/plugins/clawlens";

interface SessionSummaryData {
  sessionKey: string;
  summary: string;
  generatedAt: string;
  isLlmGenerated?: boolean;
}

export function useSessionSummary(sessionKey: string) {
  const [summary, setSummary] = useState<string | null>(null);
  const [isLlmGenerated, setIsLlmGenerated] = useState(false);
  const [loading, setLoading] = useState(false);

  const generate = useCallback(() => {
    setLoading(true);
    setSummary(null);
    setIsLlmGenerated(false);

    fetch(`${BASE}/api/session/${encodeURIComponent(sessionKey)}/summary`)
      .then((res) => {
        if (!res.ok) return null;
        return res.json() as Promise<SessionSummaryData>;
      })
      .then((data) => {
        setSummary(data?.summary ?? null);
        setIsLlmGenerated(data?.isLlmGenerated ?? false);
        setLoading(false);
      })
      .catch(() => {
        setSummary(null);
        setIsLlmGenerated(false);
        setLoading(false);
      });
  }, [sessionKey]);

  return { summary, isLlmGenerated, loading, generate };
}
