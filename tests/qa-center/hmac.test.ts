import { test } from "node:test";
import assert from "node:assert/strict";
import { signPayload, verifyRequest } from "../../src/lib/qa/hmac";
import { InMemoryNonceStore } from "../../src/lib/qa/nonce-store";

const SECRET = "x".repeat(48); // >= 32 chars
const NONCE_A = "aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa";
const NONCE_B = "bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb";

test("sign + verify round trip con firma válida (incluye nonce)", () => {
  const timestamp = 1_731_000_000;
  const body = JSON.stringify({ hello: "world" });
  const sig = signPayload({ secret: SECRET, timestamp, body, nonce: NONCE_A });
  const r = verifyRequest({
    headers: {
      "x-qa-timestamp": String(timestamp),
      "x-qa-signature": sig,
      "x-qa-runner-id": "runner-1",
      "x-qa-nonce": NONCE_A,
    },
    body,
    secret: SECRET,
    nowSeconds: timestamp + 10,
  });
  assert.equal(r.ok, true);
  if (r.ok) {
    assert.equal(r.runnerId, "runner-1");
    assert.equal(r.timestamp, timestamp);
    assert.equal(r.nonce, NONCE_A);
  }
});

test("rechaza nonce no UUID", () => {
  const ts = 1_731_000_000;
  const sig = signPayload({ secret: SECRET, timestamp: ts, body: "", nonce: "no-uuid" });
  const r = verifyRequest({
    headers: {
      "x-qa-timestamp": String(ts),
      "x-qa-signature": sig,
      "x-qa-runner-id": "r",
      "x-qa-nonce": "no-uuid",
    },
    body: "",
    secret: SECRET,
    nowSeconds: ts,
  });
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.code, "bad_nonce");
});

test("rechaza firma mal formateada", () => {
  const r = verifyRequest({
    headers: {
      "x-qa-timestamp": "1731000000",
      "x-qa-signature": "sha256=abc",
      "x-qa-runner-id": "r",
      "x-qa-nonce": NONCE_A,
    },
    body: "",
    secret: SECRET,
    nowSeconds: 1731000000,
  });
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.code, "bad_signature_format");
});

test("rechaza timestamp viejo (stale)", () => {
  const ts = 1_731_000_000;
  const sig = signPayload({ secret: SECRET, timestamp: ts, body: "", nonce: NONCE_A });
  const r = verifyRequest({
    headers: {
      "x-qa-timestamp": String(ts),
      "x-qa-signature": sig,
      "x-qa-runner-id": "r",
      "x-qa-nonce": NONCE_A,
    },
    body: "",
    secret: SECRET,
    nowSeconds: ts + 400,
  });
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.code, "stale_timestamp");
});

test("rechaza si el body fue modificado tras firmar", () => {
  const ts = 1_731_000_000;
  const sig = signPayload({ secret: SECRET, timestamp: ts, body: '{"a":1}', nonce: NONCE_A });
  const r = verifyRequest({
    headers: {
      "x-qa-timestamp": String(ts),
      "x-qa-signature": sig,
      "x-qa-runner-id": "r",
      "x-qa-nonce": NONCE_A,
    },
    body: '{"a":2}',
    secret: SECRET,
    nowSeconds: ts,
  });
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.code, "signature_mismatch");
});

test("rechaza si el nonce fue cambiado tras firmar (está en el material firmado)", () => {
  const ts = 1_731_000_000;
  const sig = signPayload({ secret: SECRET, timestamp: ts, body: "", nonce: NONCE_A });
  const r = verifyRequest({
    headers: {
      "x-qa-timestamp": String(ts),
      "x-qa-signature": sig,
      "x-qa-runner-id": "r",
      "x-qa-nonce": NONCE_B, // alterado
    },
    body: "",
    secret: SECRET,
    nowSeconds: ts,
  });
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.code, "signature_mismatch");
});

test("rechaza secreto ausente o demasiado corto", () => {
  const r = verifyRequest({
    headers: {
      "x-qa-timestamp": "1",
      "x-qa-signature": "v1=aa",
      "x-qa-runner-id": "r",
      "x-qa-nonce": NONCE_A,
    },
    body: "",
    secret: "short",
  });
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.code, "missing_secret");
});

test("rechaza si faltan headers (incluye nonce)", () => {
  const r = verifyRequest({
    headers: {
      "x-qa-timestamp": null,
      "x-qa-signature": null,
      "x-qa-runner-id": null,
      "x-qa-nonce": null,
    },
    body: "",
    secret: SECRET,
    nowSeconds: 1,
  });
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.code, "missing_header");
});

test("InMemoryNonceStore: segundo intento con el mismo nonce falla (replay)", async () => {
  const store = new InMemoryNonceStore();
  const inp = {
    nonce: NONCE_A,
    runnerId: "r",
    expiresAt: new Date(Date.now() + 10_000),
  };
  const first = await store.tryConsume(inp);
  const second = await store.tryConsume(inp);
  assert.equal(first, true);
  assert.equal(second, false);
});

test("InMemoryNonceStore: nonce vencido puede reconsumirse", async () => {
  const store = new InMemoryNonceStore();
  await store.tryConsume({
    nonce: NONCE_A,
    runnerId: "r",
    expiresAt: new Date(Date.now() - 1_000),
  });
  const ok = await store.tryConsume({
    nonce: NONCE_A,
    runnerId: "r",
    expiresAt: new Date(Date.now() + 10_000),
  });
  assert.equal(ok, true);
});
