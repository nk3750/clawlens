import { useState, useEffect } from "react";

const BASE = "/plugins/clawlens";

interface SessionSummaryData {
  sessionKey: string;
  summary: string;
  generatedAt: string;
}

export function useSessionSummary(sessionKey: string) {
  const [summary, setSummary] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setSummary(null);

    fetch(`${BASE}/api/session/${encodeURIComponent(sessionKey)}/summary`)
      .then((res) => {
        if (!res.ok) return null;
        return res.json() as Promise<SessionSummaryData>;
      })
      .then((data) => {
        if (!cancelled) {
          setSummary(data?.summary ?? null);
          setLoading(false);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setSummary(null);
          setLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [sessionKey]);

  return { summary, loading };
}
