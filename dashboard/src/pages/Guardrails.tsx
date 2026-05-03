import { useCallback, useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import GuardrailDetailPane, {
  type PatchBody,
} from "../components/guardrails/GuardrailDetailPane";
import GuardrailEmptyState from "../components/guardrails/GuardrailEmptyState";
import GuardrailFilterRail from "../components/guardrails/GuardrailFilterRail";
import GuardrailList from "../components/guardrails/GuardrailList";
import { applyFilters, computeCounts, type Filters } from "../components/guardrails/shared";
import { useApi } from "../hooks/useApi";
import type { Guardrail } from "../lib/types";

const BASE = "/plugins/clawlens";

export default function Guardrails() {
  const { data, loading, refetch } = useApi<{ guardrails: Guardrail[] }>("api/guardrails");
  // ?selected=<id> deep-links from activity rows, attention items, and the
  // smart shield button. Source of truth is the URL — local state mirrors
  // it so refresh / share preserves the selection (#52).
  const [searchParams, setSearchParams] = useSearchParams();
  const urlSelected = searchParams.get("selected") || null;
  const [selectedId, setSelectedIdInternal] = useState<string | null>(urlSelected);
  const [filters, setFilters] = useState<Filters>({});

  const rules = data?.guardrails ?? [];
  const filtered = applyFilters(rules, filters);
  const counts = computeCounts(rules);
  const selected = rules.find((r) => r.id === selectedId) ?? null;

  // If ?selected=<id> points at a rule that doesn't exist (deleted upstream,
  // typo'd link), clear the URL param and the local state. Wait for rules
  // to load so we don't drop the param before the GET resolves.
  useEffect(() => {
    if (!selectedId) return;
    if (loading) return;
    if (rules.length === 0) return;
    if (rules.some((r) => r.id === selectedId)) return;
    setSelectedIdInternal(null);
    if (searchParams.has("selected")) {
      const next = new URLSearchParams(searchParams);
      next.delete("selected");
      setSearchParams(next, { replace: true });
    }
  }, [selectedId, rules, loading, searchParams, setSearchParams]);

  // Wrap the setter so every selection change writes through to the URL.
  // Same-tab navigations (and the deep-link initial mount) stay in lockstep.
  const setSelectedId = useCallback(
    (id: string | null) => {
      setSelectedIdInternal(id);
      const next = new URLSearchParams(searchParams);
      if (id) next.set("selected", id);
      else next.delete("selected");
      setSearchParams(next, { replace: true });
    },
    [searchParams, setSearchParams],
  );

  async function handlePatch(patch: PatchBody): Promise<void> {
    if (!selectedId) return;
    const res = await fetch(`${BASE}/api/guardrails/${encodeURIComponent(selectedId)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    });
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as Record<string, string>;
      throw new Error(body.error || `HTTP ${res.status}`);
    }
    refetch();
  }

  async function handleDelete(): Promise<void> {
    if (!selectedId) return;
    const res = await fetch(`${BASE}/api/guardrails/${encodeURIComponent(selectedId)}`, {
      method: "DELETE",
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    setSelectedId(null);
    refetch();
  }

  return (
    <div className="flex" style={{ height: "calc(100vh - 64px)" }}>
      <GuardrailFilterRail filters={filters} setFilters={setFilters} counts={counts} />
      <GuardrailList
        rules={filtered}
        selectedId={selectedId}
        onSelect={setSelectedId}
        hasAnyRules={rules.length > 0}
      />
      <main className="flex-1 overflow-auto" style={{ backgroundColor: "var(--cl-bg)" }}>
        {loading && rules.length === 0 ? (
          <p
            className="px-8 py-10 text-sm"
            style={{ color: "var(--cl-text-muted)" }}
          >
            Loading…
          </p>
        ) : selected ? (
          <GuardrailDetailPane rule={selected} onPatch={handlePatch} onDelete={handleDelete} />
        ) : (
          <GuardrailEmptyState rules={rules} onSelect={setSelectedId} />
        )}
      </main>
    </div>
  );
}
