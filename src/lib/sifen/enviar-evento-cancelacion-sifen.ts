/**
 * Evento de **cancelación** SIFEN (`siRecepEvento`, operación `rEnviEventoDe`).
 *
 * El ERP sólo hacía cancelación lógica (estado local), sin avisar a la SET: el DE quedaba
 * aprobado ante Hacienda. Este módulo arma el evento `rGeVeCan`, lo firma (XML-DSig sobre `rEve`,
 * igual perfil que el DE) y lo envía por SOAP/mTLS al web service de eventos.
 *
 * Estructura (MT SIFEN v150):
 *   rEnviEventoDe > dId + dEvReg > rGesEve > (rEve[Id] + Signature)
 *   rEve > dFecFirma + dVerFor(150) + gGroupTiEvt > rGeVeCan > Id(CDC) + mOtEve(motivo)
 *
 * Respuesta: rResEnviEventoDe > gResProcEVe > dCodRes/dMsgRes. Éxito de cancelación = dCodRes 0600.
 */
import * as https from "node:https";
import { URL } from "node:url";
import { createPrivateKey } from "node:crypto";
import { SignedXml } from "xml-crypto";
import type { AmbienteSifen } from "./types";
import { extractKeyAndCertFromP12, type P12KeyMaterial } from "./sign-xml";
import { SIFEN_EKUATIA_TARGET_NS } from "./sifen-xsi-schema-location";
import { urlRecepEvento } from "./sifen-ws-urls";
import { escapeXml } from "./xml";
import { TZ_PY } from "@/lib/format/hora-py";

const SIFEN_NS = SIFEN_EKUATIA_TARGET_NS;
const SOAP_ENV = "http://www.w3.org/2003/05/soap-envelope";
const CONTENT_TYPE = "application/xml; charset=utf-8";

/** Mismo margen que rde-xml: evita 1004 "fecha de firma adelantada" si el host va unos segundos por delante. */
const SIFEN_FIRMA_SKEW_MS = 120_000;

const XPATH_REVE = "/*[local-name(.)='rGesEve']/*[local-name(.)='rEve']";
const TRANSFORMS = [
  "http://www.w3.org/2000/09/xmldsig#enveloped-signature",
  "http://www.w3.org/2001/10/xml-exc-c14n#",
] as const;
const DIGEST = "http://www.w3.org/2001/04/xmlenc#sha256";
const SIG_ALG = "http://www.w3.org/2001/04/xmldsig-more#rsa-sha256";

export interface EmpresaConfigEvento {
  ambiente: AmbienteSifen;
  certificadoP12: Buffer;
  certificadoPassword: string;
}

export interface EnviarEventoCancelacionParams {
  /** CDC (44 dígitos) del DE aprobado a cancelar. */
  cdc: string;
  /** Motivo (5..500 chars). */
  motivo: string;
  empresaConfig: EmpresaConfigEvento;
  /** Id del request SOAP; por defecto derivado del reloj. */
  dId?: number;
  /** Id del evento (atributo de rEve); por defecto derivado del reloj. */
  idEvento?: number;
}

export interface EventoCancelacionResultado {
  httpStatus: number;
  soapFault: boolean;
  faultString: string | null;
  /** dCodRes de gResProcEVe (0600 = cancelación OK). */
  dCodRes: string | null;
  dMsgRes: string | null;
  dFecProc: string | null;
  /** true si la SET aceptó la cancelación. */
  aceptado: boolean;
  cuerpoSoapCrudo: string;
}

function generarIdNumerico(): number {
  const mod = BigInt("999999999999999");
  let n = Number(BigInt(Date.now()) % mod);
  if (!Number.isFinite(n) || n < 1) n = 1;
  return n;
}

/** Fecha/hora civil de Paraguay `YYYY-MM-DDThh:mm:ss` (con el skew de seguridad). */
function dFecFirmaPy(ahora: Date): string {
  const d = new Date(ahora.getTime() - SIFEN_FIRMA_SKEW_MS);
  const ymd = d.toLocaleDateString("en-CA", { timeZone: TZ_PY });
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: TZ_PY,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
    hourCycle: "h23",
  }).formatToParts(d);
  const pick = (ty: Intl.DateTimeFormatPart["type"]) => {
    const raw = parts.find((p) => p.type === ty)?.value ?? "0";
    const n = parseInt(raw.replace(/\D/g, ""), 10);
    return Number.isFinite(n) ? String(n).padStart(2, "0") : "00";
  };
  return `${ymd}T${pick("hour")}:${pick("minute")}:${pick("second")}`;
}

/** rGesEve > rEve (sin firmar). El xmlns va en rGesEve para que la firma sea autoconsistente al embeberlo. */
export function buildRGesEveCancelacionUnsigned(opts: {
  cdc: string;
  motivo: string;
  idEvento: number;
  dFecFirma: string;
}): string {
  return (
    `<rGesEve xmlns="${SIFEN_NS}">` +
    `<rEve Id="${opts.idEvento}">` +
    `<dFecFirma>${opts.dFecFirma}</dFecFirma>` +
    `<dVerFor>150</dVerFor>` +
    `<gGroupTiEvt>` +
    `<rGeVeCan>` +
    `<Id>${escapeXml(opts.cdc)}</Id>` +
    `<mOtEve>${escapeXml(opts.motivo)}</mOtEve>` +
    `</rGeVeCan>` +
    `</gGroupTiEvt>` +
    `</rEve>` +
    `</rGesEve>`
  );
}

/** Firma XML-DSig sobre `rEve` (enveloped + exclusive C14N, RSA-SHA256), Signature como hermano posterior. */
export function signEventoXml(xmlUnsigned: string, material: P12KeyMaterial): string {
  const privateKey = createPrivateKey({ key: material.privateKeyPem, format: "pem" });
  const sig = new SignedXml({
    privateKey,
    publicCert: material.certificatePem,
    signatureAlgorithm: SIG_ALG,
    canonicalizationAlgorithm: "http://www.w3.org/2001/10/xml-exc-c14n#",
  });
  sig.addReference({
    xpath: XPATH_REVE,
    transforms: [...TRANSFORMS],
    digestAlgorithm: DIGEST,
  });
  sig.computeSignature(xmlUnsigned.trim(), {
    location: { reference: XPATH_REVE, action: "after" },
  });
  return sig.getSignedXml();
}

function construirSoapEvento(dId: number, rGesEveSigned: string): string {
  return (
    `<?xml version="1.0" encoding="UTF-8"?>` +
    `<env:Envelope xmlns:env="${SOAP_ENV}">` +
    `<env:Header/>` +
    `<env:Body>` +
    `<rEnviEventoDe xmlns="${SIFEN_NS}">` +
    `<dId>${dId}</dId>` +
    `<dEvReg>` +
    rGesEveSigned +
    `</dEvReg>` +
    `</rEnviEventoDe>` +
    `</env:Body>` +
    `</env:Envelope>`
  );
}

function extraerTexto(xml: string, local: string): string | null {
  const re = new RegExp(
    `<(?:[^\\s/>:]+:)?${local}\\b[^>]*>([\\s\\S]*?)</(?:[^\\s/>:]+:)?${local}\\b[^>]*>`,
    "i"
  );
  const m = xml.match(re);
  if (!m?.[1]) return null;
  const inner = m[1].replace(/<[^>]+>/g, "").trim();
  return inner.length > 0 ? inner : null;
}

export function parsearRespuestaEvento(xml: string, httpStatus: number): EventoCancelacionResultado {
  const lower = xml.toLowerCase();
  if (/<faultstring>/i.test(xml) || /<soap12:fault>/i.test(lower) || /<fault>/i.test(lower)) {
    return {
      httpStatus,
      soapFault: true,
      faultString: extraerTexto(xml, "faultstring") ?? extraerTexto(xml, "Reason") ?? "Fault SOAP",
      dCodRes: null,
      dMsgRes: null,
      dFecProc: null,
      aceptado: false,
      cuerpoSoapCrudo: xml,
    };
  }
  const dCodRes = extraerTexto(xml, "dCodRes");
  const dMsgRes = extraerTexto(xml, "dMsgRes");
  const cod = (dCodRes ?? "").trim();
  const codNorm = cod.replace(/^0+/, "") || "";
  // 0600 = evento (cancelación) procesado con éxito.
  const aceptado = cod === "0600" || codNorm === "600";
  return {
    httpStatus,
    soapFault: false,
    faultString: null,
    dCodRes,
    dMsgRes,
    dFecProc: extraerTexto(xml, "dFecProc"),
    aceptado,
    cuerpoSoapCrudo: xml,
  };
}

function postHttpsMtls(
  urlStr: string,
  body: string,
  certPem: string,
  keyPem: string
): Promise<{ status: number; body: string }> {
  const url = new URL(urlStr);
  const port = url.port ? Number(url.port) : 443;
  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        hostname: url.hostname,
        port,
        path: `${url.pathname}${url.search}`,
        method: "POST",
        cert: certPem,
        key: keyPem,
        rejectUnauthorized: true,
        headers: {
          "Content-Type": CONTENT_TYPE,
          "Content-Length": Buffer.byteLength(body, "utf8"),
        },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (ch) => chunks.push(ch as Buffer));
        res.on("end", () =>
          resolve({ status: res.statusCode ?? 0, body: Buffer.concat(chunks).toString("utf8") })
        );
      }
    );
    req.on("error", reject);
    req.write(body, "utf8");
    req.end();
  });
}

/** Arma, firma y envía el evento de cancelación. No muta la base; el caller decide según `aceptado`. */
export async function enviarEventoCancelacionSifen(
  params: EnviarEventoCancelacionParams
): Promise<EventoCancelacionResultado & { solicitudSoap: string }> {
  const ambiente = params.empresaConfig.ambiente;
  if (ambiente !== "test" && ambiente !== "produccion") {
    throw new Error('ambiente debe ser "test" o "produccion".');
  }
  const cdc = params.cdc.trim();
  if (!/^\d{44}$/.test(cdc)) {
    throw new Error("CDC inválido: se esperan 44 dígitos.");
  }
  const motivo = params.motivo.trim();
  if (motivo.length < 5 || motivo.length > 500) {
    throw new Error("motivo debe tener entre 5 y 500 caracteres.");
  }

  const dId = params.dId ?? generarIdNumerico();
  const idEvento = params.idEvento ?? generarIdNumerico();
  const dFecFirma = dFecFirmaPy(new Date());

  const unsigned = buildRGesEveCancelacionUnsigned({ cdc, motivo, idEvento, dFecFirma });

  const material = extractKeyAndCertFromP12(
    params.empresaConfig.certificadoP12,
    params.empresaConfig.certificadoPassword
  );
  const signed = signEventoXml(unsigned, material);
  const soap = construirSoapEvento(dId, signed);

  const serviceUrl = urlRecepEvento(ambiente);
  let httpStatus: number;
  let cuerpo: string;
  try {
    const res = await postHttpsMtls(serviceUrl, soap, material.certificatePem, material.privateKeyPem);
    httpStatus = res.status;
    cuerpo = res.body;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const label = ambiente === "produccion" ? "SIFEN producción" : "SIFEN TEST";
    throw new Error(`Fallo HTTPS/mTLS evento (${label}): ${msg}`);
  }

  return { ...parsearRespuestaEvento(cuerpo, httpStatus), solicitudSoap: soap };
}
