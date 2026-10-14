/**
 * Wrapper de Firebase Admin para el dispatcher de notificaciones push (FCM).
 *
 * Carga perezosa: firebase-admin solo se inicializa cuando hay credenciales en el
 * entorno. Si faltan, devuelve `{ ok:false, reason:"config_missing", missing:[...] }`
 * y el dispatcher degrada de forma controlada (no rompe build ni deja la app caída).
 *
 * Credenciales aceptadas (en este orden):
 *   1) FIREBASE_SERVICE_ACCOUNT_JSON_BASE64  (service account JSON completo, base64)
 *   2) FIREBASE_PROJECT_ID + FIREBASE_CLIENT_EMAIL + FIREBASE_PRIVATE_KEY
 *      (la private key puede venir con \n literales; se normalizan)
 *
 * NO imprime claves. NO commitear secretos.
 */
import type { Messaging } from "firebase-admin/messaging";

export type FcmMessagingResult =
  | { ok: true; messaging: Messaging }
  | { ok: false; reason: "config_missing"; missing: string[] }
  | { ok: false; reason: "init_error"; error: string };

type ServiceAccount = { projectId: string; clientEmail: string; privateKey: string };

let cachedMessaging: Messaging | null = null;
let cachedMessagingSecundario: Messaging | null | undefined;

/**
 * El segundo proyecto de Firebase, para una app que no es la de este ERP.
 *
 * Hace falta porque un token de FCM no es la dirección de un teléfono: es la
 * dirección de un teléfono **dentro de un proyecto**. Un servidor autenticado
 * como el proyecto A no puede entregarle a un token emitido por el proyecto B
 * —Firebase contesta `messaging/mismatched-credential`— por más que la app
 * esté bien instalada y con permiso.
 *
 * Este ERP le manda a dos apps: la propia y Zentra, que tiene su proyecto
 * porque un solo APK sirve a todos sus clientes. Sin esto, a Zentra no le
 * llega nunca nada.
 *
 * Es opcional: sin la variable configurada, todo se comporta como antes.
 */
/** Para no repetir el mismo reclamo en cada envío. */
let yaSeQuejoDelSecundario = false;

/**
 * La credencial del segundo proyecto.
 *
 * Acepta el JSON en base64 (lo normal) o pegado tal cual, y le saca los saltos
 * de línea al base64 — copiarlo desde una terminal los mete, y Buffer los come,
 * pero no todas las consolas los cortan en el mismo lugar.
 *
 * Y si la variable está pero no se puede leer, lo dice. Antes caía en el mismo
 * `null` que "no está configurada", y las dos cosas terminaban en silencio: con
 * una llave mal pegada, el ERP se comportaba exactamente como si nadie hubiera
 * configurado nada. "No está" y "está pero está mal" son dos problemas
 * distintos y se arreglan distinto.
 */
function resolveServiceAccountSecundario(): ServiceAccount | null {
  const crudo = process.env.FIREBASE_SECUNDARIO_SERVICE_ACCOUNT_JSON_BASE64?.trim();
  if (crudo) {
    const texto = crudo.startsWith("{")
      ? crudo
      : Buffer.from(crudo.replace(/\s+/g, ""), "base64").toString("utf8");
    try {
      const json = JSON.parse(texto) as Record<string, string>;
      if (json.project_id && json.client_email && json.private_key) {
        return {
          projectId: json.project_id,
          clientEmail: json.client_email,
          // Una private_key con los `\n` escapados firma mal, y Firebase
          // contesta un error de autenticación que no nombra la causa.
          privateKey: json.private_key.replace(/\\n/g, "\n"),
        };
      }
      if (!yaSeQuejoDelSecundario) {
        yaSeQuejoDelSecundario = true;
        console.error(
          "[firebase] FIREBASE_SECUNDARIO_SERVICE_ACCOUNT_JSON_BASE64 se pudo leer pero le faltan " +
            "campos (project_id, client_email, private_key). Es el JSON de la cuenta de servicio, completo.",
        );
      }
    } catch {
      if (!yaSeQuejoDelSecundario) {
        yaSeQuejoDelSecundario = true;
        console.error(
          "[firebase] FIREBASE_SECUNDARIO_SERVICE_ACCOUNT_JSON_BASE64 está pero no se pudo leer: " +
            "no es JSON ni base64 de un JSON. Los teléfonos del segundo proyecto NO van a recibir avisos.",
        );
      }
    }
  }
  const projectId = process.env.FIREBASE_SECUNDARIO_PROJECT_ID?.trim();
  const clientEmail = process.env.FIREBASE_SECUNDARIO_CLIENT_EMAIL?.trim();
  const privateKey = process.env.FIREBASE_SECUNDARIO_PRIVATE_KEY?.replace(/\\n/g, "\n").trim();
  if (projectId && clientEmail && privateKey) return { projectId, clientEmail, privateKey };
  return null;
}

/** El cliente del segundo proyecto, o `null` si no está configurado. */
export async function getFcmMessagingSecundario(): Promise<Messaging | null> {
  if (cachedMessagingSecundario !== undefined) return cachedMessagingSecundario;
  const sa = resolveServiceAccountSecundario();
  if (!sa) {
    cachedMessagingSecundario = null;
    return null;
  }
  try {
    const { getApps, initializeApp, cert } = await import("firebase-admin/app");
    const { getMessaging } = await import("firebase-admin/messaging");
    // Va con nombre: una segunda app sin nombre pisaría a la principal.
    const NOMBRE = "secundario";
    const existente = getApps().find((a) => a.name === NOMBRE);
    const app =
      existente ??
      initializeApp(
        {
          credential: cert({
            projectId: sa.projectId,
            clientEmail: sa.clientEmail,
            privateKey: sa.privateKey,
          }),
        },
        NOMBRE,
      );
    cachedMessagingSecundario = getMessaging(app);
    return cachedMessagingSecundario;
  } catch (e) {
    console.error("[firebase] no se pudo iniciar el proyecto secundario:", e);
    cachedMessagingSecundario = null;
    return null;
  }
}

export function firebaseSecundarioConfigurado(): boolean {
  return resolveServiceAccountSecundario() !== null;
}

function resolveServiceAccount(): ServiceAccount | { missing: string[] } {
  const b64 = process.env.FIREBASE_SERVICE_ACCOUNT_JSON_BASE64?.trim();
  if (b64) {
    try {
      const json = JSON.parse(Buffer.from(b64, "base64").toString("utf8")) as Record<string, string>;
      const projectId = json.project_id;
      const clientEmail = json.client_email;
      const privateKey = json.private_key;
      if (projectId && clientEmail && privateKey) return { projectId, clientEmail, privateKey };
    } catch {
      /* json inválido → caemos a las variables sueltas */
    }
  }
  const projectId = process.env.FIREBASE_PROJECT_ID?.trim();
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL?.trim();
  const privateKey = process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, "\n").trim();
  if (projectId && clientEmail && privateKey) return { projectId, clientEmail, privateKey };

  const missing: string[] = [];
  if (!projectId) missing.push("FIREBASE_PROJECT_ID");
  if (!clientEmail) missing.push("FIREBASE_CLIENT_EMAIL");
  if (!privateKey) missing.push("FIREBASE_PRIVATE_KEY");
  return { missing: [...missing, "(o FIREBASE_SERVICE_ACCOUNT_JSON_BASE64)"] };
}

/** Devuelve el cliente de Messaging o un resultado de "config faltante" (sin lanzar). */
export async function getFcmMessaging(): Promise<FcmMessagingResult> {
  if (cachedMessaging) return { ok: true, messaging: cachedMessaging };
  const sa = resolveServiceAccount();
  if ("missing" in sa) return { ok: false, reason: "config_missing", missing: sa.missing };
  try {
    const { getApps, initializeApp, cert } = await import("firebase-admin/app");
    const { getMessaging } = await import("firebase-admin/messaging");
    const existing = getApps();
    // Por nombre y no por posición: desde que hay un segundo proyecto,
    // `existing[0]` puede ser el secundario y este ERP terminaría mandando
    // todo por la credencial equivocada.
    const app =
      existing.find((a) => a.name === "[DEFAULT]") ??
      initializeApp({
            credential: cert({
              projectId: sa.projectId,
              clientEmail: sa.clientEmail,
              privateKey: sa.privateKey,
            }),
          });
    cachedMessaging = getMessaging(app);
    return { ok: true, messaging: cachedMessaging };
  } catch (e) {
    return { ok: false, reason: "init_error", error: e instanceof Error ? e.message : String(e) };
  }
}

/** ¿Hay credenciales Firebase configuradas? (sin inicializar) */
export function firebaseConfigured(): boolean {
  const sa = resolveServiceAccount();
  return !("missing" in sa);
}
