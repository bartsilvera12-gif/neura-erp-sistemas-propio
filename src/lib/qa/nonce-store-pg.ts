/**
 * NEURA QA CENTER — NonceStore sobre Postgres directo.
 * Idempotencia atómica via INSERT ... ON CONFLICT (nonce) DO NOTHING.
 */

import { withQaClient } from "./pg-pool";
import type { NonceStore } from "./nonce-store";

export class PostgresNonceStore implements NonceStore {
  async tryConsume(input: {
    nonce: string;
    runnerId: string;
    expiresAt: Date;
  }): Promise<boolean> {
    return withQaClient(async (c) => {
      const r = await c.query(
        `INSERT INTO qa_center.runner_nonces (nonce, runner_id, expires_at)
         VALUES ($1, $2, $3)
         ON CONFLICT (nonce) DO NOTHING
         RETURNING nonce`,
        [input.nonce, input.runnerId, input.expiresAt.toISOString()]
      );
      return r.rows.length > 0;
    });
  }
}
