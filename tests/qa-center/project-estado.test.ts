/**
 * Tests del ciclo de vida del proyecto (puedeEjecutarRun, validarDeclaraciones).
 * Cubre fail-closed en cada estado y los códigos de error específicos.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  puedeEjecutarRun,
  validarDeclaraciones,
  calcularVencimiento,
  AUTORIZACION_HORAS,
} from "../../src/lib/qa/project-estado";

const AHORA = new Date("2026-11-13T15:00:00.000Z");

test("puedeEjecutarRun: entregado → bloqueo con código 'entregado'", () => {
  const v = puedeEjecutarRun({ estado_entrega: "entregado", autorizacion_qa_hasta: null }, AHORA);
  assert.equal(v.ok, false);
  if (!v.ok) assert.equal(v.codigo, "entregado");
});

test("puedeEjecutarRun: en_desarrollo → bloqueo 'no_autorizado'", () => {
  const v = puedeEjecutarRun({ estado_entrega: "en_desarrollo", autorizacion_qa_hasta: null }, AHORA);
  assert.equal(v.ok, false);
  if (!v.ok) assert.equal(v.codigo, "no_autorizado");
});

test("puedeEjecutarRun: en_qa con autorización vigente → OK", () => {
  const vence = new Date(AHORA.getTime() + 2 * 3600 * 1000).toISOString();
  const v = puedeEjecutarRun({ estado_entrega: "en_qa", autorizacion_qa_hasta: vence }, AHORA);
  assert.equal(v.ok, true);
});

test("puedeEjecutarRun: en_qa con autorización VENCIDA → 'autorizacion_vencida'", () => {
  const vencido = new Date(AHORA.getTime() - 60_000).toISOString();
  const v = puedeEjecutarRun({ estado_entrega: "en_qa", autorizacion_qa_hasta: vencido }, AHORA);
  assert.equal(v.ok, false);
  if (!v.ok) assert.equal(v.codigo, "autorizacion_vencida");
});

test("puedeEjecutarRun: en_qa sin fecha → bloqueo (fail-closed)", () => {
  const v = puedeEjecutarRun({ estado_entrega: "en_qa", autorizacion_qa_hasta: null }, AHORA);
  assert.equal(v.ok, false);
});

test("validarDeclaraciones: las 3 en true → ok", () => {
  const r = validarDeclaraciones({ no_entregado: true, datos_ficticios: true, integraciones_aisladas: true });
  assert.equal(r.ok, true);
});

test("validarDeclaraciones: falta no_entregado → error específico", () => {
  const r = validarDeclaraciones({ no_entregado: false, datos_ficticios: true, integraciones_aisladas: true });
  assert.equal(r.ok, false);
  if (!r.ok) assert.match(r.razon, /no fue entregado/i);
});

test("validarDeclaraciones: falta datos_ficticios → error específico", () => {
  const r = validarDeclaraciones({ no_entregado: true, datos_ficticios: false, integraciones_aisladas: true });
  assert.equal(r.ok, false);
  if (!r.ok) assert.match(r.razon, /datos reales/i);
});

test("validarDeclaraciones: falta integraciones_aisladas → error específico", () => {
  const r = validarDeclaraciones({ no_entregado: true, datos_ficticios: true, integraciones_aisladas: false });
  assert.equal(r.ok, false);
  if (!r.ok) assert.match(r.razon, /integraciones/i);
});

test("calcularVencimiento: suma 72 horas por default", () => {
  const vence = calcularVencimiento(AHORA);
  const diff = vence.getTime() - AHORA.getTime();
  assert.equal(diff, AUTORIZACION_HORAS * 3600 * 1000);
});

test("puedeEjecutarRun: estado desconocido → fail-closed", () => {
  // @ts-expect-error — probamos robustez ante basura en BD
  const v = puedeEjecutarRun({ estado_entrega: "inventado", autorizacion_qa_hasta: null }, AHORA);
  assert.equal(v.ok, false);
});
