/**
 * Convierte un entero a palabras en español (para recibos).
 * Cubre 0 … 999.999.999.999. Pensado para guaraníes (sin centavos); para USD
 * se pasa la parte entera y se agregan los centavos aparte en el llamador.
 */

const UNIDADES = [
  "cero", "uno", "dos", "tres", "cuatro", "cinco", "seis", "siete", "ocho", "nueve",
  "diez", "once", "doce", "trece", "catorce", "quince", "dieciséis", "diecisiete",
  "dieciocho", "diecinueve", "veinte",
];

const DECENAS = ["", "", "veinte", "treinta", "cuarenta", "cincuenta", "sesenta", "setenta", "ochenta", "noventa"];

const CENTENAS = [
  "", "ciento", "doscientos", "trescientos", "cuatrocientos", "quinientos",
  "seiscientos", "setecientos", "ochocientos", "novecientos",
];

/** 0..999 en palabras (sin "cero"; el caso 0 lo maneja el nivel superior). */
function tresCifras(n: number): string {
  if (n === 0) return "";
  if (n === 100) return "cien";

  let out = "";
  const c = Math.floor(n / 100);
  const resto = n % 100;

  if (c > 0) out += CENTENAS[c];

  if (resto > 0) {
    if (out) out += " ";
    if (resto <= 20) {
      out += UNIDADES[resto];
    } else if (resto < 30) {
      out += "veinti" + UNIDADES[resto - 20];
    } else {
      const d = Math.floor(resto / 10);
      const u = resto % 10;
      out += DECENAS[d];
      if (u > 0) out += " y " + UNIDADES[u];
    }
  }
  return out;
}

/** Entero → palabras. Maneja "un/uno" antes de "millón/mil". */
export function enteroEnLetras(valor: number): string {
  let n = Math.floor(Math.abs(valor));
  if (n === 0) return "cero";

  const partes: string[] = [];

  const millones = Math.floor(n / 1_000_000);
  n = n % 1_000_000;
  const miles = Math.floor(n / 1000);
  const cientos = n % 1000;

  if (millones > 0) {
    if (millones === 1) {
      partes.push("un millón");
    } else {
      partes.push(tresCifras(millones).replace(/uno$/, "un") + " millones");
    }
  }

  if (miles > 0) {
    if (miles === 1) {
      partes.push("mil");
    } else {
      partes.push(tresCifras(miles).replace(/uno$/, "un") + " mil");
    }
  }

  if (cientos > 0) {
    partes.push(tresCifras(cientos));
  }

  return partes.join(" ").replace(/\s+/g, " ").trim();
}

/**
 * Monto formateado en letras según moneda, para la línea "la cantidad de …".
 * GS: sin centavos → "… guaraníes". USD: con centavos → "… dólares con NN/100".
 */
export function montoEnLetras(monto: number, moneda: "GS" | "USD"): string {
  const abs = Math.abs(Number(monto) || 0);
  if (moneda === "USD") {
    const entero = Math.floor(abs);
    const centavos = Math.round((abs - entero) * 100);
    const base = `${enteroEnLetras(entero)} ${entero === 1 ? "dólar" : "dólares"}`;
    const cent = centavos > 0 ? ` con ${String(centavos).padStart(2, "0")}/100` : "";
    return `${base}${cent}`.replace(/^\w/, (m) => m.toUpperCase());
  }
  const entero = Math.round(abs);
  const base = `${enteroEnLetras(entero)} ${entero === 1 ? "guaraní" : "guaraníes"}`;
  return base.replace(/^\w/, (m) => m.toUpperCase());
}
