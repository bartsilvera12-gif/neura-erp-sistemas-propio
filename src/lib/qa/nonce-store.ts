/**
 * Store de nonces para dedupe anti-replay del HMAC del runner.
 *
 * Contrato: `tryConsume(nonce, expiresAt)` devuelve
 *   - `true` si el nonce no se había visto (y queda registrado hasta expiresAt)
 *   - `false` si ya se consumió (replay, debe rechazarse)
 *
 * Dos implementaciones:
 *   - InMemoryNonceStore: para tests y para single-process (OK en dev local).
 *     NO es seguro en despliegues multi-instance (cada proceso tiene su Map).
 *   - SupabaseNonceStore: usa INSERT ON CONFLICT DO NOTHING sobre
 *     `qa_center.runner_nonces`. Atómico incluso con N réplicas del ERP.
 */

import type { AppSupabaseClient } from "@/lib/supabase/schema";

export interface NonceStore {
  tryConsume(input: {
    nonce: string;
    runnerId: string;
    expiresAt: Date;
  }): Promise<boolean>;
}

// ──────────────────────────────── en memoria ────────────────────────────────

export class InMemoryNonceStore implements NonceStore {
  private readonly seen = new Map<string, number>(); // nonce → expiresMs

  async tryConsume(input: {
    nonce: string;
    runnerId: string;
    expiresAt: Date;
  }): Promise<boolean> {
    const now = Date.now();
    for (const [k, exp] of this.seen) {
      if (exp <= now) this.seen.delete(k);
    }
    if (this.seen.has(input.nonce)) return false;
    this.seen.set(input.nonce, input.expiresAt.getTime());
    return true;
  }
}

// ──────────────────────────────── Supabase ──────────────────────────────────

export class SupabaseNonceStore implements NonceStore {
  constructor(private readonly client: AppSupabaseClient) {}

  async tryConsume(input: {
    nonce: string;
    runnerId: string;
    expiresAt: Date;
  }): Promise<boolean> {
    const qc = this.client.schema("qa_center");
    const { data, error } = await qc
      .from("runner_nonces")
      .upsert(
        {
          nonce: input.nonce,
          runner_id: input.runnerId,
          expires_at: input.expiresAt.toISOString(),
        },
        { onConflict: "nonce", ignoreDuplicates: true }
      )
      .select("nonce");
    if (error) throw new Error(`nonce store: ${error.message}`);
    return Array.isArray(data) && data.length > 0;
  }
}
