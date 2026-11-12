import { test } from "node:test";
import assert from "node:assert/strict";
import { signPayload, verifyRequest } from "../../src/lib/qa/hmac";

const SECRET = "x".repeat(48); // >= 32 chars

test("sign + verify round trip con firma válida", () => {
  const timestamp = 1_731_000_000;
  const body = JSON.stringify({ hello: "world" });
  const sig = signPayload({ secret: SECRET, timestamp, body });
  const r = verifyRequest({
    headers: {
      "x-qa-timestamp": String(timestamp),
      "x-qa-signature": sig,
      "x-qa-runner-id": "runner-1",
    },
    body,
    secret: SECRET,
    nowSeconds: timestamp + 10,
  });
  assert.equal(r.ok, true);
  if (r.ok) {
    assert.equal(r.runnerId, "runner-1");
    assert.equal(r.timestamp, timestamp);
  }
});

test("rechaza firma mal formateada", () => {
  const r = verifyRequest({
    headers: {
      "x-qa-timestamp": "1731000000",
      "x-qa-signature": "sha256=abc",
      "x-qa-runner-id": "r",
    },
    body: "",
    secret: SECRET,
    nowSeconds: 1731000000,
  });
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.code, "bad_signature_format");
});

test("rechaza timestamp viejo (replay)", () => {
  const ts = 1_731_000_000;
  const body = "";
  const sig = signPayload({ secret: SECRET, timestamp: ts, body });
  const r = verifyRequest({
    headers: {
      "x-qa-timestamp": String(ts),
      "x-qa-signature": sig,
      "x-qa-runner-id": "r",
    },
    body,
    secret: SECRET,
    nowSeconds: ts + 400,
  });
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.code, "stale_timestamp");
});

test("rechaza si el body fue modificado tras firmar", () => {
  const ts = 1_731_000_000;
  const sig = signPayload({ secret: SECRET, timestamp: ts, body: '{"a":1}' });
  const r = verifyRequest({
    headers: {
      "x-qa-timestamp": String(ts),
      "x-qa-signature": sig,
      "x-qa-runner-id": "r",
    },
    body: '{"a":2}', // alterado
    secret: SECRET,
    nowSeconds: ts,
  });
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.code, "signature_mismatch");
});

test("rechaza secreto ausente o demasiado corto", () => {
  const r = verifyRequest({
    headers: { "x-qa-timestamp": "1", "x-qa-signature": "v1=aa", "x-qa-runner-id": "r" },
    body: "",
    secret: "short",
  });
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.code, "missing_secret");
});

test("rechaza si faltan headers", () => {
  const r = verifyRequest({
    headers: { "x-qa-timestamp": null, "x-qa-signature": null, "x-qa-runner-id": null },
    body: "",
    secret: SECRET,
    nowSeconds: 1,
  });
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.code, "missing_header");
});
