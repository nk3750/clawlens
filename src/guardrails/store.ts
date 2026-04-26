import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import { lookupKey } from "./identity";
import { type Guardrail, type GuardrailFile, isValidGuardrailAction } from "./types";

export class GuardrailStore {
  private byKey = new Map<string, Guardrail>();
  private all: Guardrail[] = [];
  private filePath: string;

  constructor(filePath: string) {
    this.filePath = filePath;
  }

  /** Load guardrails from disk into memory. Migrates out invalid action types. */
  load(): void {
    this.byKey.clear();
    this.all = [];

    if (!fs.existsSync(this.filePath)) return;

    try {
      const content = fs.readFileSync(this.filePath, "utf-8");
      const data = JSON.parse(content) as GuardrailFile;
      if (data.version !== 1 || !Array.isArray(data.guardrails)) return;
      this.all = data.guardrails;
    } catch {
      // Corrupted file — start fresh
      return;
    }

    // Migration: filter out guardrails with invalid action types (allow_once, allow_hours)
    const before = this.all.length;
    this.all = this.all.filter((g) => isValidGuardrailAction(g.action));
    if (this.all.length !== before) {
      this.save();
    }

    this.rebuildIndex();
  }

  /** Persist guardrails to disk atomically (write tmp + rename). */
  save(): void {
    const dir = path.dirname(this.filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    const data: GuardrailFile = { version: 1, guardrails: this.all };
    const tmpPath = `${this.filePath}.tmp`;
    fs.writeFileSync(tmpPath, JSON.stringify(data, null, 2));
    fs.renameSync(tmpPath, this.filePath);
  }

  /** Add a guardrail, persist, and update the index. */
  add(guardrail: Guardrail): void {
    this.all.push(guardrail);
    this.indexOne(guardrail);
    this.save();
  }

  /** Remove a guardrail by ID. */
  remove(id: string): boolean {
    const idx = this.all.findIndex((g) => g.id === id);
    if (idx === -1) return false;
    this.all.splice(idx, 1);
    this.rebuildIndex();
    this.save();
    return true;
  }

  /** Update fields on an existing guardrail. */
  update(id: string, patch: Partial<Pick<Guardrail, "action" | "agentId">>): Guardrail | null {
    const guardrail = this.all.find((g) => g.id === id);
    if (!guardrail) return null;

    if (patch.action !== undefined) guardrail.action = patch.action;
    if (patch.agentId !== undefined) guardrail.agentId = patch.agentId;

    this.rebuildIndex();
    this.save();
    return guardrail;
  }

  /**
   * Match a tool call against guardrails.
   * Checks agent-specific first, then global (*).
   */
  match(agentId: string, tool: string, identityKey: string): Guardrail | null {
    const agentKey = lookupKey(agentId, tool, identityKey);
    let guardrail = this.byKey.get(agentKey) ?? null;

    if (!guardrail) {
      const globalKey = lookupKey("*", tool, identityKey);
      guardrail = this.byKey.get(globalKey) ?? null;
    }

    return guardrail;
  }

  /** Read-only match — checks for a matching guardrail without side effects. */
  peek(agentId: string, tool: string, identityKey: string): Guardrail | null {
    const agentKey = lookupKey(agentId, tool, identityKey);
    let guardrail = this.byKey.get(agentKey) ?? null;

    if (!guardrail) {
      const globalKey = lookupKey("*", tool, identityKey);
      guardrail = this.byKey.get(globalKey) ?? null;
    }

    return guardrail;
  }

  /**
   * Exact lookup by the storage tuple (agentId, tool, identityKey). Unlike
   * match() / peek(), this does NOT fall through to global — it returns only
   * the guardrail stored at the *exact* scope. Used by the create endpoint
   * to enforce idempotency (a global guardrail and an agent-scoped guardrail
   * for the same tool+key are distinct rows).
   *
   * Mirrors indexOne()'s null→"*" translation so the lookup hits the same
   * key add() registered under.
   */
  findExact(agentId: string | null, tool: string, identityKey: string): Guardrail | null {
    const key = lookupKey(agentId ?? "*", tool, identityKey);
    return this.byKey.get(key) ?? null;
  }

  /** List guardrails, optionally filtered by agentId. */
  list(filters?: { agentId?: string }): Guardrail[] {
    if (!filters?.agentId) return [...this.all];
    return this.all.filter((g) => g.agentId === filters.agentId || g.agentId === null);
  }

  /** Generate a guardrail ID. */
  static generateId(): string {
    return `gr_${crypto.randomBytes(6).toString("hex")}`;
  }

  private rebuildIndex(): void {
    this.byKey.clear();
    for (const g of this.all) {
      this.indexOne(g);
    }
  }

  private indexOne(g: Guardrail): void {
    const agent = g.agentId ?? "*";
    const key = lookupKey(agent, g.tool, g.identityKey);
    this.byKey.set(key, g);
  }
}
