"use client";

/**
 * Tilde de entrega estilo WhatsApp para mensajes SALIENTES (from_me).
 *
 * De dónde sale el dato: el webhook `whatsapp.message.updated` (YCloud) y el de Meta escriben
 * `chat_messages.whatsapp_delivery_status`. Antes ese campo solo se usaba para el chip rojo
 * "No entregado", así que un mensaje trabado sin entregar se veía IGUAL que uno leído.
 *
 *   null / "accepted" → el proveedor lo aceptó, WhatsApp todavía no confirmó nada
 *   "sent"            → WhatsApp lo tomó, no llegó al teléfono del cliente
 *   "delivered"       → llegó al teléfono
 *   "read"            → el cliente lo abrió
 *   "failed"          → lo explica el chip rojo con el motivo; acá no dibujamos nada
 *
 * Regla: NUNCA doble tilde sin dato. Si el estado no llegó queda una sola tilde tenue
 * ("salió, no sabemos si llegó"), que es la verdad y no inventa una entrega.
 *
 * Los colores asumen la burbuja propia (#4FAEB2, texto blanco), que es el único lugar donde
 * se usa — tanto en el inbox de escritorio como en el chat mobile del asesor.
 */

export type DeliveryTickState = "pending" | "sent" | "delivered" | "read" | "failed";

export function deliveryTickState(status: string | null | undefined): DeliveryTickState {
  const s = (status ?? "").trim().toLowerCase();
  if (s === "read") return "read";
  if (s === "delivered") return "delivered";
  if (s === "failed") return "failed";
  if (s === "sent") return "sent";
  return "pending";
}

const LABEL: Record<DeliveryTickState, string> = {
  pending: "Enviado. WhatsApp todavía no confirmó la entrega.",
  sent: "WhatsApp lo tomó, pero todavía no llegó al teléfono del cliente.",
  delivered: "Entregado al teléfono del cliente.",
  read: "Leído por el cliente.",
  failed: "No entregado.",
};

const TONE: Record<DeliveryTickState, string> = {
  pending: "text-white/45",
  sent: "text-white/75",
  delivered: "text-white/90",
  read: "text-[#7FE7FF]",
  failed: "",
};

export default function MessageDeliveryTicks({
  status,
  className = "",
}: {
  status: string | null | undefined;
  className?: string;
}) {
  const state = deliveryTickState(status);
  if (state === "failed") return null; // el chip rojo ya dice el motivo

  const double = state === "delivered" || state === "read";
  const stroke = {
    stroke: "currentColor",
    strokeWidth: 1.7,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
  };

  return (
    <span
      title={LABEL[state]}
      aria-label={LABEL[state]}
      role="img"
      className={`ml-1 inline-flex shrink-0 align-middle ${TONE[state]} ${className}`}
    >
      <svg width="15" height="11" viewBox="0 0 16 11" fill="none" aria-hidden focusable="false">
        <path d={double ? "M1 6.2L4.2 9.3L10 1.9" : "M3.1 6.2L6.3 9.3L12.1 1.9"} {...stroke} />
        {double ? <path d="M6.2 6.2L9.4 9.3L15.2 1.9" {...stroke} /> : null}
      </svg>
    </span>
  );
}
