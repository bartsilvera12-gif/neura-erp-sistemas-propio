/**
 * Sanity test del helper canónico de nombre de cliente.
 * Correr: npx tsx scripts/test-cliente-display-name.ts
 */
import {
  nombreClienteDisplay,
  nombreClienteContacto,
  clienteDisplayNameSql,
} from "../src/lib/clientes/display-name";

let fails = 0;
function eq(label: string, got: unknown, want: unknown) {
  const ok = got === want;
  if (!ok) fails++;
  console.log(`${ok ? "✅" : "❌"} ${label} → ${JSON.stringify(got)}${ok ? "" : `  (esperado ${JSON.stringify(want)})`}`);
}

// ── Empresa (B2B): manda el nombre de empresa ──────────────────────────────
eq(
  "empresa: caso ELECTROSAN (razon_social vacía, contacto ANTONIO ACOSTA)",
  nombreClienteDisplay({ tipo_cliente: "empresa", empresa: "AS ELECTROSAN COMPANY EAS", nombre_contacto: "ANTONIO ACOSTA", nombre: "ANTONIO ACOSTA", razon_social: "" }),
  "AS ELECTROSAN COMPANY EAS"
);
eq(
  "empresa: sin nombre de empresa cae al contacto",
  nombreClienteDisplay({ tipo_cliente: "empresa", empresa: "", nombre_contacto: "JUAN PEREZ" }),
  "JUAN PEREZ"
);
eq(
  "empresa: razon_social NO gana el display",
  nombreClienteDisplay({ tipo_cliente: "empresa", empresa: "FERRETERIA X", razon_social: "FERRETERIA X SA" }),
  "FERRETERIA X"
);

// ── Persona (B2C): manda el nombre de la persona ───────────────────────────
eq(
  "persona: nombre en nombre_contacto",
  nombreClienteDisplay({ tipo_cliente: "persona", empresa: "", nombre_contacto: "MARCELA ROMERO", nombre: "MARCELA ROMERO" }),
  "MARCELA ROMERO"
);
eq(
  "persona: razon_social presente pero igual manda el nombre",
  nombreClienteDisplay({ tipo_cliente: "persona", nombre_contacto: "VICTOR IRALA", razon_social: "VICTOR IRALA" }),
  "VICTOR IRALA"
);

// ── Bordes ─────────────────────────────────────────────────────────────────
eq("null → fallback", nombreClienteDisplay(null), "Cliente");
eq("todo vacío → fallback", nombreClienteDisplay({ tipo_cliente: "empresa", empresa: "  ", nombre_contacto: "" }), "Cliente");
eq("tipo desconocido con empresa → empresa", nombreClienteDisplay({ empresa: "ACME", nombre_contacto: "PEPE" }), "ACME");
eq("tipo desconocido sin empresa → contacto", nombreClienteDisplay({ nombre_contacto: "PEPE" }), "PEPE");

// ── Contacto secundario ────────────────────────────────────────────────────
eq(
  "contacto: empresa muestra el contacto distinto",
  nombreClienteContacto({ tipo_cliente: "empresa", empresa: "AS ELECTROSAN COMPANY EAS", nombre_contacto: "ANTONIO ACOSTA" }),
  "ANTONIO ACOSTA"
);
eq(
  "contacto: persona no repite el nombre (null)",
  nombreClienteContacto({ tipo_cliente: "persona", nombre_contacto: "MARCELA ROMERO" }),
  null
);

// ── Espejo SQL: forma y validación ─────────────────────────────────────────
const sql = clienteDisplayNameSql("cl");
eq("sql: menciona alias.empresa", sql.includes("cl.empresa"), true);
eq("sql: ramifica por tipo persona", sql.includes("lower(coalesce(cl.tipo_cliente,'')) = 'persona'"), true);
eq("sql: cae a 'Cliente'", sql.includes("'Cliente'"), true);
try {
  clienteDisplayNameSql("cl; DROP TABLE");
  eq("sql: rechaza alias inválido", "no lanzó", "debía lanzar");
} catch {
  eq("sql: rechaza alias inválido", true, true);
}

console.log(`\n${fails === 0 ? "TODO OK ✅" : `${fails} FALLAS ❌`}`);
process.exit(fails === 0 ? 0 : 1);
