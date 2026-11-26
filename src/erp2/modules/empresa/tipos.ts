/**
 * Datos de la empresa (Configuración › Datos de la empresa): tipos, validación del RUC y el
 * membrete que usan los PDF y la vista previa de la pantalla. Sin dependencias de servidor:
 * se importa tanto desde las rutas de PDF como desde el cliente.
 */

export type DatosEmpresa = {
  id: string;
  nombre: string;
  razon_social: string | null;
  nombre_fantasia: string | null;
  ruc: string | null;
  actividad_economica: string | null;
  direccion: string | null;
  ciudad: string | null;
  departamento: string | null;
  telefono: string | null;
  email: string | null;
  web: string | null;
  /** Logo propio de los documentos (receta 62); null → el de la instalación. */
  logo_url?: string | null;
  logo_path?: string | null;
  logo_mime?: string | null;
  logo_ancho?: number | null;
  logo_alto?: number | null;
  logo_actualizado?: string | null;
  /** Receta 63: original normalizado guardado (para volver a la imagen con fondo o quitárselo). */
  logo_original_path?: string | null;
  /** La versión que usan los PDF es la recortada (sin fondo). */
  logo_sin_fondo?: boolean | null;
  /** Qué se detectó en el original: había un fondo liso (se puede quitar), no había, o ya venía transparente. */
  logo_fondo?: "quitado" | "no_detectado" | "transparente" | null;
  updated_at?: string | null;
  updated_by_nombre?: string | null;
  sucursal_principal?: { nombre: string; direccion: string | null; ciudad: string | null; telefono: string | null } | null;
  puede_editar?: boolean;
};

/** Campos editables (lo que manda el formulario). */
export type FormEmpresa = {
  razon_social: string;
  nombre_fantasia: string;
  ruc: string;
  actividad_economica: string;
  direccion: string;
  ciudad: string;
  departamento: string;
  telefono: string;
  email: string;
  web: string;
};

export const CAMPOS_EMPRESA: (keyof FormEmpresa)[] = [
  "razon_social", "nombre_fantasia", "ruc", "actividad_economica", "direccion", "ciudad", "departamento", "telefono", "email", "web",
];

/** Los mismos de departamentos_py() en la base (receta 57). */
export const DEPARTAMENTOS_PY = [
  "Capital", "Concepción", "San Pedro", "Cordillera", "Guairá", "Caaguazú", "Caazapá", "Itapúa", "Misiones", "Paraguarí",
  "Alto Paraná", "Central", "Ñeembucú", "Amambay", "Canindeyú", "Presidente Hayes", "Boquerón", "Alto Paraguay",
] as const;

// ── RUC ──────────────────────────────────────────────────────────────────────
/** Dígito verificador módulo 11 de la SET (mismo cálculo que ruc_dv() en la base). */
export function rucDv(base: string): number | null {
  if (!/^\d+$/.test(base)) return null;
  let total = 0;
  let k = 2;
  for (let i = base.length - 1; i >= 0; i--) {
    if (k > 11) k = 2;
    total += Number(base[i]) * k;
    k++;
  }
  const resto = total % 11;
  return resto > 1 ? 11 - resto : 0;
}

/** Saca espacios y puntos (80.012.345-0 → 80012345-0). */
export const normalizarRuc = (s: string) => s.replace(/[\s.]/g, "").toUpperCase();

export type ValidacionRuc =
  | { estado: "vacio" }
  | { estado: "incompleto"; mensaje: string; dvSugerido: number | null }
  | { estado: "dv"; mensaje: string; dvSugerido: number }
  | { estado: "ok" };

export function validarRuc(valor: string): ValidacionRuc {
  const r = normalizarRuc(valor);
  if (!r) return { estado: "vacio" };
  const m = /^(\d{3,8})-(\d)$/.exec(r);
  if (!m) {
    const soloBase = /^\d{3,8}$/.test(r) ? rucDv(r) : null;
    return {
      estado: "incompleto",
      mensaje: soloBase !== null ? `Falta el dígito verificador: sería ${r}-${soloBase}` : "Formato: de 3 a 8 números, guion y el dígito verificador (ej. 80012345-0)",
      dvSugerido: soloBase,
    };
  }
  const dv = rucDv(m[1])!;
  if (dv !== Number(m[2])) return { estado: "dv", mensaje: `El dígito verificador de ${m[1]} es ${dv}: el RUC es ${m[1]}-${dv}`, dvSugerido: dv };
  return { estado: "ok" };
}

/** RUC corregido que se ofrece con "Usar …" (null si no se puede sugerir uno). */
export function rucSugerido(valor: string): string | null {
  const v = validarRuc(valor);
  if (v.estado === "ok" || v.estado === "vacio" || v.dvSugerido === null) return null;
  const base = normalizarRuc(valor).split("-")[0];
  return `${base}-${v.dvSugerido}`;
}

// ── Receptor de la factura (receta 66: "sin RUC no hay factura") ─────────────
/** Un documento con forma de RUC (números, guion y un dígito): se trata como RUC, no como CI. */
const FORMA_RUC = /^\d{3,8}-\d$/;

export type RucFactura =
  | { estado: "ok"; ruc: string }
  | { estado: "sin" }
  /** Hay un RUC cargado (o el documento tiene forma de RUC) pero el dígito verificador no da. */
  | { estado: "invalido"; ruc: string; sugerido: string | null; dv: number | null };

/**
 * RUC con el que se le factura a un cliente (mismo criterio que ruc_receptor() en la base, 84):
 * primero `ruc` (Datos para facturación) y tiene que ser válido; si está vacío, `documento`
 * SOLO si es un RUC con dígito verificador correcto. Una CI sola no alcanza → sin RUC.
 */
export function rucFacturaEstado(c: { ruc?: string | null; documento?: string | null } | null | undefined): RucFactura {
  if (!c) return { estado: "sin" };
  const ruc = normalizarRuc(c.ruc ?? "");
  const doc = normalizarRuc(c.documento ?? "");
  const candidato = ruc || (FORMA_RUC.test(doc) ? doc : "");
  if (!candidato) return { estado: "sin" };
  const v = validarRuc(candidato);
  if (v.estado === "ok") return { estado: "ok", ruc: candidato };
  return { estado: "invalido", ruc: candidato, sugerido: rucSugerido(candidato), dv: v.estado === "vacio" ? null : v.dvSugerido };
}

export function rucParaFactura(c: { ruc?: string | null; documento?: string | null } | null | undefined): string | null {
  const r = rucFacturaEstado(c);
  return r.estado === "ok" ? r.ruc : null;
}

/** Aviso cuando el cliente tiene un RUC cargado pero no es válido. */
export function avisoRucInvalido(r: { ruc: string; dv: number | null }): string {
  return r.dv !== null
    ? `El RUC ${r.ruc} no es válido: debería terminar en -${r.dv}. Corregilo en el cliente para poder facturar.`
    : `El RUC ${r.ruc} no es válido. Corregilo en el cliente para poder facturar.`;
}

/** Aviso para el cliente elegido sin RUC válido (null si se le puede facturar). */
export function avisoRucCliente(c: { ruc?: string | null; documento?: string | null } | null | undefined): string | null {
  const r = rucFacturaEstado(c);
  return r.estado === "ok" ? null : r.estado === "invalido" ? avisoRucInvalido(r) : AVISO_SIN_RUC;
}

/** Nombre con el que se factura (como nombre_receptor() en la base): razón social; si no, el nombre. */
export function nombreParaFactura(c: { razon_social?: string | null; nombre?: string | null } | null | undefined): string {
  return (c?.razon_social ?? "").trim() || (c?.nombre ?? "").trim();
}

/** Aviso que ve el usuario cuando el cliente no tiene RUC. */
export const AVISO_SIN_RUC = "Este cliente no tiene RUC: solo se puede emitir ticket. Cargá su RUC en Datos para facturación.";

// ── Cliente ocasional (receta 67) ────────────────────────────────────────────
/** Consumidor final que no da sus datos: se le factura como "X" (o lo de Configuración › Facturación). */
export const etiquetaOcasional = (nombre?: string | null) => `Cliente ocasional (${(nombre ?? "").trim() || "X"})`;

// ── Logo ─────────────────────────────────────────────────────────────────────
/** Logo de la instalación (lo pone Neura): el que se usa si la empresa no cargó uno. */
export const LOGO_INSTALACION = "/brand/logo-doc.png";
/** Lo que se acepta al subir (el servidor lo normaliza a PNG o JPEG, lado mayor ≤ 600 px). */
export const LOGO_TIPOS = ["image/png", "image/jpeg", "image/webp"] as const;
export const LOGO_MAX_MB = 2;

// ── Membrete ─────────────────────────────────────────────────────────────────
const lleno = (s: string | null | undefined): s is string => !!s && s.trim() !== "";

export type Membrete = {
  /** nombre grande: nombre de fantasía, o la razón social, o el nombre */
  nombre: string;
  /** razón social si es distinta del nombre grande */
  razonSocial: string | null;
  actividad: string | null;
  ruc: string | null;
  /** dirección, ciudad (y departamento si no es Capital) */
  ubicacion: string | null;
  telefono: string | null;
  email: string | null;
  web: string | null;
};

type DatosMembrete = Partial<Pick<DatosEmpresa, "nombre" | "razon_social" | "nombre_fantasia" | "ruc" | "actividad_economica" | "direccion" | "ciudad" | "departamento" | "telefono" | "email" | "web" | "sucursal_principal">>;

/**
 * Lo que va en el encabezado de un documento. Lo que falta sale de la sucursal principal y,
 * en último caso, de la config del cliente (nombre y dominio): igual que antes de esta pantalla.
 */
export function membreteEmpresa(d: DatosMembrete | null | undefined, respaldo: { nombre: string; web?: string | null }): Membrete {
  const sp = d?.sucursal_principal ?? null;
  const nombre = [d?.nombre_fantasia, d?.razon_social, d?.nombre, respaldo.nombre].find(lleno)!.trim();
  const razon = lleno(d?.razon_social) && d!.razon_social!.trim() !== nombre ? d!.razon_social!.trim() : null;
  const direccion = lleno(d?.direccion) ? d!.direccion : sp?.direccion;
  const ciudad = lleno(d?.ciudad) ? d!.ciudad : sp?.ciudad;
  const depto = lleno(d?.departamento) && d!.departamento !== "Capital" && d!.departamento !== ciudad ? d!.departamento : null;
  const ubicacion = [direccion, ciudad, depto].filter(lleno).join(", ");
  const telefono = lleno(d?.telefono) ? d!.telefono : sp?.telefono;
  return {
    nombre,
    razonSocial: razon,
    actividad: lleno(d?.actividad_economica) ? d!.actividad_economica! : null,
    ruc: lleno(d?.ruc) ? d!.ruc! : null,
    ubicacion: ubicacion || null,
    telefono: lleno(telefono) ? telefono : null,
    email: lleno(d?.email) ? d!.email! : null,
    web: lleno(d?.web) ? d!.web! : lleno(respaldo.web) ? respaldo.web! : null,
  };
}

/**
 * Renglones chicos debajo del nombre (en orden), para el encabezado general de los PDF y su
 * vista previa: razón social · RUC, actividad, dirección, teléfono · email, web.
 */
export function renglonesMembrete(m: Membrete): string[] {
  const fiscal = [m.razonSocial, m.ruc ? `RUC ${m.ruc}` : null].filter(lleno).join(" · ");
  const contacto = [m.telefono ? `Tel. ${m.telefono}` : null, m.email].filter(lleno).join(" · ");
  return [fiscal, m.actividad, m.ubicacion, contacto, m.web].filter(lleno);
}
