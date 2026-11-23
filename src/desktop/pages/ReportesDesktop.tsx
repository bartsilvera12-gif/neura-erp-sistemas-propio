"use client";

import { Wallet, ShoppingCart, Scale, Megaphone, BookText, BookOpen, Layers, HandCoins, BookMarked, Tags, ShieldCheck } from "lucide-react";
import { GRILLA_PORTADA, TarjetaPortada } from "@/components/ui/TarjetaPortada";

type ReporteCard = {
  title: string;
  subtitle: string;
  description: string;
  icon: typeof Wallet;
  href: string;
};

const REPORTES: ReporteCard[] = [
  {
    title: "Libro de Compras",
    subtitle: "Contabilidad",
    description:
      "Registro fiscal unificado de compras válidas y Gastos y Servicios confirmados: proveedor, comprobante, gravado 5%/10%, exento, IVA y totales. Exportable a Excel.",
    icon: BookText,
    href: "/reportes/libro-compras",
  },
  {
    title: "Libro de Ventas",
    subtitle: "Contabilidad",
    description:
      "Registro fiscal de ventas: comprobantes con DTE aprobado, gravado 5%/10%, exento, IVA débito y totales. Las notas de crédito figuran como movimientos negativos. Exportable a Excel.",
    icon: BookMarked,
    href: "/reportes/libro-ventas",
  },
  {
    title: "Libro Diario",
    subtitle: "Contabilidad",
    description:
      "Registro cronológico de los asientos contables generados por Compras y Gastos y Servicios, con cuentas, debe, haber y documento de origen.",
    icon: BookOpen,
    href: "/reportes/libro-diario",
  },
  {
    title: "Libro Mayor",
    subtitle: "Contabilidad",
    description:
      "Movimientos y saldos acumulados por cuenta contable, con saldo inicial, debe, haber y trazabilidad del documento de origen.",
    icon: Layers,
    href: "/reportes/libro-mayor",
  },
  {
    title: "Cuentas por Pagar",
    subtitle: "Finanzas",
    description:
      "Deuda con proveedores originada en compras a crédito: vencimiento, plazo, cuotas, monto por cuota y total adeudado, con vencidas y por vencer.",
    icon: HandCoins,
    href: "/reportes/cuentas-por-pagar",
  },
  {
    title: "Estado de cuenta empresa",
    subtitle: "Finanzas",
    description:
      "Resumen financiero general de la empresa: saldos, movimientos, ventas, compras, gastos, cobros y pagos del período.",
    icon: Wallet,
    href: "/reportes/estado-cuenta",
  },
  {
    title: "Ventas",
    subtitle: "Comercial",
    description:
      "Reporte visual de ventas por período, cliente, producto, método de pago, tipo de precio y evolución mensual.",
    icon: ShoppingCart,
    href: "/reportes/ventas",
  },
  {
    title: "Conciliación bancaria",
    subtitle: "Cobranzas",
    description:
      "Aprobá o rechazá las transferencias pendientes de conciliación. Al aprobar, se registra el cobro y su asiento contable.",
    icon: Scale,
    href: "/cobranzas/conciliacion",
  },
  {
    title: "Campañas Meta",
    subtitle: "Marketing",
    description:
      "Efectividad de campañas Meta/Facebook/Instagram según mensajes de WhatsApp, leads y tipificaciones de cierre.",
    icon: Megaphone,
    href: "/reportes/campanas-meta",
  },
  {
    title: "Tipificaciones",
    subtitle: "Atención",
    description:
      "Volumen de tipificaciones por Estado (Solicitud, Reclamo, Consulta…) con desglose en sub-estados y ranking por usuario. Marca cuántas generaron un ticket de Soporte. Filtrable por fecha, cliente y usuario.",
    icon: Tags,
    href: "/reportes/tipificaciones",
  },
  {
    title: "Guardias",
    subtitle: "Atención",
    description:
      "Quién estuvo de guardia cada semana (PM, soporte principal y suplente), los cambios de dev con su motivo, y los tickets que resolvieron durante su guardia con link a cada uno. Agrupado por mes.",
    icon: ShieldCheck,
    href: "/reportes/guardias",
  },
];

/**
 * Secciones de la pantalla. Varias áreas tienen un solo reporte: se juntan para
 * que no quede una fila con una tarjeta suelta.
 */
const SECCION_DE: Record<string, string> = {
  Contabilidad: "Contabilidad",
  Finanzas: "Finanzas y cobranzas",
  Cobranzas: "Finanzas y cobranzas",
  Comercial: "Comercial y atención",
  Marketing: "Comercial y atención",
  Atención: "Comercial y atención",
};
const seccionDe = (r: ReporteCard) => SECCION_DE[r.subtitle] ?? r.subtitle;
const SECCIONES = Array.from(new Set(REPORTES.map(seccionDe)));

/** Foto y color de cada reporte (fotos del ERP 2.0, en public/portadas). */
const FOTOS: Record<string, { imagen: string; color: string }> = {
  "/reportes/libro-compras": { imagen: "/portadas/reportes/cuentas-pagar-facturas-calculadora-dueno.webp", color: "26 50% 24%" },
  "/reportes/libro-ventas": { imagen: "/portadas/reportes/ventas-mes-grafico-barras-dueno.webp", color: "182 39% 28%" },
  "/reportes/libro-diario": { imagen: "/portadas/finanzas/credito-libro-cuentas.webp", color: "214 40% 24%" },
  "/reportes/libro-mayor": { imagen: "/portadas/finanzas/conciliacion-planilla-laptop.webp", color: "258 28% 30%" },
  "/reportes/cuentas-por-pagar": { imagen: "/portadas/reportes/proveedores-descarga-camion-dueno.webp", color: "352 38% 27%" },
  "/reportes/estado-cuenta": { imagen: "/portadas/reportes/estado-cuenta-informes-dueno.webp", color: "214 40% 24%" },
  "/reportes/ventas": { imagen: "/portadas/reportes/ventas-periodo-dashboard-dueno.webp", color: "182 39% 28%" },
  "/cobranzas/conciliacion": { imagen: "/portadas/reportes/cuentas-cobrar-deudas-laptop-dueno.webp", color: "152 34% 22%" },
  "/reportes/campanas-meta": { imagen: "/portadas/reportes/productos-vendidos-graficos-dueno.webp", color: "352 38% 27%" },
  "/reportes/tipificaciones": { imagen: "/portadas/soporte/mis-tickets-lista-pendientes.webp", color: "258 28% 30%" },
  "/reportes/guardias": { imagen: "/portadas/comercial/agenda-planificador-escribiendo.webp", color: "196 45% 20%" },
};
const FOTO_POR_DEFECTO = { imagen: "/portadas/finanzas/reportes-graficos-pantalla.webp", color: "182 39% 28%" };

export default function ReportesPage() {
  return (
    <div className="w-full min-w-0 max-w-full space-y-6">
      {/* Header */}
      <div>
        <div className="flex items-center gap-2">
          <span
            aria-hidden="true"
            className="inline-block h-2 w-2 shrink-0 rounded-full bg-[#4FAEB2] shadow-[0_0_0_3px_rgba(79,174,178,0.18)]"
          />
          <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[#4FAEB2]">
            Análisis
          </p>
        </div>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight text-slate-900">Reportes</h1>
        <p className="mt-1 text-sm text-slate-500">Elegí un reporte para ver el detalle, filtrarlo y bajarlo en Excel.</p>
      </div>

      {/* Reportes por sección, con tarjetas de foto como las portadas del menú. */}
      {SECCIONES.map((sec) => (
        <section key={sec} aria-label={sec}>
          <h2 className="mb-3 text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400">{sec}</h2>
          <div className={GRILLA_PORTADA}>
            {REPORTES.filter((r) => seccionDe(r) === sec).map((r) => {
              const foto = FOTOS[r.href] ?? FOTO_POR_DEFECTO;
              return (
                <TarjetaPortada
                  key={r.href}
                  href={r.href}
                  titulo={r.title}
                  imagen={foto.imagen}
                  color={foto.color}
                  detalle={r.description}
                />
              );
            })}
          </div>
        </section>
      ))}
    </div>
  );
}
