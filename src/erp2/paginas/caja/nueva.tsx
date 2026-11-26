"use client";

/**
 * Caja (POS) — portada de neura-erp-oymcomercial (/ventas), re-plomada al 2.0.
 * Layout de dos paneles: izquierda buscador/escaneo + carrito; derecha panel de
 * marca con el último producto + totales + descuento + "Aceptar y cobrar".
 * Venta de contado/crédito, descuento global, IVA por línea, edición de precio, ticket.
 * Caja por sucursal (receta 51): se vende en la caja abierta elegida (caja · sucursal ·
 * turno); el stock que se ve y se descuenta es el del depósito de ESA caja. Cobro con una
 * o varias formas de pago (efectivo con vuelto, débito, crédito, transferencia, QR…).
 * Mesas por cobrar (receta 69): las cuentas que Pedidos de mesas envió a caja (de la sucursal
 * de la caja). Se cargan en el carrito (no se pueden quitar ni bajar sus ítems; agregar otros sí)
 * y al cobrar la venta cierra la cuenta en la misma transacción.
 * Pedidos por cobrar (receta 77): los pedidos de mostrador que el vendedor envió a caja (de hoy,
 * de la sucursal de la caja). Se cargan desde la bandeja o escaneando / escribiendo "P-0042" en el
 * buscador; se pueden agregar, quitar o bajar productos (chip "modificado en caja") y al cobrar el
 * pedido queda cobrado con la venta en la misma transacción.
 */

import Link from "next/link";
import { Suspense, useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ArrowLeft, CheckCircle2, ChevronRight, ClipboardList, FileSignature, Info, Loader2, Lock, Package, Printer, Receipt, RotateCw, Search, Trash2, UserRound, UserRoundPlus, X } from "lucide-react";
import { Select } from "@/erp2/components/Select";
import { MAX_CUOTAS, recargoPlan, textoCredito, type CadaCuota } from "@/erp2/modules/caja/cuotas";
import { usePlanesCuota } from "@/erp2/modules/caja/usePlanesCuota";
import { CamposCredito } from "@/erp2/modules/caja/CamposCredito";
import { usePorCobrar } from "@/erp2/modules/mesas/usePorCobrar";
import { haceCuanto, origenPedido, pitido, type CuentaPorCobrar, type FacturacionPropuesta, type LineaPorCobrar } from "@/erp2/modules/mesas/tipos";
import { HojaModificadores, type ResultadoMods } from "@/erp2/modules/mesas/HojaModificadores";
import { ModsDetalle } from "@/erp2/modules/mesas/ModsDetalle";
import { usePedidosPorCobrar } from "@/erp2/modules/pedidos-mostrador/cliente";
import { numeroDePedido, type PedidoMostrador } from "@/erp2/modules/pedidos-mostrador/tipos";
import {
  claveMods, esVacia, modsParaEnviar, partesSel, precioMods, selDeSnapshot, tieneMods,
  type ModsSeleccion, type ModsSnapshot,
} from "@/erp2/modules/mesas/modificadores";
import { buscar, buscarEnIndice, exactosPrimero, indexar } from "@/erp2/lib/busqueda";
import { apiFetch } from "@/erp2/lib/api/client-fetch";
import { apiFetchCache } from "@/erp2/lib/api/cache-cliente";
import { CapaModal, ALTO_MAX_MODAL } from "@/erp2/components/CapaModal";
import { anchoTicket, type ConfigFacturacion } from "@/erp2/modules/facturacion/tipos";
import { AVISO_SIN_RUC, avisoRucInvalido, rucFacturaEstado } from "@/erp2/modules/empresa/tipos";
import { browserClient } from "@/erp2/lib/supabase/browser";
import { tienePermiso, useFuncion, useUsuario } from "@/erp2/lib/sesion/ContextoUsuario";
import { clienteConfig } from "@/erp2/cliente.config";
import { QtyInput } from "@/erp2/components/ui/QtyInput";
import { HojaInferior } from "@/erp2/components/HojaInferior";
import { useEsEscritorio } from "@/erp2/lib/ui/responsive";
import { NuevoCliente } from "@/erp2/modules/clientes/NuevoCliente";
import { CajaBarra } from "@/erp2/modules/caja/CajaBarra";
import { AperturaModal } from "@/erp2/modules/caja/AperturaModal";
import { MovimientoModal } from "@/erp2/modules/caja/MovimientoModal";
import { CierreModal } from "@/erp2/modules/caja/CierreModal";
import { TurnoModal } from "@/erp2/modules/caja/TurnoModal";
import { CobroModal, type PagoEnviar } from "@/erp2/modules/caja/CobroModal";
import { cajaEnUso, cajaGuardada, etiquetaCaja, guardarCaja, invalidarCajas, useEstadoCajas } from "@/erp2/modules/caja/turno";
import {
  calcIva,
  formatGs,
  precioSegunLista,
  type Cliente,
  type Producto,
  type TipoIva,
  type TipoPrecio,
} from "@/erp2/modules/caja/lib";
import { analizarConversion, type AnalisisConversion, type ConversionPresupuesto } from "@/erp2/modules/presupuestos/caja";

const TEAL = clienteConfig.color;
// Cantidades con coma (una pizza compartida entre 3 → "0,333").
const cantTxt = (n: number) => Number(n).toLocaleString("es-PY", { maximumFractionDigits: 3 });

/** Presupuesto que se está cobrando (?presupuesto=<id>): líneas precargadas y sus avisos. */
type PresupuestoEnCaja =
  | { id: string; etiqueta: string; prospecto: string | null; a: AnalisisConversion; lineaDe: Record<string, string> }
  | { error: string };

// Escalonado por cantidad: por defecto ≥10 mayorista y ≥20 distribuidor; cada producto puede tener
// sus propios "desde" (receta 173: mayorista_desde / distribuidor_desde).
const UMBRAL_MAYORISTA = 10;
const UMBRAL_DISTRIBUIDOR = 20;
function tierPorCantidad(c: number, p?: Pick<Producto, "mayorista_desde" | "distribuidor_desde">): TipoPrecio {
  if (c >= Number(p?.distribuidor_desde || UMBRAL_DISTRIBUIDOR)) return "distribuidor";
  if (c >= Number(p?.mayorista_desde || UMBRAL_MAYORISTA)) return "mayorista";
  return "minorista";
}

const IVAS_SEG: TipoIva[] = ["EXENTA", "5%", "10%"];
const ivaCorto = (t: TipoIva) => (t === "EXENTA" ? "Ex" : t);

type CartLine = {
  cart_line_id: string;
  producto: Producto;
  cantidad: number;
  tipo_iva: TipoIva;
  /** Precio unitario manual; si está, pisa el de lista. */
  precio_override: number | null;
  /** true = el cajero fijó el tier a mano (no lo pisa el automático por cantidad). */
  tier_manual: boolean;
  tipo_precio: TipoPrecio;
  /** Descuento de la línea (%), 0..100. En súper el descuento es por producto. */
  descuento_pct: number;
  /** Línea de la cuenta de una mesa (receta 69): lo pedido; no se quita ni se baja de acá. */
  mesa_min?: number;
  /** Línea de un pedido de mostrador (receta 77): la cantidad pedida (se puede quitar o bajar: es mostrador). */
  pedido_cant?: number;
  /** Receta 73: modificadores elegidos (se mandan como `mods`), cómo se ven y su precio por unidad
   *  (vista previa: el servidor los valida y les pone el precio). Misma combinación = misma línea. */
  mods?: ModsSeleccion;
  mods_snap?: ModsSnapshot | null;
  precio_mods?: number;
};

/** Abre el ticket imprimible en una pestaña nueva, adjuntando el Bearer. Ancho: el de Configuración › Facturación. */
async function imprimirTicket(ventaId: string, ancho: 58 | 80 = 80) {
  try {
    const { data } = await browserClient().auth.getSession();
    const token = data.session?.access_token;
    const res = await fetch(`/api/ventas/${ventaId}/ticket?auto=1${ancho === 58 ? "&w=58" : ""}`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    if (!res.ok) return;
    const html = await res.text();
    const url = URL.createObjectURL(new Blob([html], { type: "text/html" }));
    window.open(url, "_blank", "noopener");
    setTimeout(() => URL.revokeObjectURL(url), 15000);
  } catch { /* el ticket es best-effort; la venta ya quedó registrada */ }
}

/**
 * Con mouse / lector de códigos (puntero fino) el buscador se re-enfoca solo después de cada
 * acción. En celular / tablet táctil NO: enfocar abre el teclado en pantalla y tapa el carrito.
 */
const conPunteroFino = () => typeof window !== "undefined" && window.matchMedia("(pointer: fine)").matches;

function nuevaIdempotencyKey(): string {
  try {
    if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") return crypto.randomUUID();
  } catch { /* sin crypto */ }
  return `vk_${Date.now()}_${Math.random().toString(36).slice(2)}`;
}

// useSearchParams necesita un Suspense alrededor (si no, el build de Next falla).
export default function CajaPage() {
  return (
    <Suspense>
      <CajaPageContenido />
    </Suspense>
  );
}

function CajaPageContenido() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const me = useUsuario();
  // Perfil: vender a crédito (la base lo vuelve a exigir, igual que los descuentos y el precio manual).
  const puedeCredito = tienePermiso(me, "vender_credito");

  // ── Caja (turno abierto) en la que se vende ────────────────────────────────
  // La elegida en este navegador (si sigue abierta), si no la que le toca al usuario.
  const [recargaCajas, setRecargaCajas] = useState(0);
  const { datos: estadoCajas } = useEstadoCajas(recargaCajas);
  const [elegida, setElegida] = useState<string | null>(null);
  useEffect(() => { setElegida(cajaGuardada(me?.usuarioId)); }, [me?.usuarioId]);
  const caja = useMemo(() => cajaEnUso(estadoCajas, elegida), [estadoCajas, elegida]);
  const elegirCaja = useCallback((id: string) => { setElegida(id); guardarCaja(me?.usuarioId, id); }, [me?.usuarioId]);
  const refrescarCajas = useCallback(() => { invalidarCajas(); setRecargaCajas((k) => k + 1); }, []);
  const [modalCaja, setModalCaja] = useState<null | "abrir" | "mov" | "cerrar" | "ver">(null);

  // ?cerrar=1 → abre la ventana de cierre de la caja en uso (links viejos de "Arqueo y cierre").
  const pedirCierre = searchParams.get("cerrar") === "1";
  useEffect(() => {
    if (!pedirCierre || !estadoCajas) return;
    if (caja) setModalCaja("cerrar");
    router.replace("/caja/nueva", { scroll: false });
  }, [pedirCierre, estadoCajas, caja, router]);

  // ── Datos ──────────────────────────────────────────────────────────────────
  const [productos, setProductos] = useState<Producto[]>([]);
  const [clientes, setClientes] = useState<Cliente[]>([]);

  // ── Búsqueda / escaneo ───────────────────────────────────────────────────
  const [q, setQ] = useState("");
  const [hitsHighlight, setHitsHighlight] = useState(-1);
  const inputRef = useRef<HTMLInputElement>(null);

  // ── Carrito ────────────────────────────────────────────────────────────────
  const [cart, setCart] = useState<CartLine[]>([]);
  // Último producto escaneado: se guarda el producto en sí (no se deriva del
  // carrito) para que siga mostrándose aunque se borre la línea, hasta el próximo.
  const [ultimo, setUltimo] = useState<Producto | null>(null);

  // ── Datos de la venta ──────────────────────────────────────────────────────
  const [tipoVenta, setTipoVenta] = useState<"CONTADO" | "CREDITO">("CONTADO");
  const [plazoDias, setPlazoDias] = useState("");
  // Receta 98: crédito en cuotas (1 = un solo vencimiento a plazoDias).
  const [cuotas, setCuotas] = useState("1");
  const [cuotasCada, setCuotasCada] = useState<CadaCuota>("mes");
  // Receta 136: plan de cuotas y entrega inicial (se cobra en la misma venta).
  const [planId, setPlanId] = useState("");
  const planesCuota = usePlanesCuota();  // receta 137: el recargo del plan, para el modal de cobro
  const [entrega, setEntrega] = useState(0);
  const [medioEntrega, setMedioEntrega] = useState("efectivo");
  const [refEntrega, setRefEntrega] = useState("");
  const limpiarEntrega = () => { setPlanId(""); setEntrega(0); setMedioEntrega("efectivo"); setRefEntrega(""); };
  const [tipoDocumento, setTipoDocumento] = useState<"factura" | "ticket">("ticket");
  const [clienteId, setClienteId] = useState("");
  // Receta 67: "Cliente ocasional (X)" — consumidor final sin datos; sin cliente, solo contado, se puede facturar.
  const [ocasional, setOcasional] = useState(false);
  const [clienteQuery, setClienteQuery] = useState("");
  const [clienteOpen, setClienteOpen] = useState(false);
  const [modalNuevoCliente, setModalNuevoCliente] = useState(false);
  const clienteContainerRef = useRef<HTMLDivElement>(null);

  // ── Configuración › Facturación (receta 61): ancho del ticket, "pedir datos del comprador",
  // plazo por defecto del crédito y el modo (texto del documento). Sin config: como siempre.
  const [cfgFact, setCfgFact] = useState<ConfigFacturacion | null>(null);
  useEffect(() => {
    apiFetchCache<ConfigFacturacion>("/api/configuracion/facturacion", { ttlMs: 60_000 }).then(setCfgFact).catch(() => {});
  }, []);
  // "Pedir datos del comprador": antes de cobrar sin cliente se pregunta (una vez por venta).
  const [pedirComprador, setPedirComprador] = useState(false);
  const consumidorFinalRef = useRef(false);
  /** Plazo sugerido al pasar a crédito: el del cliente o los días por defecto de la configuración. */
  const plazoSugerido = (c: Cliente | null) => {
    const n = Number(c?.plazo_dias) || Number(cfgFact?.dias_vencimiento_default ?? 30);
    return n >= 1 ? String(n) : "";
  };

  // ── Cobro (una o varias formas de pago: CobroModal) ─────────────────────────
  const [cobroOpen, setCobroOpen] = useState(false);
  const [cobrando, setCobrando] = useState(false);
  const [cobroError, setCobroError] = useState<string | null>(null);
  const [ventaOk, setVentaOk] = useState<{ id: string; numero: string; vuelto: number; impreso: boolean; ancho: 58 | 80; factura_id?: string | null; numero_factura?: string | null } | null>(null);
  const isSubmittingRef = useRef(false);
  const idempotencyKeyRef = useRef<string | null>(null);

  // Espejo del estado para los atajos de teclado (se asigna en cada render).
  const kbRef = useRef<{
    abrirCobro: () => void;
    cobroOpen: boolean;
    modalAbierto: boolean;
    cart: CartLine[];
    q: string;
    inputRef: React.RefObject<HTMLInputElement | null>;
    updateCant: (id: string, n: number) => void;
    removeFromCart: (id: string) => void;
    setCobroOpen: (v: boolean) => void;
    setQ: (v: string) => void;
    setClienteOpen: (v: boolean) => void;
  }>({} as never);

  // ── Carga inicial ────────────────────────────────────────────────────────
  // Catálogo liviano para la caja (?pos=1: solo lo que usa el POS, sin costos, y COMPLETO
  // aunque pase de 1000). Clientes: solo unos pocos para las sugerencias; al escribir se
  // busca en la base.
  // Stock del depósito de la caja en uso (cambia si se cambia de caja).
  const depositoCaja = caja?.deposito_id ?? null;
  useEffect(() => {
    if (!depositoCaja) return;
    let vivo = true;
    apiFetch<Producto[]>(`/api/productos?pos=1&deposito=${depositoCaja}`).then((p) => { if (vivo) setProductos(p); }).catch(() => {});
    return () => { vivo = false; };
  }, [depositoCaja]);
  useEffect(() => {
    // Se suma a lo que ya haya (p. ej. el cliente que llega preelegido con ?cliente=).
    apiFetch<Cliente[]>("/api/clientes?limit=20")
      .then((r) => setClientes((prev) => [...prev.filter((p) => !r.some((x) => x.id === p.id)), ...r]))
      .catch(() => {});
  }, []);

  // ?cliente=<id> (desde Gestión del Cliente → "Facturar venta"): solo deja ese cliente elegido.
  const clientePre = searchParams.get("cliente");
  const clientePreHecho = useRef(false);
  useEffect(() => {
    if (!clientePre || clientePreHecho.current) return;
    clientePreHecho.current = true;
    apiFetch<{ cliente: Cliente }>(`/api/clientes/${encodeURIComponent(clientePre)}`)
      .then(({ cliente: c }) => {
        if (!c?.id) return;
        setClientes((prev) => (prev.some((x) => x.id === c.id) ? prev : [c, ...prev]));
        setClienteId(c.id);
      })
      .catch(() => {});
  }, [clientePre]);

  // ?presupuesto=<id> (Presupuestos → "Convertir a venta"): carga cliente, condición, líneas,
  // cantidades, precios y descuentos del presupuesto. No cambia nada solo: si cambió el precio
  // de lista o hay líneas que no pasan, lo avisa arriba. Al cobrar, la venta queda ligada.
  const presupuestoPre = searchParams.get("presupuesto");
  const [presu, setPresu] = useState<PresupuestoEnCaja | null>(null);
  const [ventaPresu, setVentaPresu] = useState<string | null>(null);
  const presuHecho = useRef<string | null>(null);
  useEffect(() => {
    if (!presupuestoPre || presuHecho.current === presupuestoPre) return;
    presuHecho.current = presupuestoPre;
    apiFetch<ConversionPresupuesto>(`/api/presupuestos/${encodeURIComponent(presupuestoPre)}/conversion`)
      .then((conv) => {
        const p = conv.presupuesto;
        const etiqueta = p.revision > 1 ? `${p.numero} rev ${p.revision}` : p.numero;
        if (p.estado === "convertido" || p.estado === "rechazado") {
          setPresu({ error: `El presupuesto ${etiqueta} está ${p.estado === "convertido" ? "ya convertido en venta" : "rechazado"}: no se cargó.` });
          return;
        }
        const a = analizarConversion(conv);
        const t = Date.now();
        const lineaDe: Record<string, string> = {};
        setCart(a.lineas.map((l, i) => {
          const id = `pre_${l.item_id}_${t}_${i}`;
          lineaDe[l.item_id] = id;
          // Precio del presupuesto fijado (tier_manual: no lo pisa el escalonado por cantidad).
          return { cart_line_id: id, producto: l.producto, cantidad: l.cantidad, tipo_iva: l.tipo_iva, precio_override: l.precio_override, tier_manual: true, tipo_precio: "minorista", descuento_pct: l.descuento_pct };
        }));
        setUltimo(a.lineas.length ? a.lineas[a.lineas.length - 1].producto : null);
        if (conv.cliente) {
          const c = conv.cliente;
          setClientes((prev) => (prev.some((x) => x.id === c.id) ? prev : [c, ...prev]));
          setClienteId(c.id);
        }
        if (p.condicion === "credito") { setTipoVenta("CREDITO"); setPlazoDias(p.plazo_dias ? String(p.plazo_dias) : ""); }
        else { setTipoVenta("CONTADO"); setPlazoDias(""); }
        setCuotas(p.condicion === "credito" ? String(p.cuotas ?? 1) : "1"); setCuotasCada((p.cuotas_cada as CadaCuota) ?? "mes");
        setPresu({ id: p.id, etiqueta, prospecto: conv.cliente ? null : `${p.cliente_nombre}${p.cliente_ruc ? ` (${p.cliente_ruc})` : ""}`, a, lineaDe });
      })
      .catch((e) => setPresu({ error: `No se pudo cargar el presupuesto: ${(e as Error).message}` }));
  }, [presupuestoPre]);

  useEffect(() => { if (conPunteroFino()) inputRef.current?.focus(); }, []);
  /** Vuelve al buscador (lector / teclado); en pantallas táctiles solo si se pide (`forzar`). */
  const enfocarBuscador = useCallback((forzar = false) => {
    if (forzar || conPunteroFino()) setTimeout(() => inputRef.current?.focus(), 0);
    else inputRef.current?.blur();
  }, []);

  // ── Responsive ──────────────────────────────────────────────────────────────
  // ≥ 1024 px: los dos paneles de siempre. Debajo (celular / tablet): una columna con el
  // buscador fijo arriba, el carrito en tarjetas y un pie fijo con el total y "Cobrar";
  // cliente, condición y documento van en una hoja inferior.
  const esEscritorio = useEsEscritorio();
  const [hojaOpciones, setHojaOpciones] = useState(false);
  // Mientras se escribe en el celular el pie fijo se esconde (no tapa la lista con el teclado abierto).
  const [escribiendo, setEscribiendo] = useState(false);

  // Búsqueda de clientes en la base (debounce 250 ms).
  const [clientesBuscados, setClientesBuscados] = useState<Cliente[] | null>(null);
  useEffect(() => {
    const t = clienteQuery.trim();
    setClientesBuscados(null);
    if (!t) return;
    let vivo = true;
    const h = setTimeout(() => {
      apiFetch<Cliente[]>(`/api/clientes?q=${encodeURIComponent(t)}`)
        .then((r) => { if (vivo) setClientesBuscados(r); })
        .catch(() => {});
    }, 250);
    return () => { vivo = false; clearTimeout(h); };
  }, [clienteQuery]);

  // Cerrar dropdown de cliente al click fuera.
  useEffect(() => {
    function onDown(e: MouseEvent) {
      if (clienteContainerRef.current && !clienteContainerRef.current.contains(e.target as Node)) setClienteOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, []);

  // ── Atajos de teclado (cajero de súper: una mano en el lector + pavé) ───────
  // Lee el estado vía ref para no re-suscribir el listener en cada tecla.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const s = kbRef.current;
      const el = document.activeElement as HTMLElement | null;
      const tag = el?.tagName;
      const esTexto = tag === "INPUT" || tag === "TEXTAREA" || el?.isContentEditable === true;

      // Con el cobro (o una ventana de la caja) abierto, el teclado es de esa ventana.
      if (s.cobroOpen || s.modalAbierto) return;

      // Espacio: abrir cobro. Desde el buscador VACÍO (para no romper nombres con
      // espacios) o desde una zona neutra (no un campo de texto / botón / link).
      if (e.key === " ") {
        const buscadorVacio = el === s.inputRef.current && s.q.trim() === "";
        const zonaNeutra = !esTexto && tag !== "BUTTON" && tag !== "A" && tag !== "SELECT";
        if (buscadorVacio || zonaNeutra) { e.preventDefault(); s.abrirCobro(); }
        return;
      }

      // +/− (pavé numérico): ajusta la cantidad de la última línea cargada.
      if ((e.key === "+" || e.key === "-") && s.cart.length > 0) {
        const buscadorVacio = el === s.inputRef.current && s.q.trim() === "";
        if (!esTexto || buscadorVacio) {
          e.preventDefault();
          const last = s.cart[s.cart.length - 1];
          s.updateCant(last.cart_line_id, last.cantidad + (e.key === "+" ? 1 : -1));
        }
        return;
      }

      // Supr: quita la última línea (fuera de un campo de texto).
      if (e.key === "Delete" && !esTexto && s.cart.length > 0) {
        e.preventDefault();
        s.removeFromCart(s.cart[s.cart.length - 1].cart_line_id);
        return;
      }

      // Esc fuera del modal: limpia el buscador y cierra el dropdown de cliente.
      if (e.key === "Escape") { s.setQ(""); s.setClienteOpen(false); }
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  // ── Derivados ──────────────────────────────────────────────────────────────
  // Búsqueda inteligente: nombre, SKU y código de barras (lector), sin tildes, en cualquier
  // orden y con errores de tipeo; un código exacto va primero (Enter lo agrega).
  // El catálogo se normaliza UNA vez (índice) y la lista se calcula con la consulta
  // "diferida": tipear no se traba aunque el catálogo sea grande.
  const indice = useMemo(() => indexar(productos, (p) => ({ principal: p.nombre, codigos: [p.sku, p.codigo_barras] })), [productos]);
  const qDiferida = useDeferredValue(q);
  const hitsDiferidos = useMemo(() => (qDiferida.trim() ? buscarEnIndice(indice, qDiferida, 8) : []), [indice, qDiferida]);
  const hits = q.trim() ? hitsDiferidos : [];

  const tierDe = useCallback((l: CartLine): TipoPrecio => (l.tier_manual ? l.tipo_precio : tierPorCantidad(l.cantidad, l.producto)), []);
  const precioEfectivo = useCallback((l: CartLine) => precioSegunLista(l.producto, tierDe(l)), [tierDe]);
  // Precio de lista/override por unidad (SIN descuento).
  const precioActual = useCallback((l: CartLine) => (l.precio_override != null && l.precio_override > 0 ? l.precio_override : precioEfectivo(l)), [precioEfectivo]);
  // Precio unitario YA con el descuento de la línea (como lo guarda crear_venta).
  const precioConDesc = useCallback((l: CartLine) => Math.round(precioActual(l) * (1 - (l.descuento_pct || 0) / 100)), [precioActual]);
  // Receta 73: + extras y opciones (sin el descuento del producto, como en crear_venta).
  const totalLinea = useCallback((l: CartLine) => l.cantidad * (precioConDesc(l) + (l.precio_mods ?? 0)), [precioConDesc]);

  // Redondeado a 3 decimales: tres tercios de una cuenta separada suman 1, no 1,000002.
  const cantTotal = useMemo(() => Math.round(cart.reduce((s, l) => s + l.cantidad, 0) * 1000) / 1000, [cart]);
  const total = useMemo(() => cart.reduce((s, l) => s + totalLinea(l), 0), [cart, totalLinea]);
  // IVA CONTENIDO en el total (Paraguay: el precio ya lo incluye).
  const totalIva = useMemo(() => cart.reduce((s, l) => s + calcIva(l.tipo_iva, totalLinea(l)), 0), [cart, totalLinea]);


  // Stock insuficiente (bloquea el cobro).
  // Por producto (un plato puede estar en varias líneas, una por combinación de modificadores).
  const sinStock = useMemo(() => {
    const porProd = new Map<string, number>();
    for (const l of cart) porProd.set(l.producto.id, (porProd.get(l.producto.id) ?? 0) + l.cantidad);
    return cart.filter((l) => l.producto.controla_stock && (porProd.get(l.producto.id) ?? 0) > l.producto.stock_actual);
  }, [cart]);
  const haySinStock = sinStock.length > 0;
  const idsSinStock = useMemo(() => new Set(sinStock.map((l) => l.producto.id)), [sinStock]);

  // Lotes vencidos (NO bloquea): lo pedido supera lo que no está vencido. La base vende
  // solo de lotes vigentes (primero el que vence antes) y el resto queda sin lote.
  const conVencidos = useMemo(() => {
    const pedido = new Map<string, number>();
    for (const l of cart) if (l.producto.stock_vencido) pedido.set(l.producto.id, (pedido.get(l.producto.id) ?? 0) + l.cantidad);
    const out: { id: string; nombre: string; vigente: number; pedido: number }[] = [];
    for (const [id, cant] of pedido) {
      const p = cart.find((l) => l.producto.id === id)!.producto;
      const vigente = Math.max(0, Number(p.stock_actual) - Number(p.stock_vencido ?? 0));
      if (cant > vigente && !idsSinStock.has(id)) out.push({ id, nombre: p.nombre, vigente, pedido: cant });
    }
    return out;
  }, [cart, idsSinStock]);
  const idsVencidos = useMemo(() => new Set(conVencidos.map((v) => v.id)), [conVencidos]);

  // Cliente seleccionado / filtrado.
  const clienteSel = useMemo(() => clientes.find((c) => c.id === clienteId) ?? null, [clientes, clienteId]);
  // Con texto, busca en la base (todos los clientes, no solo los cargados) y mientras
  // llega la respuesta usa los que ya están en pantalla con la misma lógica.
  const clientesFiltrados = useMemo(
    () =>
      (clienteQuery.trim() === ""
        ? clientes
        // El que coincide tal cual (nombre, razón social, CI/RUC, teléfono) va primero.
        : exactosPrimero(
            clientesBuscados ?? buscar(clientes, clienteQuery, (c) => ({ principal: c.razon_social || c.nombre, otros: [c.nombre], codigos: [c.documento, c.ruc, c.telefono] })),
            clienteQuery, (c) => [c.nombre, c.razon_social, c.documento, c.ruc, c.telefono])
      ).slice(0, 50),
    [clientes, clienteQuery, clientesBuscados],
  );
  // Opciones del desplegable de cliente, en el orden en que se ven (Enter elige la marcada, la
  // primera por defecto). Con texto: primero los clientes que coinciden, después "Cargar nuevo
  // cliente" y al final el ocasional; con el campo vacío, el ocasional primero.
  type OpcionCliente = { tipo: "ocasional" } | { tipo: "nuevo" } | { tipo: "cliente"; c: Cliente };
  const opcionesCliente = useMemo<OpcionCliente[]>(() => {
    const lista = clientesFiltrados.map((c): OpcionCliente => ({ tipo: "cliente", c }));
    return clienteQuery.trim()
      ? [...lista, { tipo: "nuevo" }, { tipo: "ocasional" }]
      : [{ tipo: "ocasional" }, { tipo: "nuevo" }, ...lista];
  }, [clientesFiltrados, clienteQuery]);
  const [clienteMarcado, setClienteMarcado] = useState(0);
  useEffect(() => { setClienteMarcado(0); }, [clienteQuery, clientesBuscados]);

  // Receta 66: sin RUC no hay factura. RUC = el de Datos para facturación o el documento si es un
  // RUC con dígito verificador (una CI sola no alcanza). Sin cliente o sin RUC → solo ticket.
  const rucEstado = rucFacturaEstado(clienteSel);
  const rucFactura = rucEstado.estado === "ok" ? rucEstado.ruc : null;
  // Sin RUC → el aviso de siempre; con un RUC cargado pero con el dígito verificador mal → cuál debería ser.
  const avisoRuc = rucEstado.estado === "invalido" ? avisoRucInvalido(rucEstado) : AVISO_SIN_RUC;
  // Receta 67: cliente ocasional (X): factura sin RUC, salvo que la venta pase el tope configurado.
  const nombreOcasional = cfgFact?.ocasional_nombre?.trim() || "X";
  const rucOcasional = cfgFact?.ocasional_ruc?.trim() || "X";
  const topeOcasional = cfgFact?.ocasional_tope ?? null;
  const superaTopeOcasional = ocasional && topeOcasional != null && total > topeOcasional;
  const puedeFacturar = ocasional ? !superaTopeOcasional : !!rucFactura;
  // Elegir un cliente de verdad saca el "ocasional".
  useEffect(() => {
    if (clienteId && ocasional) setOcasional(false);
  }, [clienteId, ocasional]);
  function elegirOcasional(facturar = false) {
    setClienteId("");
    setClienteQuery("");
    setClienteOpen(false);
    setOcasional(true);
    // El crédito necesita un cliente real: el ocasional es solo al contado.
    if (tipoVenta === "CREDITO") { setTipoVenta("CONTADO"); setPlazoDias(""); setCuotas("1"); setCuotasCada("mes"); limpiarEntrega(); }
    if (facturar) setTipoDocumento("factura");
    if (cobroError) setCobroError(null);
  }
  function elegirOpcionCliente(o: OpcionCliente) {
    if (o.tipo === "ocasional") { elegirOcasional(); return; }
    if (o.tipo === "nuevo") { setClienteOpen(false); setHojaOpciones(false); setModalNuevoCliente(true); return; }
    const c = o.c;
    if (!clientes.some((x) => x.id === c.id)) setClientes((prev) => [c, ...prev]);
    setClienteId(c.id);
    setClienteQuery("");
    setClienteOpen(false);
  }
  // Buscador de cliente: ↑/↓ marcan, Enter elige la marcada (la primera de la lista), Esc cierra.
  function onKeyDownCliente(e: React.KeyboardEvent<HTMLInputElement>) {
    if (ocasional || clienteSel) return;
    if (e.key === "ArrowDown") { e.preventDefault(); setClienteOpen(true); setClienteMarcado((i) => Math.min(i + 1, opcionesCliente.length - 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setClienteMarcado((i) => Math.max(i - 1, 0)); }
    else if (e.key === "Enter") {
      e.preventDefault();
      e.stopPropagation();
      const o = opcionesCliente[Math.min(clienteMarcado, opcionesCliente.length - 1)];
      if (o) elegirOpcionCliente(o);
    } else if (e.key === "Escape" && clienteOpen) { e.stopPropagation(); setClienteOpen(false); }
  }
  useEffect(() => {
    if (!puedeFacturar && tipoDocumento === "factura") setTipoDocumento("ticket");
  }, [puedeFacturar, tipoDocumento]);
  // El RUC se carga en la ficha (otra pestaña): al volver a la caja se relee el cliente elegido.
  const recargarCliente = useCallback((id: string) => {
    apiFetch<{ cliente: Cliente }>(`/api/clientes/${encodeURIComponent(id)}`)
      .then(({ cliente: c }) => { if (c?.id) setClientes((prev) => prev.map((x) => (x.id === c.id ? { ...x, ...c } : x))); })
      .catch(() => {});
  }, []);
  const clienteSinRuc = clienteSel && !puedeFacturar ? clienteSel.id : null;
  useEffect(() => {
    if (!clienteSinRuc) return;
    const alVolver = () => { if (document.visibilityState === "visible") recargarCliente(clienteSinRuc); };
    window.addEventListener("focus", alVolver);
    document.addEventListener("visibilitychange", alVolver);
    return () => { window.removeEventListener("focus", alVolver); document.removeEventListener("visibilitychange", alVolver); };
  }, [clienteSinRuc, recargarCliente]);

  const clienteObligatorio = !ocasional && (tipoDocumento === "factura" || tipoVenta === "CREDITO");
  const plazoDiasNum = parseInt(plazoDias) || 0;
  const cuotasNum = parseInt(cuotas) || 0;
  const cuotasOk = cuotasNum >= 1 && cuotasNum <= MAX_CUOTAS;

  // Presupuesto: se liga a la venta solo si en el carrito queda alguna de sus líneas.
  const presuOk = presu && !("error" in presu) ? presu : null;
  const presuActivo = presuOk && cart.some((l) => Object.values(presuOk.lineaDe).includes(l.cart_line_id)) ? presuOk : null;
  function usarPreciosDeHoy() {
    if (!presuOk) return;
    const ids = new Set(presuOk.a.cambiosPrecio.map((c) => presuOk.lineaDe[c.item_id]));
    setCart((prev) => prev.map((l) => (ids.has(l.cart_line_id) ? { ...l, precio_override: null, tier_manual: false } : l)));
    setPresu({ ...presuOk, a: { ...presuOk.a, cambiosPrecio: [] } });
  }
  function desvincularPresupuesto() {
    setPresu(null);
    router.replace("/caja/nueva", { scroll: false });
  }

  // ── Mesas por cobrar (receta 69) ────────────────────────────────────────────
  // Cuentas que Pedidos de mesas envió a caja, de la sucursal de la caja en uso (cada 4 s, con
  // un pitido cuando entra una nueva). Se carga UNA en el carrito: sus líneas quedan fijas (no se
  // quitan ni se bajan) y al cobrar la base cierra la cuenta con la venta en la misma transacción.
  // Receta 75: con Mesas y QR apagada no hay bandeja "Mesas por cobrar" ni su polling.
  const conMesas = useFuncion("mesas");
  const { cuentas: porCobrar, fresco: porCobrarFresco, recargar: recargarPorCobrar, ahora: ahoraMesas } = usePorCobrar(conMesas ? caja?.id ?? null : null, () => pitido());
  const [bandejaMesas, setBandejaMesas] = useState(false);
  const [cuentaMesa, setCuentaMesa] = useState<CuentaPorCobrar | null>(null);
  const [errorMesa, setErrorMesa] = useState<string | null>(null);
  const cuentaMesaAhora = cuentaMesa ? porCobrar.find((c) => c.id === cuentaMesa.id) ?? null : null;
  const cuentaMesaCambio = !!cuentaMesa && !!cuentaMesaAhora && cuentaMesaAhora.version !== cuentaMesa.version;
  const cuentaMesaSeFue = !!cuentaMesa && porCobrarFresco && !cuentaMesaAhora;

  // Receta 88: cuenta separada desde el QR → se carga UNA parte (o el resto) y se cobra sola.
  const [parteMesa, setParteMesa] = useState<{ id: string; nombre: string; total: number } | null>(null);
  // Datos de facturación que propuso la mesa y que todavía no son un cliente (la caja confirma crearlo).
  const [factPropuesta, setFactPropuesta] = useState<FacturacionPropuesta | null>(null);
  const [creandoCliente, setCreandoCliente] = useState(false);

  function lineasDeMesa(c: CuentaPorCobrar, lista: LineaPorCobrar[] = c.items): CartLine[] | string {
    const t = Date.now();
    const out: CartLine[] = [];
    for (const [i, it] of lista.entries()) {
      const prod = it.producto_id ? productos.find((p) => p.id === it.producto_id) : undefined;
      if (!prod) return `"${it.nombre}" no está en el catálogo de esta caja: no se puede cargar la cuenta.`;
      // Receta 73: la línea conserva sus modificadores (el servidor los vuelve a validar y cobrar).
      const sel = it.modificadores ? selDeSnapshot(it.modificadores) : undefined;
      const pMods = sel ? (tieneMods(prod.mods) ? precioMods(prod.mods, sel) : Number(it.precio_mods) || 0) : 0;
      out.push({
        cart_line_id: `mesa_${c.id}_${i}_${t}`,
        producto: prod,
        cantidad: Number(it.cantidad),
        tipo_iva: prod.tipo_iva,
        // Precio del pedido: si es el de hoy va con el descuento del producto (igual que la caja);
        // si cambió desde que se pidió, se respeta el del pedido (sin los modificadores: se suman aparte).
        precio_override: it.precio_de_hoy ? null : Number(it.precio_base ?? Number(it.precio_unitario) - (Number(it.precio_mods) || 0)),
        tier_manual: true,
        tipo_precio: "minorista",
        descuento_pct: it.precio_de_hoy ? Math.max(0, Math.min(Number(prod.descuento_pct) || 0, 100)) : 0,
        mesa_min: Number(it.cantidad),
        mods: sel,
        mods_snap: it.modificadores ?? null,
        precio_mods: pMods,
      });
    }
    return out;
  }

  /** Cliente de la factura propuesta por la mesa: si ya existe se elige (y factura); si no, se ofrece crearlo. */
  function aplicarFactPropuesta(f: FacturacionPropuesta | null | undefined) {
    setFactPropuesta(null);
    setOcasional(false);
    setClienteId("");
    setClienteQuery("");
    setTipoDocumento("ticket");
    if (!f) return;
    if (!f.cliente) { setFactPropuesta(f); return; }
    const cid = f.cliente.id;
    apiFetch<{ cliente: Cliente }>(`/api/clientes/${encodeURIComponent(cid)}`)
      .then(({ cliente: cl }) => {
        if (!cl?.id) return;
        setClientes((prev) => (prev.some((x) => x.id === cl.id) ? prev.map((x) => (x.id === cl.id ? { ...x, ...cl } : x)) : [cl, ...prev]));
        setClienteId(cl.id);
        setTipoDocumento("factura");
      })
      .catch(() => setFactPropuesta(f));
  }

  async function crearClientePropuesto() {
    const f = factPropuesta;
    if (!f || creandoCliente) return;
    setCreandoCliente(true);
    setErrorMesa(null);
    try {
      const cl = await apiFetch<Cliente>("/api/clientes", {
        method: "POST",
        body: JSON.stringify({
          nombre: f.razon_social, razon_social: f.razon_social, tipo_cliente: /^80\d{6}-\d$/.test(f.ruc) ? "empresa" : "persona",
          documento: f.ruc, ruc: f.ruc, ...(f.email ? { email: f.email } : {}), condicion_pago: "CONTADO",
        }),
      });
      setClientes((prev) => [cl, ...prev.filter((x) => x.id !== cl.id)]);
      setClienteId(cl.id);
      setOcasional(false);
      setTipoDocumento("factura");
      setFactPropuesta(null);
    } catch (e) {
      setErrorMesa(`No se pudo crear el cliente: ${(e as Error).message}`);
    } finally {
      setCreandoCliente(false);
    }
  }

  function cargarCuentaMesa(c: CuentaPorCobrar, parteId?: string | null) {
    setErrorMesa(null);
    // Receta 88: una parte (o el resto) de la cuenta separada.
    const parte = parteId && parteId !== "resto" ? c.division?.partes.find((x) => x.id === parteId) ?? null : null;
    if (parteId && parteId !== "resto" && (!parte || parte.cobrada)) { setErrorMesa(parte ? `La parte de "${parte.nombre}" ya se cobró.` : "Esa parte ya no está en la cuenta: elegila de nuevo."); return; }
    if (parteId === "resto" && !c.division?.resto) { setErrorMesa("No queda nada sin asignar en esa cuenta."); return; }
    if (!parteId && c.division?.partes.some((x) => x.cobrada)) { setErrorMesa("Ya se cobró una parte de esa cuenta: cobrá las partes que faltan."); return; }
    const lista = parte ? parte.items : parteId === "resto" ? c.division!.resto!.items : c.items;
    const lineas = lineasDeMesa(c, lista);
    if (typeof lineas === "string") { setErrorMesa(lineas); return; }
    setParteMesa(parte ? { id: parte.id, nombre: parte.nombre, total: parte.total } : parteId === "resto" ? { id: "resto", nombre: "Resto", total: c.division!.resto!.total } : null);
    aplicarFactPropuesta(parte ? parte.facturacion : c.facturacion);
    // Receta 77: una mesa o un pedido por venta (cargar la mesa suelta el pedido).
    setCart((prev) => [...lineas, ...prev.filter((l) => !l.mesa_min && l.pedido_cant == null)]);
    setPedido(null);
    setErrorPedido(null);
    setUltimo(lineas.length ? lineas[lineas.length - 1].producto : null);
    setCuentaMesa(c);
    setBandejaMesas(false);
    idempotencyKeyRef.current = null;
    if (cobroError) setCobroError(null);
  }

  function soltarCuentaMesa() {
    setCart((prev) => prev.filter((l) => !l.mesa_min));
    setCuentaMesa(null);
    setParteMesa(null);
    setFactPropuesta(null);
    setErrorMesa(null);
    idempotencyKeyRef.current = null;
  }

  // ── Pedidos por cobrar (receta 77) ──────────────────────────────────────────
  // Pedidos de mostrador que el vendedor envió a caja (de hoy, de la sucursal de la caja; cada 4 s,
  // con un pitido cuando entra uno). El nivel Vendedor arma pedidos pero no los cobra: sin bandeja.
  // Se carga UNO en el carrito (con los precios del pedido); se puede agregar, quitar o bajar. Al
  // cobrar, la base deja el pedido cobrado con la venta en la misma transacción.
  const conPedidos = useFuncion("pedidos");
  const cobraPedidos = !!me && me.rol !== "VENDEDOR";
  const { pedidos: pedidosPorCobrar, fresco: pedidosFresco, recargar: recargarPedidos, ahora: ahoraPedidos } =
    usePedidosPorCobrar(conPedidos && cobraPedidos ? caja?.id ?? null : null, () => pitido());
  const [bandejaPedidos, setBandejaPedidos] = useState(false);
  const [pedido, setPedido] = useState<PedidoMostrador | null>(null);
  const [errorPedido, setErrorPedido] = useState<string | null>(null);
  const [buscandoPedido, setBuscandoPedido] = useState(false);
  const [numeroBandeja, setNumeroBandeja] = useState("");
  const pedidoAhora = pedido ? pedidosPorCobrar.find((x) => x.id === pedido.id) ?? null : null;
  const pedidoCambio = !!pedido && !!pedidoAhora && pedidoAhora.version !== pedido.version;
  const pedidoSeFue = !!pedido && pedidosFresco && !pedidoAhora;
  // "Modificado en caja": se quitó o cambió una línea del pedido, o se agregaron otras.
  const pedidoModificado = useMemo(() => {
    if (!pedido) return false;
    const delPedido = cart.filter((l) => l.pedido_cant != null);
    if (delPedido.length !== pedido.items.length || delPedido.length !== cart.length) return true;
    return delPedido.some((l) => l.cantidad !== l.pedido_cant);
  }, [pedido, cart]);

  function lineasDePedido(pd: PedidoMostrador): CartLine[] | string {
    const t = Date.now();
    const out: CartLine[] = [];
    for (const [i, it] of pd.items.entries()) {
      const prod = it.producto_id ? productos.find((x) => x.id === it.producto_id) : undefined;
      if (!prod) return `"${it.nombre}" no está en el catálogo de esta caja: no se puede cargar el pedido.`;
      const sel = it.modificadores ? selDeSnapshot(it.modificadores) : undefined;
      const pMods = sel ? (tieneMods(prod.mods) ? precioMods(prod.mods, sel) : Number(it.precio_mods) || 0) : 0;
      out.push({
        cart_line_id: `ped_${pd.id}_${i}_${t}`,
        producto: prod,
        cantidad: Number(it.cantidad),
        tipo_iva: prod.tipo_iva,
        // Precio del pedido: si es el de hoy, el de lista con el descuento del producto (igual que la
        // caja); si cambió desde que se armó, se respeta el del pedido (sin los modificadores).
        precio_override: it.precio_de_hoy ? null : Number(it.precio_base),
        tier_manual: true,
        tipo_precio: "minorista",
        descuento_pct: it.precio_de_hoy ? Math.max(0, Math.min(Number(prod.descuento_pct) || 0, 100)) : 0,
        pedido_cant: Number(it.cantidad),
        mods: sel,
        mods_snap: it.modificadores ?? null,
        precio_mods: pMods,
      });
    }
    return out;
  }

  function cargarPedido(pd: PedidoMostrador) {
    setErrorPedido(null);
    const lineas = lineasDePedido(pd);
    if (typeof lineas === "string") { setErrorPedido(lineas); return; }
    // Un pedido o una mesa por venta: cargar el pedido suelta la cuenta de mesa (y el pedido anterior).
    setCart((prev) => [...lineas, ...prev.filter((l) => !l.mesa_min && l.pedido_cant == null)]);
    if (cuentaMesa) { setCuentaMesa(null); setParteMesa(null); setFactPropuesta(null); setErrorMesa(null); }
    setUltimo(lineas.length ? lineas[lineas.length - 1].producto : null);
    setPedido(pd);
    setBandejaPedidos(false);
    setNumeroBandeja("");
    idempotencyKeyRef.current = null;
    if (cobroError) setCobroError(null);
    // Cliente del pedido (si tiene): queda elegido; el cajero lo puede cambiar.
    const cid = pd.cliente?.id;
    if (cid) {
      setOcasional(false);
      apiFetch<{ cliente: Cliente }>(`/api/clientes/${encodeURIComponent(cid)}`)
        .then(({ cliente: c }) => {
          if (!c?.id) return;
          setClientes((prev) => (prev.some((x) => x.id === c.id) ? prev : [c, ...prev]));
          setClienteId(c.id);
        })
        .catch(() => {});
    }
  }

  function soltarPedido() {
    setCart((prev) => prev.filter((l) => l.pedido_cant == null));
    setPedido(null);
    setErrorPedido(null);
    idempotencyKeyRef.current = null;
  }

  /** Escaneo / número escrito ("P-0042"): de la bandeja, o se pide a la base (mensaje claro si no se puede). */
  async function cargarPedidoPorNumero(n: number) {
    setErrorPedido(null);
    const enBandeja = pedidosPorCobrar.find((x) => x.numero === n);
    if (enBandeja) { cargarPedido(enBandeja); return; }
    if (!caja) { setErrorPedido("Abrí la caja para cobrar el pedido."); return; }
    setBuscandoPedido(true);
    try {
      const pd = await apiFetch<PedidoMostrador>(`/api/pedidos-mostrador/numero/${n}?caja=${caja.id}`);
      cargarPedido(pd);
      void recargarPedidos();
    } catch (e) {
      setErrorPedido((e as Error).message);
    } finally {
      setBuscandoPedido(false);
    }
  }

  // ── Acciones carrito ───────────────────────────────────────────────────────
  // Receta 73: un plato con modificadores abre primero la hoja (quitar / extras / opciones).
  const [hojaMods, setHojaMods] = useState<{ p: Producto; editar?: string; reenfocar?: boolean } | null>(null);
  const addToCart = useCallback((p: Producto, reenfocar?: boolean, r?: ResultadoMods) => {
    if (tieneMods(p.mods) && !r) {
      setHojaMods({ p, reenfocar });
      setQ("");
      setHitsHighlight(-1);
      return;
    }
    const sel = r && !esVacia(r.sel) ? r.sel : undefined;
    const clave = claveMods(sel);
    const cant = r?.cantidad ?? 1;
    setCart((prev) => {
      const idx = prev.findIndex((l) => l.producto.id === p.id && claveMods(l.mods) === clave);
      if (idx !== -1) {
        const copia = [...prev];
        copia[idx] = { ...copia[idx], cantidad: copia[idx].cantidad + cant };
        return copia;
      }
      const nuevo: CartLine = {
        cart_line_id: `${p.id}_${Date.now()}`,
        producto: p,
        cantidad: cant,
        tipo_iva: p.tipo_iva,
        precio_override: null,
        tier_manual: false,
        tipo_precio: "minorista",
        descuento_pct: Math.max(0, Math.min(Number(p.descuento_pct) || 0, 100)), // viene del producto (Inventario)
        ...(sel && p.mods ? { mods: sel, mods_snap: partesSel(p.mods, sel), precio_mods: r?.precio_mods ?? 0 } : {}),
      };
      return [...prev, nuevo];
    });
    // El último producto escaneado (nuevo o repetido) es el que se muestra en el panel.
    setUltimo(p);
    setQ("");
    setHitsHighlight(-1);
    enfocarBuscador(reenfocar);
  }, [enfocarBuscador]);

  /** Hoja de modificadores confirmada: agrega la línea o cambia la que se estaba editando. */
  function confirmarHojaMods(r: ResultadoMods) {
    const h = hojaMods;
    if (!h) return;
    setHojaMods(null);
    if (!h.editar) { addToCart(h.p, h.reenfocar, r); return; }
    const sel = esVacia(r.sel) ? undefined : r.sel;
    setCart((prev) => {
      const l = prev.find((x) => x.cart_line_id === h.editar);
      if (!l) return prev;
      const otra = prev.find((x) => x.cart_line_id !== h.editar && x.producto.id === l.producto.id && claveMods(x.mods) === r.clave);
      if (otra) {
        return prev.filter((x) => x.cart_line_id !== h.editar).map((x) => (x.cart_line_id === otra.cart_line_id ? { ...x, cantidad: x.cantidad + r.cantidad } : x));
      }
      return prev.map((x) => (x.cart_line_id === h.editar
        ? { ...x, cantidad: r.cantidad, mods: sel, mods_snap: sel && l.producto.mods ? partesSel(l.producto.mods, sel) : null, precio_mods: sel ? r.precio_mods : 0 }
        : x));
    });
    enfocarBuscador();
  }

  const updateCant = useCallback((id: string, n: number) => {
    if (!Number.isFinite(n) || n <= 0) return;
    // Cuenta de mesa: no se baja de lo que pidió la mesa.
    setCart((prev) => prev.map((l) => (l.cart_line_id === id ? { ...l, cantidad: l.mesa_min ? Math.max(n, l.mesa_min) : n } : l)));
  }, []);

  const setIvaLinea = useCallback((id: string, iva: TipoIva) => {
    setCart((prev) => prev.map((l) => (l.cart_line_id === id ? { ...l, tipo_iva: iva } : l)));
  }, []);

  const removeFromCart = useCallback((id: string) => {
    // Las líneas de la cuenta de una mesa no se quitan (se suelta la cuenta entera).
    setCart((prev) => prev.filter((l) => l.cart_line_id !== id || !!l.mesa_min));
  }, []);

  const vaciarCarrito = useCallback(() => {
    setCart([]);
    setUltimo(null);
    setCuentaMesa(null);
    setParteMesa(null);
    setFactPropuesta(null);
    setPedido(null);
  }, []);

  function onKeyDownBuscar(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown") { e.preventDefault(); setHitsHighlight((h) => Math.min(h + 1, hits.length - 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setHitsHighlight((h) => Math.max(h - 1, 0)); }
    else if (e.key === "Enter") {
      e.preventDefault();
      // El lector de códigos tipea rápido y aprieta Enter: si la lista todavía es la de una
      // consulta vieja (diferida), se busca YA con lo escrito para no agregar otro producto.
      const alDia = qDiferida === q;
      // Receta 77: "P-0042" (escaneado del comprobante o escrito) carga el pedido, salvo que sea
      // justo el código de un producto.
      const nPedido = conPedidos && cobraPedidos ? numeroDePedido(q) : null;
      if (nPedido) {
        const t = q.trim().toLowerCase();
        const esCodigo = productos.some((x) => (x.sku ?? "").toLowerCase() === t || (x.codigo_barras ?? "").toLowerCase() === t);
        if (!esCodigo) {
          setQ("");
          setHitsHighlight(-1);
          void cargarPedidoPorNumero(nPedido);
          return;
        }
      }
      const lista = alDia ? hits : q.trim() ? buscarEnIndice(indice, q, 8) : [];
      const pick = alDia && hitsHighlight >= 0 ? lista[hitsHighlight] : lista[0];
      if (pick) addToCart(pick, true); // lector / teclado: sigue en el buscador
    }
  }

  // ── Cobro ──────────────────────────────────────────────────────────────────
  function abrirCobro() {
    setCobroError(null);
    if (cart.length === 0 || haySinStock) return;
    if (!caja) {
      setCobroError("Abrí (o elegí) la caja en la que vas a vender.");
      return;
    }
    if (cuentaMesaSeFue) { setCobroError("La cuenta de la mesa ya no está en caja: soltala para seguir."); return; }
    if (cuentaMesaCambio) { setCobroError("La cuenta de la mesa cambió: recargala antes de cobrar."); return; }
    if (cuentaMesaAhora && cuentaMesaAhora.pendientes > 0) { setCobroError("La mesa tiene un pedido nuevo sin atender: aceptalo o rechazalo en Pedidos de mesas."); return; }
    if (pedidoSeFue) { setCobroError(`El pedido ${pedido?.etiqueta} ya no está en caja (lo cobraron, lo anularon o venció): soltalo para seguir.`); return; }
    if (pedidoCambio) { setCobroError(`El pedido ${pedido?.etiqueta} cambió: recargalo antes de cobrar.`); return; }
    if (clienteObligatorio && !clienteId) {
      setCobroError(tipoDocumento === "factura" ? "Para emitir factura elegí un cliente." : "La venta a crédito requiere un cliente.");
      if (!esEscritorio) setHojaOpciones(true); // celular / tablet: el cliente está en la hoja
      return;
    }
    if (tipoVenta === "CREDITO" && plazoDiasNum < 1) {
      setCobroError("Ingresá en cuántos días vence (al menos 1).");
      if (!esEscritorio) setHojaOpciones(true);
      return;
    }
    if (tipoVenta === "CREDITO" && !cuotasOk) {
      setCobroError(`Las cuotas van de 1 a ${MAX_CUOTAS}.`);
      if (!esEscritorio) setHojaOpciones(true);
      return;
    }
    // Receta 136: la entrega es menor que el total (la base vuelve a validar el mínimo del plan).
    if (tipoVenta === "CREDITO" && entrega > 0 && entrega >= total) {
      setCobroError("La entrega tiene que ser menor que el total: si paga todo, es al contado.");
      if (!esEscritorio) setHojaOpciones(true);
      return;
    }
    if (tipoVenta === "CREDITO" && entrega > 0 && (cuentaMesa || pedido)) {
      setCobroError("La entrega y el plan no se usan al cobrar una mesa o un pedido.");
      return;
    }
    // Configuración › Facturación › "Pedir datos del comprador al confirmar venta".
    if (cfgFact?.preguntar_datos_al_confirmar && !clienteId && !ocasional && !consumidorFinalRef.current) {
      setPedirComprador(true);
      return;
    }
    setCobroOpen(true);
  }

  function elegirCompradorAhora(nuevo: boolean) {
    setPedirComprador(false);
    if (nuevo) { setModalNuevoCliente(true); return; }
    if (!esEscritorio) setHojaOpciones(true);
    setClienteOpen(true);
    setTimeout(() => clienteContainerRef.current?.querySelector("input")?.focus(), 0);
  }

  async function confirmarCobro(pagos: PagoEnviar[]) {
    if (isSubmittingRef.current || !caja) return;
    isSubmittingRef.current = true;
    setCobrando(true);
    setCobroError(null);
    if (!idempotencyKeyRef.current) idempotencyKeyRef.current = nuevaIdempotencyKey();
    try {
      const items = cart.map((l) => {
        const tier = tierDe(l);
        return {
          producto_id: l.producto.id,
          cantidad: l.cantidad,
          tipo_precio: tier,
          tipo_iva: l.tipo_iva,
          descuento_pct: l.descuento_pct || 0,
          ...(l.precio_override != null && l.precio_override > 0 ? { precio_unitario: l.precio_override } : {}),
          // Receta 73: modificadores (la base los valida y les pone el precio).
          ...(modsParaEnviar(l.mods) ? { mods: modsParaEnviar(l.mods) } : {}),
        };
      });
      const venta = await apiFetch<{ venta_id: string; numero_control: string; total: number; vuelto?: number; factura_id?: string | null; numero_factura?: string | null; aviso_presupuesto?: string; cuenta_cerrada?: boolean; faltan?: number }>("/api/caja/venta", {
        method: "POST",
        body: JSON.stringify({
          caja_id: caja.id,
          cliente_id: ocasional ? null : clienteId || null,
          cliente_ocasional: ocasional,
          tipo_venta: tipoVenta,
          tipo_documento: tipoDocumento,
          moneda: "GS",
          idempotency_key: idempotencyKeyRef.current,
          plazo_dias: tipoVenta === "CREDITO" ? plazoDiasNum : undefined,
          cuotas: tipoVenta === "CREDITO" ? cuotasNum : undefined,
          cuotas_cada: tipoVenta === "CREDITO" && cuotasNum > 1 ? cuotasCada : undefined,
          items,
          // Formas de pago (contado). A crédito con entrega (receta 136): lo que paga de entrega.
          pagos: tipoVenta === "CREDITO"
            ? (entrega > 0 ? [{ metodo_pago: medioEntrega, monto: entrega, referencia: refEntrega.trim() || null }] : undefined)
            : pagos,
          plan_id: tipoVenta === "CREDITO" && planId ? planId : undefined,
          entrega: tipoVenta === "CREDITO" && entrega > 0 ? entrega : undefined,
          presupuesto_id: presuActivo?.id,
          // Receta 69: la venta cierra la cuenta de la mesa (misma transacción en la base).
          mesa_cuenta_id: cuentaMesa?.id,
          mesa_version: cuentaMesa?.version,
          // Receta 88: una parte de la cuenta separada (o el resto), con su propia venta.
          mesa_parte: cuentaMesa && parteMesa ? parteMesa.id : undefined,
          // Receta 77: la venta deja el pedido de mostrador cobrado (misma transacción en la base).
          pedido_id: pedido?.id,
          pedido_version: pedido?.version,
        }),
      });
      idempotencyKeyRef.current = null;
      if (cuentaMesa) void recargarPorCobrar();
      if (pedido) void recargarPedidos();
      if (presuActivo) {
        setVentaPresu(venta.aviso_presupuesto ?? `Presupuesto ${presuActivo.etiqueta} convertido en venta.`);
        setPresu(null);
        router.replace("/caja/nueva", { scroll: false });
      } else {
        setVentaPresu(cuentaMesa && parteMesa
          ? venta.cuenta_cerrada
            ? `${parteMesa.id === "resto" ? "Resto (sin asignar) cobrado" : `Parte de ${parteMesa.nombre} cobrada`}: la cuenta de ${cuentaMesa.mesa.nombre} quedó cerrada.`
            : `${parteMesa.id === "resto" ? "Resto (sin asignar) cobrado" : `Parte de ${parteMesa.nombre} cobrada`} (${cuentaMesa.mesa.nombre}). ${venta.faltan ? `Falta${venta.faltan === 1 ? "" : "n"} ${venta.faltan} parte${venta.faltan === 1 ? "" : "s"}: ${venta.faltan === 1 ? "cargala" : "cargalas"} desde Mesas por cobrar.` : ""}`.trim()
          : cuentaMesa ? `Cuenta de ${cuentaMesa.mesa.nombre} cerrada.` : pedido ? `Pedido ${pedido.etiqueta} cobrado.` : null);
      }
      // Stock: se descuenta en pantalla lo recién vendido (antes se volvía a bajar TODO el
      // catálogo después de cada venta). La base igual valida el stock al vender.
      const vendido = new Map<string, number>();
      for (const l of cart) if (l.producto.controla_stock) vendido.set(l.producto.id, (vendido.get(l.producto.id) ?? 0) + l.cantidad);
      if (vendido.size) setProductos((prev) => prev.map((p) => (vendido.has(p.id) ? { ...p, stock_actual: Number(p.stock_actual) - (vendido.get(p.id) ?? 0) } : p)));
      // Receta 72: un plato consume ingredientes que comparten otros platos: se refrescan las
      // porciones de todo el catálogo (en segundo plano).
      if (depositoCaja && cart.some((l) => l.producto.tipo_producto === "menu")) {
        apiFetch<Producto[]>(`/api/productos?pos=1&deposito=${depositoCaja}`).then(setProductos).catch(() => {});
      }
      // Ticket imprimible (SIFEN inactivo → por ahora siempre ticket). La auth del
      // 2.0 es por Bearer, así que una pestaña nueva no lleva el token: traemos el
      // HTML con el token y lo abrimos como blob (el auto-print corre igual).
      // Receta 71: "Imprimir automáticamente al cobrar" (Configuración › Tickets y facturación; default sí).
      const autoTicket = cfgFact?.ticket_venta?.imprimir_al_cobrar !== false;
      const anchoCfg = cfgFact?.ticket_venta?.ancho_mm ?? anchoTicket(cfgFact?.impresion_tipo_default);
      if (autoTicket) void imprimirTicket(venta.venta_id, anchoCfg);
      consumidorFinalRef.current = false;
      setVentaOk({ id: venta.venta_id, numero: venta.numero_control, vuelto: Number(venta.vuelto) || 0, impreso: autoTicket, ancho: anchoCfg, factura_id: venta.factura_id, numero_factura: venta.numero_factura });
      setCobroOpen(false);
      vaciarCarrito();
      setClienteId("");
      setClienteQuery("");
      setOcasional(false);
      setTipoVenta("CONTADO");
      setPlazoDias("");
      setCuotas("1");
      setCuotasCada("mes");
      limpiarEntrega();
      enfocarBuscador();
    } catch (e) {
      const msg = (e as Error).message;
      setCobroError(msg);
      // La caja se cerró (u otra cosa cambió) mientras se vendía: se refresca el estado.
      if (/caja/i.test(msg)) refrescarCajas();
    } finally {
      isSubmittingRef.current = false;
      setCobrando(false);
    }
  }

  // Espejo del estado para los atajos de teclado (siempre el último valor).
  kbRef.current = {
    abrirCobro, cobroOpen, modalAbierto: modalCaja !== null || modalNuevoCliente || hojaOpciones || pedirComprador || bandejaMesas || bandejaPedidos || !!hojaMods, cart, q, inputRef,
    updateCant, removeFromCart, setCobroOpen, setQ, setClienteOpen,
  };

  // El aviso de "venta registrada" se va solo (con vuelto queda más tiempo, para leerlo).
  useEffect(() => {
    if (!ventaOk) return;
    const t = setTimeout(() => setVentaOk(null), ventaOk.vuelto > 0 ? 12000 : 6000);
    return () => clearTimeout(t);
  }, [ventaOk]);

  // ── Render ─────────────────────────────────────────────────────────────────
  // Cliente, condición y documento: en escritorio una fila arriba; en celular / tablet, en una hoja.
  const ayudaDocumento = tipoDocumento === "ticket"
    ? "Registra la venta e imprime un ticket. No toca SIFEN."
    : cfgFact?.modo === "sifen"
      ? "Crea la factura en Neura (Facturas): desde ahí se emite a SIFEN como siempre."
    : cfgFact?.modo === "autoimpresor"
      ? "Factura impresa (autoimpresor): al confirmar toma el próximo número del timbrado."
      : cfgFact?.modo === "sin_factura_fiscal"
        ? "La empresa está en modo sin factura fiscal (Configuración › Facturación): se imprime el ticket."
        : "Factura electrónica (SIFEN) — por ahora inactivo: se imprime el ticket.";
  const datosVenta = (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-3 lg:gap-3">
      {/* Cliente */}
      <div ref={clienteContainerRef} className="relative">
        <label className="mb-1.5 block text-sm font-medium text-slate-700 lg:mb-1 lg:text-xs">
          Cliente {clienteObligatorio ? <span className="text-rose-600">*</span> : <span className="font-normal text-slate-400">(opcional para ticket)</span>}
        </label>
        <div className="flex gap-2">
          <input
            type="text"
            value={ocasional ? `Cliente ocasional — ${nombreOcasional}` : clienteSel ? clienteSel.nombre : clienteQuery}
            onChange={(e) => { if (ocasional) return; setClienteId(""); setClienteQuery(e.target.value); setClienteOpen(true); }}
            onFocus={() => { if (!ocasional) setClienteOpen(true); }}
            onKeyDown={onKeyDownCliente}
            role="combobox"
            aria-expanded={clienteOpen && !clienteSel && !ocasional}
            aria-controls="caja-clientes"
            aria-activedescendant={clienteOpen && !clienteSel && !ocasional ? `caja-cli-${clienteMarcado}` : undefined}
            readOnly={ocasional}
            placeholder="Buscar por nombre o RUC…"
            autoComplete="off"
            enterKeyHint="search"
            className={`min-h-11 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:ring-2 lg:min-h-0 lg:py-1.5 ${clienteSel || ocasional ? "font-medium" : ""} ${ocasional ? "bg-slate-50" : ""}`}
            style={{ ["--tw-ring-color" as string]: TEAL }}
          />
          {clienteSel || ocasional ? (
            <button type="button" onClick={() => { setClienteId(""); setClienteQuery(""); setOcasional(false); }} className="min-h-11 shrink-0 rounded-lg border border-slate-200 px-3 text-xs text-slate-500 hover:bg-slate-50 lg:min-h-0">
              Quitar
            </button>
          ) : null}
        </div>
        {/* Cliente elegido: RUC (o documento) y teléfono, para confirmar que es el correcto. */}
        {clienteSel ? (
          <p className="mt-1.5 flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-slate-500">
            <span>CI o RUC <b className="font-mono font-semibold text-slate-700">{rucFactura || (rucEstado.estado === "invalido" ? rucEstado.ruc : clienteSel.documento) || "—"}</b></span>
            <span>Tel. <b className="font-semibold text-slate-700">{clienteSel.telefono || "—"}</b></span>
          </p>
        ) : ocasional ? (
          <p className="mt-1.5 flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-slate-500">
            <span>En la factura: <b className="font-semibold text-slate-700">{nombreOcasional}</b></span>
            <span>RUC <b className="font-mono font-semibold text-slate-700">{rucOcasional}</b></span>
            <span>Solo contado</span>
          </p>
        ) : null}
        {clienteOpen && !clienteSel && !ocasional && (
          <div id="caja-clientes" role="listbox" aria-label="Clientes" className="absolute z-20 mt-1 max-h-64 w-full overflow-auto overscroll-contain rounded-lg border border-slate-200 bg-white shadow-xl ring-1 ring-black/5">
            {clienteQuery.trim() && clientesFiltrados.length === 0 ? (
              <p className="border-b border-slate-100 px-3 py-2 text-xs text-slate-400">{clientesBuscados ? "Sin clientes que coincidan." : "Buscando…"}</p>
            ) : null}
            {opcionesCliente.map((o, i) => {
              const marcado = i === clienteMarcado;
              const base = `${marcado ? "bg-slate-100" : "hover:bg-slate-50"}`;
              if (o.tipo === "ocasional") {
                return (
                  <button key="ocasional" id={`caja-cli-${i}`} role="option" aria-selected={marcado} type="button" onMouseEnter={() => setClienteMarcado(i)} onClick={() => elegirOpcionCliente(o)}
                    className={`flex min-h-11 w-full flex-col items-start border-slate-100 px-3 py-2 text-left lg:min-h-0 ${clienteQuery.trim() ? "border-t" : "border-b"} ${base}`}>
                    <span className="text-sm font-semibold text-slate-800">Cliente ocasional ({nombreOcasional})</span>
                    <span className="text-[11px] text-slate-500">Consumidor final que no da sus datos · se puede facturar · solo contado</span>
                  </button>
                );
              }
              if (o.tipo === "nuevo") {
                return (
                  <button key="nuevo" id={`caja-cli-${i}`} role="option" aria-selected={marcado} type="button" onMouseEnter={() => setClienteMarcado(i)} onClick={() => elegirOpcionCliente(o)}
                    className={`flex min-h-11 w-full items-center gap-1.5 border-slate-100 px-3 py-2 text-left text-xs font-semibold lg:min-h-0 ${clienteQuery.trim() ? "border-t" : "border-b"} ${marcado ? "brightness-95" : "hover:brightness-95"}`}
                    style={{ color: TEAL, backgroundColor: marcado ? `${TEAL}1f` : `${TEAL}0f` }}>
                    <span className="text-base leading-none">＋</span> Cargar nuevo cliente
                    {clienteQuery.trim() && <span className="ml-1 truncate text-slate-500">«{clienteQuery.trim()}»</span>}
                  </button>
                );
              }
              const c = o.c;
              return (
                <button key={c.id} id={`caja-cli-${i}`} role="option" aria-selected={marcado} type="button" onMouseEnter={() => setClienteMarcado(i)} onClick={() => elegirOpcionCliente(o)}
                  className={`block min-h-11 w-full px-3 py-2 text-left text-sm lg:min-h-0 ${base}`}>
                  <span className="font-medium text-slate-800">{c.nombre}</span>
                  {c.ruc && <span className="ml-2 text-xs text-slate-400">RUC {c.ruc}</span>}
                  {c.documento && !c.ruc && <span className="ml-2 text-xs text-slate-400">{c.documento}</span>}
                  {c.telefono && <span className="ml-2 text-xs text-slate-400">· {c.telefono}</span>}
                </button>
              );
            })}
            {!clienteQuery.trim() && clientesFiltrados.length === 0 ? (
              <p className="px-3 py-2 text-xs text-slate-400">Sin clientes que coincidan.</p>
            ) : null}
          </div>
        )}
      </div>

      {/* Condición */}
      <div>
        <label className="mb-1.5 block text-sm font-medium text-slate-700 lg:mb-1 lg:text-xs">Condición</label>
        <Segmented value={tipoVenta} onChange={(v) => { setTipoVenta(v); if (v === "CONTADO") setPlazoDias(""); else if (!plazoDias) setPlazoDias(plazoSugerido(clienteSel)); }} options={[{ value: "CONTADO", label: "Contado" }, {
          value: "CREDITO", label: "Crédito", disabled: (!!me && !puedeCredito) || ocasional,
          title: ocasional ? "El cliente ocasional es solo al contado: para vender a crédito elegí un cliente" : "Tu perfil no permite vender a crédito",
        }]} />
        {ocasional ? (
          <p className="mt-1 text-[11px] text-slate-500">Cliente ocasional: solo contado. Para vender a crédito elegí un cliente.</p>
        ) : null}
        {tipoVenta === "CREDITO" && (
          <CamposCredito total={total} cuotas={cuotas} setCuotas={setCuotas} plazoDias={plazoDias} setPlazoDias={setPlazoDias}
            cada={cuotasCada} setCada={setCuotasCada} monto={formatGs}
            entrega={cuentaMesa || pedido ? undefined : { planId, setPlanId, monto: entrega, setMonto: setEntrega, medio: medioEntrega, setMedio: setMedioEntrega, referencia: refEntrega, setReferencia: setRefEntrega }} />
        )}
      </div>

      {/* Documento */}
      <div>
        <label className="mb-1.5 flex items-center gap-1 text-sm font-medium text-slate-700 lg:mb-1 lg:text-xs">
          Documento
          <span className="hidden cursor-help text-slate-400 lg:inline-flex" title={ayudaDocumento} aria-label={ayudaDocumento}><Info className="h-3.5 w-3.5" /></span>
        </label>
        <Segmented value={tipoDocumento} onChange={setTipoDocumento} options={[
          {
            value: "factura", label: "Factura", disabled: !puedeFacturar,
            title: superaTopeOcasional ? "La venta supera el tope para facturar a cliente ocasional" : clienteSel ? avisoRuc : "Para emitir factura elegí un cliente con RUC o Cliente ocasional (X)",
          },
          { value: "ticket", label: "Solo ticket" },
        ]} />
        {!puedeFacturar ? (
          superaTopeOcasional ? (
            <p className="mt-1.5 rounded-lg border border-amber-200 bg-amber-50 px-2.5 py-2 text-[11px] text-amber-800">
              La venta supera el tope para facturar a cliente ocasional ({formatGs(topeOcasional ?? 0)}): solo ticket. Para facturar elegí un cliente con RUC.
            </p>
          ) : clienteSel ? (
            <div className="mt-1.5 rounded-lg border border-amber-200 bg-amber-50 px-2.5 py-2 text-[11px] text-amber-800">
              <p>{avisoRuc}</p>
              <p className="mt-1 flex flex-wrap gap-x-3 gap-y-1">
                <a href={`/clientes/${encodeURIComponent(clienteSel.id)}`} target="_blank" rel="noopener noreferrer"
                  className="inline-flex min-h-11 items-center font-semibold text-amber-900 underline underline-offset-2 lg:min-h-0">
                  Editar cliente
                </a>
                <button type="button" onClick={() => recargarCliente(clienteSel.id)}
                  className="inline-flex min-h-11 items-center font-semibold text-amber-900 underline underline-offset-2 lg:min-h-0">
                  Ya lo cargué
                </button>
                {tipoVenta === "CONTADO" ? (
                  <button type="button" onClick={() => elegirOcasional(true)}
                    className="inline-flex min-h-11 items-center font-semibold text-amber-900 underline underline-offset-2 lg:min-h-0">
                    Facturar como cliente ocasional ({nombreOcasional})
                  </button>
                ) : null}
              </p>
            </div>
          ) : (
            <div className="mt-1 text-[11px] text-slate-500" title="Para emitir factura elegí un cliente con RUC. Sin cliente, solo ticket.">
              {/* Escritorio: la explicación va en el tooltip (deja más alto para el carrito). */}
              <p className="lg:hidden">Para emitir factura elegí un cliente con RUC. Sin cliente, solo ticket.</p>
              {tipoVenta === "CONTADO" ? (
                <button type="button" onClick={() => elegirOcasional(true)}
                  className="inline-flex min-h-11 items-center font-semibold underline underline-offset-2 lg:min-h-0" style={{ color: TEAL }}>
                  Facturar como cliente ocasional ({nombreOcasional})
                </button>
              ) : null}
            </div>
          )
        ) : null}
        {/* Escritorio: el detalle del documento va en el ícono (i) del título, no en un renglón. */}
        <p className="mt-1 text-[11px] text-slate-500 lg:hidden">{ayudaDocumento}</p>
      </div>
    </div>
  );
  const faltaCliente = clienteObligatorio && !clienteId;
  const bloqueado = cart.length === 0 || haySinStock;

  return (
    <div
      className="flex flex-col gap-3 max-lg:pb-24 lg:h-[calc(100vh-7rem)] lg:min-h-0"
      // Celular: con un campo enfocado (teclado abierto) se esconde el pie fijo de "Cobrar".
      onFocusCapture={(e) => { if ((e.target as HTMLElement).tagName === "INPUT") setEscribiendo(true); }}
      onBlurCapture={(e) => { if ((e.target as HTMLElement).tagName === "INPUT") setEscribiendo(false); }}
    >
      {/* Header compacto: todo en una línea para no gastar alto vertical. En escritorio ancho
          (xl) la barra de la caja va en la misma fila, entre el título y los accesos. */}
      <div className="flex shrink-0 flex-col gap-3 xl:flex-row xl:items-center">
      <div className="flex shrink-0 items-center justify-between gap-3 sm:gap-4 xl:contents">
        <div className="flex min-w-0 items-center gap-1.5 xl:order-1 xl:shrink-0">
          {/* Volver al panel de Caja: discreto, en la misma línea (no le quita alto al POS). */}
          <Link href="/caja/panel" aria-label="Volver a Caja" title="Volver a Caja"
            className="-ml-1.5 inline-flex h-11 w-10 shrink-0 items-center justify-center rounded-lg text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700 lg:h-8 lg:w-8">
            <ArrowLeft className="h-4 w-4" />
          </Link>
          <h1 className="text-lg font-semibold tracking-tight text-slate-900">Caja</h1>
          <span className="hidden text-xs text-slate-400 sm:inline xl:hidden">· Escaneá y cobrá directo</span>
        </div>
        <div className="flex shrink-0 items-center gap-2 xl:order-3">
          <Link href="/caja/turnos" className="inline-flex min-h-11 items-center rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 lg:min-h-0">
            <span className="sm:hidden">Turnos</span><span className="hidden sm:inline">Apertura y cierre</span>
          </Link>
          <Link href="/caja" className="inline-flex min-h-11 items-center rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 lg:min-h-0">
            <span className="sm:hidden">Órdenes</span><span className="hidden sm:inline">Órdenes de venta</span> →
          </Link>
        </div>
      </div>

      {/* Caja en la que se vende: sin caja abierta no se puede cobrar. */}
      <div className="shrink-0 xl:order-2 xl:min-w-0 xl:flex-1">
        <CajaBarra estado={estadoCajas} caja={caja} onElegir={elegirCaja}
          onAbrir={() => setModalCaja("abrir")} onMov={() => setModalCaja("mov")}
          onVer={() => setModalCaja("ver")} onCerrar={() => setModalCaja("cerrar")} />
      </div>
      </div>

      {/* Turno abierto hace más de 24 h: se puede seguir vendiendo, pero el arqueo mezcla días. */}

      {/* Venta registrada: aviso FLOTANTE (no empuja el contenido: al irse no se corre nada y el
          click no cae en otro lado). En celular / tablet va sobre el pie fijo; en escritorio,
          arriba al centro, sobre la barra superior (no tapa el carrito ni el buscador). */}
      {ventaOk && (
        <div role="status" className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-2 text-sm font-medium text-emerald-800 shadow-xl fixed z-40 lg:top-3 lg:left-1/2 lg:z-50 lg:w-max lg:max-w-[min(40rem,calc(100vw-2rem))] lg:-translate-x-1/2 max-lg:inset-x-3 max-lg:bottom-[calc(env(safe-area-inset-bottom)+5.75rem)] max-lg:py-3 max-lg:pr-1.5 max-lg:shadow-xl sm:max-lg:mx-auto sm:max-lg:max-w-xl"
          style={{ animation: "fade-in 0.2s ease-out" }}>
          <CheckCircle2 className="h-5 w-5 shrink-0" />
          <span className="min-w-0 flex-1 lg:flex-none">Venta <strong>{ventaOk.numero}</strong> registrada.{ventaOk.impreso ? " Ticket enviado a imprimir." : null}</span>
          {/* Neura: no hay ticket impreso; la factura se emite a SIFEN desde Facturas. */}
          {ventaOk.factura_id ? (
            <a href={`/facturas/${ventaOk.factura_id}`} target="_blank" rel="noreferrer" className="inline-flex min-h-11 items-center gap-1.5 rounded-lg bg-white px-3 py-1 text-sm font-semibold text-emerald-700 ring-1 ring-emerald-200 hover:bg-emerald-100 lg:min-h-0"><Receipt className="h-4 w-4" /> Emitir factura {ventaOk.numero_factura}</a>
          ) : null}
          {ventaOk.vuelto > 0 ? (
            <span className="rounded-lg bg-white px-3 py-1 text-base font-extrabold tabular-nums text-emerald-700 ring-1 ring-emerald-200 max-lg:order-last max-lg:w-full max-lg:text-center max-lg:text-xl">Vuelto {formatGs(ventaOk.vuelto)}</span>
          ) : null}
          {ventaPresu ? <span className="font-normal max-lg:order-last">{ventaPresu}</span> : null}
          <button type="button" onClick={() => setVentaOk(null)} aria-label="Cerrar aviso" className="ml-auto inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-emerald-500 hover:text-emerald-800 lg:h-auto lg:w-auto"><X className="h-4 w-4" /></button>
        </div>
      )}

      {/* Venta desde un presupuesto: qué se cargó y qué revisar antes de cobrar. */}
      {presu ? (
        "error" in presu ? (
          <div className="flex shrink-0 items-center justify-between gap-3 rounded-xl border border-rose-200 bg-rose-50 px-4 py-2 text-sm text-rose-800">
            <span>{presu.error}</span>
            <button type="button" onClick={desvincularPresupuesto} aria-label="Cerrar" className="inline-flex h-11 w-11 shrink-0 items-center justify-center text-rose-400 hover:text-rose-700 lg:h-auto lg:w-auto"><X className="h-4 w-4" /></button>
          </div>
        ) : (
          <div className="shrink-0 space-y-1 rounded-xl border px-4 py-2.5 text-sm" style={{ borderColor: `${TEAL}55`, backgroundColor: `${TEAL}10` }}>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="flex items-center gap-2 text-slate-800">
                <FileSignature className="h-4 w-4 shrink-0" style={{ color: TEAL }} />
                {presuActivo
                  ? <span>Venta del presupuesto <Link href={`/presupuestos/${presu.id}`} className="font-mono font-semibold hover:underline">{presu.etiqueta}</Link>: al cobrar queda como <b>convertido</b>.</span>
                  : <span>Sacaste todas las líneas del presupuesto <b className="font-mono">{presu.etiqueta}</b>: esta venta no se va a ligar a él.</span>}
              </p>
              <button type="button" onClick={desvincularPresupuesto} className="min-h-11 rounded-lg px-2 py-1 text-xs font-semibold text-slate-500 hover:bg-white/70 hover:text-slate-800 lg:min-h-0">Desvincular</button>
            </div>
            {presu.prospecto ? <p className="text-xs text-amber-800">Es para un prospecto: {presu.prospecto}. Elegí o cargá el cliente si vas a facturar o vender a crédito.</p> : null}
            {presu.a.enDolares ? <p className="text-xs text-slate-600">Estaba en dólares: los precios se pasaron a guaraníes con la cotización del presupuesto.</p> : null}
            {presu.a.cambiosPrecio.length ? (
              <p className="text-xs text-amber-800">
                Cambió el precio de lista desde que se cotizó: {presu.a.cambiosPrecio.map((c) => `${c.nombre} (cotizado ${formatGs(c.cotizado)}, hoy ${formatGs(c.hoy)})`).join(" · ")}. Se cobra lo cotizado.{" "}
                <button type="button" onClick={usarPreciosDeHoy} className="font-semibold underline underline-offset-2 hover:text-amber-950">Usar precios de hoy</button>
              </p>
            ) : null}
            {presu.a.libres.length || presu.a.inactivos.length ? (
              <p className="text-xs text-rose-700">
                No se cargaron (no son productos vendibles del catálogo): {[...presu.a.libres.map((l) => l.descripcion), ...presu.a.inactivos.map((x) => x.nombre)].join(", ")}.
              </p>
            ) : null}
          </div>
        )
      ) : null}

      {/* Mesas por cobrar (receta 69): bandeja + la cuenta cargada en el carrito. */}
      {caja && (porCobrar.length > 0 || cuentaMesa) ? (
        <div className={`grid shrink-0 gap-2 ${cuentaMesa && porCobrar.length > 0 ? "md:grid-cols-2" : ""}`}>
          {porCobrar.length > 0 ? (
            <button type="button" onClick={() => { setErrorMesa(null); setBandejaMesas(true); }}
              className="flex min-h-12 w-full items-center gap-3 rounded-xl border border-sky-200 bg-sky-50 px-3 py-2 text-left transition hover:bg-sky-100 active:scale-[0.99] lg:min-h-0 lg:py-1.5">
              <span className="relative grid h-9 w-9 shrink-0 place-items-center rounded-full bg-white text-sky-700 ring-1 ring-sky-200 lg:h-7 lg:w-7">
                <Receipt className="h-4 w-4" aria-hidden />
                <span className="absolute -top-1 -right-1 grid h-5 min-w-5 place-items-center rounded-full bg-sky-600 px-1 text-[11px] font-bold text-white tabular-nums">{porCobrar.length}</span>
              </span>
              <span className="min-w-0 flex-1 lg:flex lg:items-baseline lg:gap-2">
                <span className="block shrink-0 text-sm font-semibold text-sky-900">Mesas por cobrar ({porCobrar.length})</span>
                <span className="block min-w-0 truncate text-xs text-sky-800/80">{porCobrar.map((c) => c.mesa.nombre).join(" · ")}</span>
              </span>
              <span className="inline-flex shrink-0 items-center gap-0.5 text-xs font-semibold text-sky-800">Ver <ChevronRight className="h-4 w-4" aria-hidden /></span>
            </button>
          ) : null}
          {cuentaMesa ? (
            <div className="space-y-1.5 rounded-xl border px-3 py-2 text-sm" style={{ borderColor: `${TEAL}55`, backgroundColor: `${TEAL}10` }}>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="flex min-w-0 items-center gap-2 text-slate-800">
                  <Receipt className="h-4 w-4 shrink-0" style={{ color: TEAL }} aria-hidden />
                  <span className="min-w-0">
                    {parteMesa
                      ? <>Cuenta de <b>{origenPedido(cuentaMesa)}</b> · {parteMesa.id === "resto" ? <>lo <b>sin asignar</b></> : <>parte de <b>{parteMesa.nombre}</b></>} · <span className="whitespace-nowrap tabular-nums">{formatGs(parteMesa.total)}</span></>
                      : <>Cuenta de <b>{origenPedido(cuentaMesa)}</b> · <span className="whitespace-nowrap tabular-nums">{formatGs(cuentaMesa.total)}</span></>}
                  </span>
                </p>
                <button type="button" onClick={soltarCuentaMesa} className="min-h-11 rounded-lg px-2 py-1 text-xs font-semibold text-slate-500 hover:bg-white/70 hover:text-slate-800 lg:min-h-0">Soltar cuenta</button>
              </div>
              <p className="text-[11px] text-slate-500">
                {parteMesa
                  ? "Lo de esta parte no se puede quitar ni bajar; podés agregar otros productos. Al cobrar, la parte queda pagada (la cuenta se cierra con la última)."
                  : "Lo que pidió la mesa no se puede quitar ni bajar; podés agregar otros productos. Al cobrar, la cuenta queda cerrada."}
              </p>
              {factPropuesta ? (
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-lg border border-sky-200 bg-sky-50 px-2.5 py-2 text-xs text-sky-900">
                  <span className="min-w-0 flex-1">La mesa pidió factura a <b>{factPropuesta.razon_social}</b> · RUC <b>{factPropuesta.ruc}</b>{factPropuesta.email ? ` · ${factPropuesta.email}` : ""}. No es cliente todavía.</span>
                  <span className="flex shrink-0 gap-1.5">
                    <button type="button" onClick={() => void crearClientePropuesto()} disabled={creandoCliente}
                      className="inline-flex min-h-11 items-center gap-1 rounded-lg px-3 font-semibold text-white disabled:opacity-50 lg:min-h-8" style={{ backgroundColor: TEAL }}>
                      {creandoCliente ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : <UserRoundPlus className="h-3.5 w-3.5" aria-hidden />} Crear cliente y facturar
                    </button>
                    <button type="button" onClick={() => setFactPropuesta(null)} className="min-h-11 rounded-lg px-2 font-semibold text-sky-800 hover:bg-white/70 lg:min-h-8">Ticket</button>
                  </span>
                </div>
              ) : null}
              {cuentaMesaCambio && cuentaMesaAhora ? (
                <p className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-lg bg-amber-50 px-2.5 py-1.5 text-xs font-medium text-amber-900" role="status">
                  La cuenta cambió (ahora {formatGs(cuentaMesaAhora.total)}).
                  <button type="button" onClick={() => cargarCuentaMesa(cuentaMesaAhora, parteMesa?.id)} className="inline-flex min-h-11 items-center gap-1 font-semibold underline underline-offset-2 lg:min-h-0">
                    <RotateCw className="h-3.5 w-3.5" aria-hidden /> Recargar
                  </button>
                </p>
              ) : null}
              {cuentaMesaSeFue ? (
                <p className="rounded-lg bg-rose-50 px-2.5 py-1.5 text-xs font-medium text-rose-700" role="alert">
                  Esta cuenta ya no está en caja (la cobraron o la volvieron a abrir). Soltala para seguir.
                </p>
              ) : null}
              {cuentaMesaAhora && cuentaMesaAhora.pendientes > 0 ? (
                <p className="rounded-lg bg-amber-50 px-2.5 py-1.5 text-xs text-amber-900">La mesa tiene un pedido nuevo sin atender: aceptalo o rechazalo en Pedidos de mesas antes de cobrar.</p>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}
      {errorMesa && !bandejaMesas ? <p className="shrink-0 rounded-xl bg-rose-50 px-3 py-2 text-sm text-rose-700" role="alert">{errorMesa}</p> : null}

      {/* Pedidos por cobrar (receta 77): bandeja + el pedido cargado en el carrito. */}
      {caja && (pedidosPorCobrar.length > 0 || pedido) ? (
        <div className={`grid shrink-0 gap-2 ${pedido && pedidosPorCobrar.length > 0 ? "md:grid-cols-2" : ""}`}>
          {pedidosPorCobrar.length > 0 ? (
            <button type="button" onClick={() => { setErrorPedido(null); setBandejaPedidos(true); }}
              className="flex min-h-12 w-full items-center gap-3 rounded-xl border border-violet-200 bg-violet-50 px-3 py-2 text-left transition hover:bg-violet-100 active:scale-[0.99] lg:min-h-0 lg:py-1.5">
              <span className="relative grid h-9 w-9 shrink-0 place-items-center rounded-full bg-white text-violet-700 ring-1 ring-violet-200 lg:h-7 lg:w-7">
                <ClipboardList className="h-4 w-4" aria-hidden />
                <span className="absolute -top-1 -right-1 grid h-5 min-w-5 place-items-center rounded-full bg-violet-600 px-1 text-[11px] font-bold text-white tabular-nums">{pedidosPorCobrar.length}</span>
              </span>
              <span className="min-w-0 flex-1 lg:flex lg:items-baseline lg:gap-2">
                <span className="block shrink-0 text-sm font-semibold text-violet-900">Pedidos por cobrar ({pedidosPorCobrar.length})</span>
                <span className="block min-w-0 truncate text-xs text-violet-800/80">{pedidosPorCobrar.map((x) => x.etiqueta).join(" · ")}</span>
              </span>
              <span className="inline-flex shrink-0 items-center gap-0.5 text-xs font-semibold text-violet-800">Ver <ChevronRight className="h-4 w-4" aria-hidden /></span>
            </button>
          ) : null}
          {pedido ? (
            <div className="space-y-1.5 rounded-xl border px-3 py-2 text-sm" style={{ borderColor: `${TEAL}55`, backgroundColor: `${TEAL}10` }}>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-slate-800">
                  <ClipboardList className="h-4 w-4 shrink-0" style={{ color: TEAL }} aria-hidden />
                  <span className="min-w-0">
                    Pedido <b className="font-mono">{pedido.etiqueta}</b>
                    {pedido.vendedor ? <> · vendedor {pedido.vendedor}</> : null}
                    {pedido.cliente ? <> · cliente <b>{pedido.cliente.nombre}</b></> : null}
                    {" · "}<span className="whitespace-nowrap tabular-nums">{formatGs(pedido.total)}</span>
                  </span>
                  {pedidoModificado ? <span className="rounded-full border border-amber-300 bg-amber-50 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-amber-800">Modificado en caja</span> : null}
                </p>
                <button type="button" onClick={soltarPedido} className="min-h-11 rounded-lg px-2 py-1 text-xs font-semibold text-slate-500 hover:bg-white/70 hover:text-slate-800 lg:min-h-0">Soltar pedido</button>
              </div>
              {pedido.nota ? <p className="text-xs text-slate-600">Nota: {pedido.nota}</p> : null}
              {pedidoCambio && pedidoAhora ? (
                <p className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-lg bg-amber-50 px-2.5 py-1.5 text-xs font-medium text-amber-900" role="status">
                  El pedido cambió (ahora {formatGs(pedidoAhora.total)}): recargalo.
                  <button type="button" onClick={() => cargarPedido(pedidoAhora)} className="inline-flex min-h-11 items-center gap-1 font-semibold underline underline-offset-2 lg:min-h-0">
                    <RotateCw className="h-3.5 w-3.5" aria-hidden /> Recargar
                  </button>
                </p>
              ) : null}
              {pedidoSeFue ? (
                <p className="rounded-lg bg-rose-50 px-2.5 py-1.5 text-xs font-medium text-rose-700" role="alert">
                  Este pedido ya no está en caja (lo cobraron, lo anularon o venció). Soltalo para seguir.
                </p>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}
      {(errorPedido || buscandoPedido) && !bandejaPedidos ? (
        <p className={`flex shrink-0 items-center justify-between gap-2 rounded-xl px-3 py-2 text-sm ${errorPedido ? "bg-rose-50 text-rose-700" : "bg-slate-50 text-slate-600"}`} role={errorPedido ? "alert" : "status"}>
          <span>{errorPedido ?? "Buscando el pedido…"}</span>
          {errorPedido ? <button type="button" onClick={() => setErrorPedido(null)} aria-label="Cerrar aviso" className="inline-flex h-11 w-11 shrink-0 items-center justify-center text-rose-400 hover:text-rose-700 lg:h-auto lg:w-auto"><X className="h-4 w-4" /></button> : null}
        </p>
      ) : null}

      {!caja ? (
        <div className="flex flex-1 items-center justify-center rounded-2xl border border-dashed border-slate-300 bg-white p-10 text-center text-sm text-slate-500 shadow-sm max-lg:min-h-[40vh]">
          {estadoCajas ? (estadoCajas.abiertas.length > 1 ? "Elegí arriba la caja en la que vas a vender." : "Abrí la caja para empezar a cobrar.") : "Cargando la caja…"}
        </div>
      ) : (
      <>
      {/* Datos de la venta — compacto, una fila (escritorio). En celular / tablet van en una hoja. */}
      {esEscritorio ? (
        <div className="shrink-0 rounded-xl border border-slate-200 bg-white px-4 py-2.5 shadow-sm">{datosVenta}</div>
      ) : null}

      {/* Split POS (escritorio); una columna en celular / tablet */}
      <div className="grid min-h-0 flex-1 gap-4 lg:grid-cols-[1fr_340px] xl:grid-cols-[1fr_440px]">
        {/* IZQUIERDA: buscador + carrito */}
        <div className="flex min-h-0 flex-col rounded-2xl border border-slate-200 bg-white shadow-sm">
          {/* Celular / tablet: el buscador queda fijo arriba al bajar por el carrito. */}
          <div className="border-b border-slate-100 p-3 max-lg:sticky max-lg:-top-4 max-lg:z-20 sm:max-lg:-top-5 max-lg:rounded-t-2xl max-lg:bg-white sm:p-4">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-slate-400" />
              <input
                ref={inputRef}
                type="search"
                value={q}
                onChange={(e) => { setQ(e.target.value); setHitsHighlight(-1); }}
                onKeyDown={onKeyDownBuscar}
                placeholder={esEscritorio ? "Escaneá el código o buscá por nombre/SKU…" : "Escaneá o buscá producto…"}
                className="w-full rounded-xl border border-slate-200 bg-slate-50 py-3 pl-10 pr-4 text-base outline-none focus:bg-white focus:ring-2 [&::-webkit-search-cancel-button]:hidden"
                style={{ ["--tw-ring-color" as string]: `${TEAL}55` }}
                autoComplete="off"
                autoCorrect="off"
                autoCapitalize="off"
                spellCheck={false}
                enterKeyHint="search"
                aria-label="Buscar o escanear producto"
              />
              {q ? (
                <button type="button" onClick={() => { setQ(""); setHitsHighlight(-1); enfocarBuscador(true); }} aria-label="Limpiar búsqueda"
                  className="absolute right-1 top-1/2 inline-flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-lg text-slate-400 hover:text-slate-700">
                  <X className="h-4 w-4" />
                </button>
              ) : null}
            </div>
            {hits.length > 0 && (
              <ul className="mt-2 max-h-56 divide-y divide-slate-100 overflow-auto overscroll-contain rounded-xl border border-slate-200 bg-white shadow-inner max-lg:max-h-[min(20rem,45dvh)]">
                {hits.map((p, i) => (
                  <li key={p.id} onClick={() => addToCart(p)} onMouseEnter={() => setHitsHighlight(i)}
                    className="flex cursor-pointer items-center gap-3 px-3 py-2 text-sm active:bg-slate-50" style={i === hitsHighlight ? { backgroundColor: `${TEAL}26` } : undefined}>
                    <ProdThumb url={p.imagen_url} nombre={p.nombre} className="h-10 w-10" />
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-medium text-slate-900">{p.nombre}</p>
                      <p className="truncate font-mono text-[11px] text-slate-500">{p.sku}</p>
                    </div>
                    <div className="shrink-0 text-right">
                      <p className={`text-[11px] font-medium ${p.controla_stock && p.stock_actual <= 0 ? "text-rose-600" : "text-emerald-700"}`}>
                        {p.sin_receta ? "Sin receta" : p.controla_stock ? (p.stock_actual <= 0 ? "Sin stock" : p.tipo_producto === "menu" ? `${p.stock_actual} porc.` : `${p.stock_actual} u`) : "—"}
                      </p>
                      <p className="text-sm font-semibold tabular-nums text-slate-900">{formatGs(p.precio_venta)}</p>
                    </div>
                  </li>
                ))}
              </ul>
            )}
            {q.trim().length >= 2 && qDiferida === q && hits.length === 0 && (
              <div className="mt-2 rounded-xl border border-amber-200 bg-amber-50/70 p-3 text-sm">
                <p className="font-medium text-amber-900">Ningún producto con «{q.trim()}».</p>
              </div>
            )}

            {/* Guía de atajos: operar la caja sin mouse (solo escritorio). */}
            <div className="mt-2.5 hidden flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-slate-400 lg:flex">
              <span className="font-semibold uppercase tracking-wider text-slate-400">Teclado</span>
              <Atajo k="Enter" t="agregar" />
              <Atajo k="Espacio" t="cobrar" />
              <Atajo k="+ / −" t="cantidad" />
              <Atajo k="Supr" t="quitar" />
              <Atajo k="Esc" t="limpiar" />
            </div>
          </div>

          {/* Celular / tablet: cliente, condición y documento → hoja inferior. */}
          {!esEscritorio ? (
            <button type="button" onClick={() => setHojaOpciones(true)}
              className={`flex min-h-14 items-center gap-3 border-b px-3 py-2 text-left transition active:bg-slate-50 sm:px-4 ${faltaCliente && cobroError ? "border-rose-200 bg-rose-50/70" : "border-slate-100"}`}>
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full" style={{ backgroundColor: `${TEAL}14`, color: TEAL }}>
                <UserRound className="h-4 w-4" />
              </span>
              <span className="min-w-0 flex-1">
                <span className={`block truncate text-sm font-semibold ${faltaCliente ? "text-rose-700" : "text-slate-900"}`}>
                  {clienteSel ? clienteSel.nombre : ocasional ? `Cliente ocasional — ${nombreOcasional}` : faltaCliente ? "Elegí el cliente *" : "Sin cliente (consumidor final)"}
                </span>
                <span className="block truncate text-xs text-slate-500">
                  {tipoVenta === "CREDITO" ? (plazoDiasNum > 0 ? textoCredito(plazoDiasNum, cuotasNum, cuotasCada) : "Crédito · sin plazo") : "Contado"} · {tipoDocumento === "factura" ? "Factura" : "Solo ticket"}
                </span>
              </span>
              <span className="inline-flex shrink-0 items-center gap-0.5 text-xs font-semibold" style={{ color: TEAL }}>
                Cambiar <ChevronRight className="h-4 w-4" />
              </span>
            </button>
          ) : null}

          {/* Ítems cargados */}
          <div className="flex items-baseline justify-between border-t border-slate-100 bg-slate-50/60 px-3 py-2 sm:px-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-600">
              Ítems cargados: <span className="text-base font-bold tabular-nums" style={{ color: TEAL }}>{cart.length}</span>
            </p>
            {cart.length > 0 && <p className="text-[11px] tabular-nums text-slate-500">{cantTotal === 1 ? "1 unidad en total" : `${cantTxt(cantTotal)} unidades en total`}</p>}
          </div>

          {/* Carrito */}
          <div className="flex-1 overflow-auto p-2.5 sm:p-4">
            {haySinStock && (
              <div className="mb-3 rounded-xl border border-rose-300 bg-rose-50 p-3">
                <p className="text-sm font-semibold text-rose-800">❌ No podés cobrar — hay productos sin stock suficiente</p>
                <ul className="mt-2 space-y-1 text-xs text-rose-900">
                  {sinStock.map((l) => (
                    <li key={l.cart_line_id} className="tabular-nums">
                      <strong>{l.producto.nombre}</strong> ·{" "}
                      {l.producto.sin_receta
                        ? "No tiene receta: cargala en Inventario › Recetas para poder venderlo"
                        : l.producto.tipo_producto === "menu"
                          ? `Alcanzan los ingredientes para ${l.producto.stock_actual} / Solicitado: ${l.cantidad}`
                          : `Disponible: ${l.producto.stock_actual} / Solicitado: ${l.cantidad}`}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {conVencidos.length > 0 && (
              <div className="mb-3 rounded-xl border border-amber-300 bg-amber-50 p-3">
                <p className="text-sm font-semibold text-amber-800">⚠ Hay unidades de lotes vencidos</p>
                <ul className="mt-1 space-y-0.5 text-xs text-amber-900">
                  {conVencidos.map((v) => (
                    <li key={v.id} className="tabular-nums">
                      <strong>{v.nombre}</strong> · {v.vigente > 0 ? `sin vencer quedan ${v.vigente}` : "solo queda stock vencido"} / Solicitado: {v.pedido}
                    </li>
                  ))}
                </ul>
                <p className="mt-1 text-[11px] text-amber-800">Revisá la fecha antes de entregar. Podés cobrar igual.</p>
              </div>
            )}
            {cart.length === 0 ? (
              <div className="flex h-full flex-col items-center justify-center gap-2 py-10 text-sm text-slate-400 lg:py-0">
                <Package className="h-8 w-8 text-slate-300" />
                <p>Todavía no cargaste productos.</p>
                <p className="text-xs">Escaneá o buscá arriba.</p>
              </div>
            ) : (
              // La tarjeta de cada línea se acomoda al ANCHO DEL CARRITO (container query): angosto
              // (celular, tablet, escritorio de 1024) → cantidad grande táctil y el IVA en su fila;
              // medio (≥ 512 px) → nombre arriba y cantidad, IVA y total debajo; ancho (≥ 576 px) →
              // TODO en un solo renglón: entran el doble de productos a la vista.
              <ul className="@container space-y-2 @xl:space-y-1.5">
                {cart.map((l) => {
                  const sinStockLinea = idsSinStock.has(l.producto.id);
                  const tier = tierDe(l);
                  const pAct = precioActual(l) + (l.precio_mods ?? 0);
                  const desc = l.descuento_pct || 0;
                  const brutoLinea = l.cantidad * pAct;
                  const netoLinea = totalLinea(l);
                  return (
                    <li key={l.cart_line_id} className={`rounded-xl border p-2.5 @lg:p-3 @xl:px-2.5 @xl:py-1.5 ${sinStockLinea ? "border-rose-300 bg-rose-50/60" : "border-slate-200 bg-slate-50/40"}`}>
                      <div className="flex items-start gap-2.5 @lg:gap-3 @xl:items-center">
                        <ProdThumb url={l.producto.imagen_url} nombre={l.producto.nombre} className="h-10 w-10 @lg:h-12 @lg:w-12 @xl:h-9 @xl:w-9" />
                        <div className="min-w-0 flex-1 @xl:flex @xl:items-center @xl:gap-3">
                          <div className="min-w-0 @xl:flex-1">
                          <div className="flex flex-wrap items-center gap-1.5">
                            <p className="min-w-0 flex-1 text-sm font-medium leading-snug text-slate-900 [overflow-wrap:anywhere] @lg:truncate">{l.producto.nombre}</p>
                            {l.mesa_min ? <span className="rounded-full border border-sky-200 bg-sky-50 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-sky-800">Mesa · {cantTxt(l.mesa_min)}</span> : null}
                            {l.pedido_cant != null ? (
                              <span className={`rounded-full border px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide ${l.cantidad !== l.pedido_cant ? "border-amber-300 bg-amber-50 text-amber-800" : "border-violet-200 bg-violet-50 text-violet-800"}`}
                                title={l.cantidad !== l.pedido_cant ? `En el pedido: ${l.pedido_cant}` : "Del pedido"}>
                                Pedido · {cantTxt(l.pedido_cant)}
                              </span>
                            ) : null}
                            {sinStockLinea && <span className="rounded-full border border-rose-300 bg-rose-100 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-rose-800">❌ Sin stock</span>}
                            {!sinStockLinea && idsVencidos.has(l.producto.id) && <span className="rounded-full border border-amber-300 bg-amber-100 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-amber-800">⚠ Vencido</span>}
                            {tier !== "minorista" && (
                              <span className="rounded-full border px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide" style={{ borderColor: `${TEAL}55`, backgroundColor: `${TEAL}14`, color: TEAL }}>
                                {tier === "mayorista" ? "Mayorista" : "Distribuidor"}
                              </span>
                            )}
                          </div>
                          <div className="flex flex-wrap items-center gap-1 font-mono text-[11px] text-slate-500 @xl:flex-nowrap @xl:whitespace-nowrap">
                            <span className="min-w-0 truncate">{l.producto.sku}</span>
                            <span>·</span>
                            <span className="font-semibold text-slate-700">{formatGs(pAct)}</span>
                            <span>c/u</span>
                            {desc > 0 && <span className="hidden rounded-full border border-emerald-200 bg-emerald-50 px-1.5 font-sans text-[10px] font-bold text-emerald-700 @xl:inline" title="Descuento del producto (Inventario)">−{desc}%</span>}
                          </div>
                          {/* Receta 73: modificadores de la línea (se cambian con la hoja; los de una mesa no). */}
                          {l.mods_snap || tieneMods(l.producto.mods) ? (
                            <div className="mt-0.5 flex flex-wrap items-center gap-x-2">
                              <ModsDetalle mods={l.mods_snap} className="min-w-0" />
                              {tieneMods(l.producto.mods) && !l.mesa_min ? (
                                <button type="button" onClick={() => setHojaMods({ p: l.producto, editar: l.cart_line_id })}
                                  className="inline-flex min-h-8 items-center text-xs font-semibold hover:underline lg:min-h-0" style={{ color: TEAL }}>
                                  {l.mods_snap ? "Cambiar" : "Elegir opciones"}
                                </button>
                              ) : null}
                            </div>
                          ) : null}
                          </div>
                          {/* Fila de cantidad / IVA / total (ancho). En angosto, ver abajo. */}
                          <div className="mt-2 hidden items-center gap-2 @lg:flex @xl:mt-0 @xl:shrink-0">
                            {/* Tablet (táctil): botones de 44 px también en la fila ancha. */}
                            <Stepper l={l} updateCant={updateCant} grande={!esEscritorio} />
                            <div className="ml-auto inline-flex overflow-hidden rounded-md border border-slate-300 shadow-sm" role="group" aria-label="IVA de la línea">
                              {IVAS_SEG.map((iva, idx) => {
                                const sel = l.tipo_iva === iva;
                                return (
                                  <button key={iva} type="button" onClick={() => setIvaLinea(l.cart_line_id, iva)}
                                    className={`px-2.5 py-1 text-[11px] font-bold transition-colors max-lg:h-10 max-lg:min-w-11 max-lg:text-xs ${idx > 0 ? "border-l border-slate-300" : ""} ${sel ? "text-white" : "bg-white text-slate-500 hover:bg-slate-50"}`}
                                    style={sel ? { backgroundColor: TEAL } : undefined}>
                                    {ivaCorto(iva)}
                                  </button>
                                );
                              })}
                            </div>
                            {/* Descuento del producto (definido en Inventario): solo lectura. */}
                            {/* En un solo renglón va junto al precio unitario: las columnas quedan alineadas. */}
                            {desc > 0 && (
                              <span className="rounded-full border border-emerald-200 bg-emerald-50 px-1.5 py-0.5 text-[10px] font-bold text-emerald-700 @xl:hidden" title="Descuento del producto (Inventario)">−{desc}%</span>
                            )}
                            <div className="w-24 text-right">
                              {desc > 0 && <div className="text-[10px] text-slate-400 line-through tabular-nums">{formatGs(brutoLinea)}</div>}
                              <div className="text-sm font-semibold tabular-nums text-slate-900">{formatGs(netoLinea)}</div>
                            </div>
                          </div>
                        </div>
                        {l.mesa_min ? (
                          <span className="-mr-1 -mt-1 inline-flex h-11 w-11 shrink-0 items-center justify-center text-slate-300 lg:@lg:m-0 lg:@lg:h-auto lg:@lg:w-auto" title="Es de la cuenta de la mesa: no se quita (soltá la cuenta entera)" aria-label="De la cuenta de la mesa"><Lock className="h-4 w-4" /></span>
                        ) : (
                          <button type="button" onClick={() => removeFromCart(l.cart_line_id)} className="-mr-1 -mt-1 inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-slate-400 hover:text-rose-500 active:bg-rose-50 lg:@lg:m-0 lg:@lg:h-auto lg:@lg:w-auto" aria-label="Quitar"><Trash2 className="h-4 w-4" /></button>
                        )}
                      </div>
                      {/* Angosto: cantidad (± de 44 px) y total; debajo el IVA y el descuento. */}
                      <div className="mt-2 flex items-center justify-between gap-2 @lg:hidden">
                        <Stepper l={l} updateCant={updateCant} grande />
                        <div className="min-w-0 text-right">
                          {desc > 0 && <div className="text-[11px] text-slate-400 line-through tabular-nums">{formatGs(brutoLinea)}</div>}
                          <div className="text-base font-bold tabular-nums text-slate-900">{formatGs(netoLinea)}</div>
                        </div>
                      </div>
                      <div className="mt-2 flex items-center gap-2 @lg:hidden">
                        <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">IVA</span>
                        <div className="inline-flex overflow-hidden rounded-lg border border-slate-300 bg-white" role="group" aria-label="IVA de la línea">
                          {IVAS_SEG.map((iva, idx) => {
                            const sel = l.tipo_iva === iva;
                            return (
                              <button key={iva} type="button" onClick={() => setIvaLinea(l.cart_line_id, iva)} aria-pressed={sel}
                                className={`h-10 min-w-11 px-2 text-xs font-bold transition-colors ${idx > 0 ? "border-l border-slate-300" : ""} ${sel ? "text-white" : "bg-white text-slate-500 active:bg-slate-50"}`}
                                style={sel ? { backgroundColor: TEAL } : undefined}>
                                {ivaCorto(iva)}
                              </button>
                            );
                          })}
                        </div>
                        {desc > 0 && (
                          <span className="ml-auto rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[11px] font-bold text-emerald-700" title="Descuento del producto (Inventario)">−{desc}%</span>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </div>

        {/* DERECHA: último producto + totales (escritorio). En celular / tablet: pie fijo. */}
        <div className="hidden flex-col rounded-2xl border border-slate-200 bg-white shadow-sm lg:flex">
          <div className="relative min-h-[170px] flex-1 overflow-hidden rounded-t-2xl" style={{ backgroundColor: ultimo && cart.length > 0 ? "#ffffff" : "#0b1f20" }}>
            {ultimo && cart.length > 0 ? (
              <>
                {/* La imagen del último producto ocupa TODO el recuadro. */}
                {ultimo.imagen_url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={ultimo.imagen_url} alt={ultimo.nombre} className="absolute inset-0 h-full w-full object-contain p-2" />
                ) : (
                  <div className="absolute inset-0 flex items-center justify-center text-slate-200">
                    <Package className="h-28 w-28" />
                  </div>
                )}
                {/* Nombre + SKU sobre un degradado abajo, para que se lean sobre la foto. */}
                <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/70 to-transparent p-4 pt-10 text-center">
                  <p className="truncate text-sm font-semibold text-white">{ultimo.nombre}</p>
                  <p className="font-mono text-[10px] text-white/70">{ultimo.sku}</p>
                </div>
              </>
            ) : (
              <div className="absolute inset-x-0 bottom-0 p-4 text-center">
                <p className="text-[11px] text-white/50">El último producto cargado se muestra acá.</p>
              </div>
            )}
          </div>

          <div className="space-y-2 border-t border-slate-100 px-5 py-3.5">
            <div className="flex items-baseline justify-between text-sm text-slate-500">
              <span>Unidades</span><span className="font-medium tabular-nums text-slate-800">{cantTxt(cantTotal)}</span>
            </div>
            <div className="flex items-baseline justify-between text-sm text-slate-500">
              <span>IVA incluido</span><span className="tabular-nums text-slate-600">{formatGs(totalIva)}</span>
            </div>
            <div className="flex items-baseline justify-between gap-3 border-t border-dashed border-slate-200 pt-2.5">
              <span className="text-sm font-medium text-slate-600">Total a cobrar</span>
              <span className="text-2xl font-bold tabular-nums text-slate-900">{formatGs(total)}</span>
            </div>
            <button type="button" onClick={abrirCobro} disabled={bloqueado}
              className="w-full rounded-xl px-5 py-3 text-base font-semibold text-white shadow-sm transition-colors disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-400 disabled:shadow-none"
              style={bloqueado ? undefined : { backgroundColor: TEAL }}>
              {haySinStock ? "Falta stock" : "Aceptar y cobrar"}
            </button>
            {cobroError && !cobroOpen && <p className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">{cobroError}</p>}
          </div>
        </div>
      </div>

      {/* Celular / tablet: pie fijo con el total y "Cobrar" (pulgar), sobre el safe-area. */}
      {!esEscritorio ? (
        <div className={`fixed inset-x-0 bottom-0 z-30 border-t border-slate-200 bg-white/95 shadow-[0_-10px_30px_-12px_rgba(15,23,42,0.28)] backdrop-blur pb-safe ${escribiendo ? "max-sm:hidden" : ""}`}>
          {cobroError && !cobroOpen ? (
            <p className="mx-auto max-w-3xl border-b border-rose-100 bg-rose-50 px-4 py-2 text-xs font-medium text-rose-700">{cobroError}</p>
          ) : null}
          <div className="mx-auto flex max-w-3xl items-center gap-3 px-3 py-2.5 sm:px-4">
            <div className="min-w-0 flex-1">
              <p className="truncate text-[11px] text-slate-500">
                {cantTxt(cantTotal)} unidad{cantTotal === 1 ? "" : "es"} · IVA incl. {formatGs(totalIva)}
              </p>
              <p className="truncate text-2xl font-bold leading-tight tabular-nums text-slate-900">{formatGs(total)}</p>
            </div>
            <button type="button" onClick={abrirCobro} disabled={bloqueado}
              className="h-14 min-w-[42%] shrink-0 rounded-2xl px-6 text-base font-bold text-white shadow-sm transition active:scale-[0.98] disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-400 disabled:shadow-none"
              style={bloqueado ? undefined : { backgroundColor: TEAL }}>
              {haySinStock ? "Falta stock" : "Cobrar"}
            </button>
          </div>
        </div>
      ) : null}
      </>
      )}

      {/* Celular / tablet: cliente, condición y documento */}
      {hojaOpciones && !esEscritorio ? (
        <HojaInferior titulo="Cliente y opciones de la venta" onClose={() => { setHojaOpciones(false); setClienteOpen(false); }} z="z-[60]"
          pie={
            <button type="button" onClick={() => { setHojaOpciones(false); setClienteOpen(false); if (cobroError) setCobroError(null); }}
              className="min-h-11 flex-1 rounded-xl px-4 text-sm font-semibold text-white" style={{ backgroundColor: TEAL }}>Listo</button>
          }>
          {/* Alto mínimo: la lista de clientes (que se abre debajo del campo) entra sin saltos. */}
          <div className="min-h-[50dvh]">{datosVenta}</div>
        </HojaInferior>
      ) : null}

      {/* Cobro: formas de pago (mixto, vuelto) o crédito */}
      {cobroOpen && (
        <CobroModal total={total} cantItems={cantTotal} tipoVenta={tipoVenta} plazoDias={plazoDiasNum} cuotas={cuotasOk ? cuotasNum : 1} cuotasCada={cuotasCada} cliente={clienteSel}
          entrega={tipoVenta === "CREDITO" && (entrega > 0 || planId) ? { monto: entrega, medio: medioEntrega,
            recargo: recargoPlan(Math.max(total - entrega, 0), planesCuota.planes.find((p) => p.id === planId)) } : undefined}
          documento={tipoDocumento === "factura"
            ? { tipo: "factura", nombre: ocasional ? nombreOcasional : clienteSel?.nombre ?? "", ruc: ocasional ? rucOcasional : rucFactura }
            : { tipo: "ticket" }}
          imprimir={cfgFact?.ticket_venta?.imprimir_al_cobrar !== false}
          cobrando={cobrando} error={cobroError} onClose={() => { setCobroOpen(false); setCobroError(null); }}
          onConfirmar={(p) => void confirmarCobro(p)} />
      )}

      {/* Ventanas de la caja (abrir, retiro / ingreso, turno, cierre) */}
      {modalCaja === "abrir" && estadoCajas ? (
        <AperturaModal estado={estadoCajas} onClose={() => setModalCaja(null)}
          onAbierta={(id) => { setModalCaja(null); elegirCaja(id); refrescarCajas(); enfocarBuscador(); }} />
      ) : null}
      {modalCaja === "mov" && caja ? (
        <MovimientoModal cajaId={caja.id} etiqueta={`${etiquetaCaja(caja)} · Turno N° ${caja.numero_caja}`}
          efectivoDisponible={estadoCajas?.sucursales.flatMap((s) => s.cajas).find((c) => c.turno?.id === caja.id)?.turno?.efectivo_esperado ?? null}
          onClose={() => setModalCaja(null)} onHecho={() => { setModalCaja(null); refrescarCajas(); }} />
      ) : null}
      {modalCaja === "ver" && caja ? (
        <TurnoModal turnoId={caja.id} onClose={() => setModalCaja(null)} onCambio={refrescarCajas} onCerrar={() => setModalCaja("cerrar")} />
      ) : null}
      {modalCaja === "cerrar" && caja ? (
        <CierreModal turnoId={caja.id} onClose={() => setModalCaja(null)} onCerrada={refrescarCajas} />
      ) : null}

      {/* Receta 73: modificadores del plato (misma hoja que el menú QR) */}
      {hojaMods && tieneMods(hojaMods.p.mods) ? (() => {
        const p = hojaMods.p;
        const l = hojaMods.editar ? cart.find((x) => x.cart_line_id === hojaMods.editar) : undefined;
        const desc = Math.max(0, Math.min(Number(p.descuento_pct) || 0, 100));
        return (
          <HojaModificadores
            producto={{
              nombre: p.nombre,
              precio: l ? precioConDesc(l) : Math.round(p.precio_venta * (1 - desc / 100)),
              precio_lista: !l && desc > 0 ? p.precio_venta : null,
              imagen_url: p.imagen_url,
            }}
            catalogo={p.mods!}
            inicial={l ?{ sel: l.mods ?? { quitar: [], extras: [], opciones: [] }, cantidad: l.cantidad } : undefined}
            color={TEAL}
            textoBoton={l ? "Guardar" : "Agregar"}
            maxCantidad={999}
            z="z-[80]"
            onConfirmar={confirmarHojaMods}
            onClose={() => { setHojaMods(null); enfocarBuscador(); }}
          />
        );
      })() : null}

      {/* Mesas por cobrar: elegir la cuenta que se carga en el carrito */}
      {bandejaMesas ? (
        <CapaModal onClose={() => setBandejaMesas(false)} z="z-[70]">
          <div role="dialog" aria-modal="true" aria-labelledby="mesas-titulo" className={`flex w-full max-w-lg flex-col overflow-hidden rounded-2xl bg-white shadow-2xl ${ALTO_MAX_MODAL}`}>
            <div className="flex shrink-0 items-start justify-between gap-3 border-b border-slate-100 px-5 py-4">
              <div className="min-w-0">
                <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">Caja</p>
                <h3 id="mesas-titulo" className="text-base font-semibold text-slate-900">Mesas por cobrar ({porCobrar.length})</h3>
              </div>
              <button type="button" aria-label="Cerrar" onClick={() => setBandejaMesas(false)} className="inline-flex h-11 w-11 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100 lg:h-9 lg:w-9"><X className="h-5 w-5" /></button>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3 sm:px-5">
              {porCobrar.length === 0 ? (
                <p className="py-10 text-center text-sm text-slate-400">No hay mesas esperando cobro.</p>
              ) : (
                <ul className="space-y-2">
                  {porCobrar.map((c) => {
                    const cargada = cuentaMesa?.id === c.id;
                    // Receta 88: separada desde el QR → una fila por parte (cada una su venta).
                    if (c.division) {
                      const d = c.division;
                      const algunaCobrada = d.partes.some((x) => x.cobrada);
                      const filas = [
                        ...d.partes.map((x) => ({ id: x.id, nombre: x.nombre, total: x.total, cobrada: x.cobrada, fact: x.facturacion, items: x.items.length })),
                        ...(d.resto ? [{ id: "resto", nombre: "Resto (sin asignar)", total: d.resto.total, cobrada: false, fact: c.facturacion ?? null, items: d.resto.items.length }] : []),
                      ];
                      return (
                        <li key={c.id} className={`rounded-xl border px-3 py-2.5 ${cargada ? "border-[var(--brand)]" : "border-slate-200"}`}>
                          <div className="flex items-start gap-3">
                            <span className="min-w-0 flex-1">
                              <span className="block text-sm font-semibold text-slate-900 [overflow-wrap:anywhere]">{origenPedido(c)}</span>
                              <span className="block text-xs text-slate-500">
                                Separada {d.modo === "iguales" ? "en partes iguales" : "por productos"} · {haceCuanto(c.en_caja_at, ahoraMesas())}
                                {c.cobrado ? ` · cobrado ${formatGs(c.cobrado)}` : ""}
                              </span>
                              {c.pendientes > 0 ? <span className="mt-1 block text-[11px] font-medium text-amber-700">Tiene un pedido nuevo sin atender</span> : null}
                            </span>
                            <span className="shrink-0 text-base font-bold tabular-nums text-slate-900">{formatGs(c.total)}</span>
                          </div>
                          <ul className="mt-2 divide-y divide-slate-100 rounded-lg border border-slate-100">
                            {filas.map((x) => {
                              const esta = cargada && parteMesa?.id === x.id;
                              return (
                                <li key={x.id}>
                                  <button type="button" disabled={x.cobrada || !productos.length || !x.items} onClick={() => cargarCuentaMesa(c, x.id)}
                                    className="flex min-h-12 w-full items-center gap-2 px-2.5 py-1.5 text-left text-sm transition hover:bg-slate-50 disabled:cursor-default disabled:hover:bg-transparent">
                                    <span className="min-w-0 flex-1">
                                      <span className={`block truncate font-medium ${x.cobrada ? "text-slate-400 line-through" : "text-slate-800"}`}>{x.nombre}</span>
                                      <span className="block truncate text-[11px] text-slate-500">
                                        {x.cobrada ? "Cobrada" : x.fact ? `Factura · ${x.fact.razon_social} · RUC ${x.fact.ruc}` : "Ticket (sin datos de factura)"}
                                        {esta ? <b className="ml-1" style={{ color: TEAL }}>· en el carrito</b> : null}
                                      </span>
                                    </span>
                                    <span className="shrink-0 tabular-nums font-semibold text-slate-900">{formatGs(x.total)}</span>
                                    {!x.cobrada ? <span className="w-14 shrink-0 text-right text-xs font-semibold" style={{ color: TEAL }}>{esta ? "Recargar" : "Cobrar"}</span> : <span className="w-14 shrink-0 text-right text-[11px] font-semibold text-emerald-700">Pagada</span>}
                                  </button>
                                </li>
                              );
                            })}
                          </ul>
                          {!algunaCobrada ? (
                            <button type="button" disabled={!productos.length} onClick={() => cargarCuentaMesa(c)}
                              className="mt-1.5 min-h-10 text-xs font-semibold text-slate-500 underline-offset-2 hover:underline disabled:opacity-50">
                              Cobrar todo junto ({formatGs(c.total)})
                            </button>
                          ) : null}
                        </li>
                      );
                    }
                    return (
                      <li key={c.id}>
                        <button type="button" disabled={!productos.length} onClick={() => cargarCuentaMesa(c)}
                          className={`flex min-h-14 w-full items-center gap-3 rounded-xl border px-3 py-2.5 text-left transition hover:bg-slate-50 active:scale-[0.99] disabled:opacity-50 ${cargada ? "border-[var(--brand)]" : "border-slate-200"}`}>
                          <span className="min-w-0 flex-1">
                            <span className="block text-sm font-semibold text-slate-900 [overflow-wrap:anywhere]">{origenPedido(c)}</span>
                            <span className="block text-xs text-slate-500">
                              {haceCuanto(c.en_caja_at, ahoraMesas())}{c.en_caja_por_nombre ? ` · la envió ${c.en_caja_por_nombre}` : ""}
                              {cargada ? <b className="ml-1 font-semibold" style={{ color: TEAL }}>· en el carrito</b> : null}
                            </span>
                            {c.facturacion ? <span className="mt-0.5 block truncate text-[11px] text-sky-800">Factura · {c.facturacion.razon_social} · RUC {c.facturacion.ruc}</span> : null}
                            {c.pendientes > 0 ? <span className="mt-1 block text-[11px] font-medium text-amber-700">Tiene un pedido nuevo sin atender</span> : null}
                          </span>
                          <span className="shrink-0 text-right">
                            <span className="block text-base font-bold tabular-nums text-slate-900">{formatGs(c.total)}</span>
                            <span className="text-xs font-semibold" style={{ color: TEAL }}>{cargada ? "Recargar" : "Cargar"}</span>
                          </span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
              {errorMesa ? <p className="mt-3 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700" role="alert">{errorMesa}</p> : null}
              {cart.some((l) => !l.mesa_min) ? <p className="mt-3 text-[11px] text-slate-500">Lo que ya está en el carrito se mantiene: la cuenta se suma.</p> : null}
            </div>
          </div>
        </CapaModal>
      ) : null}

      {/* Pedidos por cobrar (receta 77): elegir el pedido que se carga en el carrito */}
      {bandejaPedidos ? (
        <CapaModal onClose={() => setBandejaPedidos(false)} z="z-[70]">
          <div role="dialog" aria-modal="true" aria-labelledby="pedidos-titulo" className={`flex w-full max-w-lg flex-col overflow-hidden rounded-2xl bg-white shadow-2xl ${ALTO_MAX_MODAL}`}>
            <div className="flex shrink-0 items-start justify-between gap-3 border-b border-slate-100 px-5 py-4">
              <div className="min-w-0">
                <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">Caja</p>
                <h3 id="pedidos-titulo" className="text-base font-semibold text-slate-900">Pedidos por cobrar ({pedidosPorCobrar.length})</h3>
              </div>
              <button type="button" aria-label="Cerrar" onClick={() => setBandejaPedidos(false)} className="inline-flex h-11 w-11 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100 lg:h-9 lg:w-9"><X className="h-5 w-5" /></button>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3 sm:px-5">
              <form className="mb-3 flex gap-2" onSubmit={(e) => {
                e.preventDefault();
                const n = numeroDePedido(numeroBandeja) ?? (/^\s*\d{1,7}\s*$/.test(numeroBandeja) ? Number(numeroBandeja) : null);
                if (!n) { setErrorPedido("Escribí el número del pedido (por ejemplo P-0042 o 42)."); return; }
                void cargarPedidoPorNumero(n);
              }}>
                <input type="text" inputMode="text" value={numeroBandeja} onChange={(e) => setNumeroBandeja(e.target.value)} placeholder="Nº de pedido (P-0042) o escaneá"
                  aria-label="Número de pedido" autoComplete="off" enterKeyHint="search"
                  className="min-h-11 min-w-0 flex-1 rounded-lg border border-slate-200 px-3 text-base outline-none focus:ring-2 sm:text-sm" style={{ ["--tw-ring-color" as string]: `${TEAL}55` }} />
                <button type="submit" disabled={buscandoPedido || !numeroBandeja.trim() || !productos.length} className="inline-flex min-h-11 shrink-0 items-center rounded-lg px-4 text-sm font-semibold text-white disabled:opacity-50" style={{ backgroundColor: TEAL }}>
                  Cargar
                </button>
              </form>
              {pedidosPorCobrar.length === 0 ? (
                <p className="py-10 text-center text-sm text-slate-400">No hay pedidos esperando cobro.</p>
              ) : (
                <ul className="space-y-2">
                  {pedidosPorCobrar.map((x) => {
                    const cargado = pedido?.id === x.id;
                    return (
                      <li key={x.id}>
                        <button type="button" disabled={!productos.length} onClick={() => cargarPedido(x)}
                          className={`flex min-h-14 w-full items-center gap-3 rounded-xl border px-3 py-2.5 text-left transition hover:bg-slate-50 active:scale-[0.99] disabled:opacity-50 ${cargado ? "border-[var(--brand)]" : "border-slate-200"}`}>
                          <span className="min-w-0 flex-1">
                            <span className="block font-mono text-base font-bold text-slate-900">{x.etiqueta}</span>
                            <span className="block text-xs text-slate-500 [overflow-wrap:anywhere]">
                              {haceCuanto(x.creado_at, ahoraPedidos())}{x.vendedor ? ` · ${x.vendedor}` : ""}{x.cliente ? ` · ${x.cliente.nombre}` : ""}
                              {" · "}{x.items.length} producto{x.items.length === 1 ? "" : "s"}
                              {cargado ? <b className="ml-1 font-semibold" style={{ color: TEAL }}>· en el carrito</b> : null}
                            </span>
                          </span>
                          <span className="shrink-0 text-right">
                            <span className="block text-base font-bold tabular-nums text-slate-900">{formatGs(x.total)}</span>
                            <span className="text-xs font-semibold" style={{ color: TEAL }}>{cargado ? "Recargar" : "Cargar"}</span>
                          </span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
              {errorPedido ? <p className="mt-3 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700" role="alert">{errorPedido}</p> : null}
              {cart.some((l) => l.pedido_cant == null) ? <p className="mt-3 text-[11px] text-slate-500">Lo que ya está en el carrito se mantiene: el pedido se suma.</p> : null}
              <p className="mt-2 text-[11px] text-slate-500">También podés escanear el código del comprobante en el buscador de productos.</p>
            </div>
          </div>
        </CapaModal>
      ) : null}

      {/* Configuración › Facturación › "Pedir datos del comprador al confirmar venta" */}
      {pedirComprador ? (
        <CapaModal onClose={() => setPedirComprador(false)} z="z-[70]">
          <div role="dialog" aria-modal="true" aria-labelledby="comprador-titulo" className={`w-full max-w-md overflow-y-auto rounded-2xl bg-white p-5 shadow-2xl ${ALTO_MAX_MODAL}`}>
            <span className="grid h-10 w-10 place-items-center rounded-full" style={{ backgroundColor: `${TEAL}14`, color: TEAL }}><UserRound className="h-5 w-5" /></span>
            <p id="comprador-titulo" className="mt-3 text-base font-semibold text-slate-900">¿A nombre de quién va la venta?</p>
            <p className="mt-1 text-sm text-slate-500">Elegí o cargá el cliente con su RUC o CI para que salga en el comprobante, o seguí como consumidor final.</p>
            <div className="mt-4 grid gap-2">
              <button type="button" onClick={() => elegirCompradorAhora(false)} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl px-4 text-sm font-semibold text-white shadow-sm transition hover:brightness-95 active:scale-[0.98]" style={{ backgroundColor: TEAL }}>
                <Search className="h-4 w-4" /> Buscar cliente
              </button>
              <button type="button" onClick={() => elegirCompradorAhora(true)} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-700 shadow-sm transition hover:border-[var(--brand)] hover:text-[var(--brand)]">
                <UserRoundPlus className="h-4 w-4" /> Cargar nuevo cliente
              </button>
              {tipoVenta === "CONTADO" ? (
                <button type="button" onClick={() => { elegirOcasional(); setPedirComprador(false); setCobroOpen(true); }} className="inline-flex min-h-11 items-center justify-center rounded-xl border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-700 shadow-sm transition hover:border-[var(--brand)] hover:text-[var(--brand)]">
                  Cliente ocasional ({nombreOcasional})
                </button>
              ) : null}
              <button type="button" onClick={() => { consumidorFinalRef.current = true; setPedirComprador(false); setCobroOpen(true); }} className="inline-flex min-h-11 items-center justify-center rounded-xl px-4 text-sm font-semibold text-slate-500 transition hover:bg-slate-50 hover:text-slate-800">
                Seguir como consumidor final
              </button>
            </div>
          </div>
        </CapaModal>
      ) : null}

      {modalNuevoCliente && (
        <NuevoCliente
          inicial={clienteQuery.trim() && !/^[\d.\s-]+$/.test(clienteQuery.trim()) ? { nombre: clienteQuery.trim() } : undefined}
          onClose={() => setModalNuevoCliente(false)}
          onCreado={(c) => { setClientes((prev) => [c, ...prev]); setClienteId(c.id); setClienteQuery(""); setModalNuevoCliente(false); }}
        />
      )}
    </div>
  );
}

// ── Sub-componentes ──────────────────────────────────────────────────────────

function Atajo({ k, t }: { k: string; t: string }) {
  return (
    <span className="inline-flex items-center gap-1">
      <kbd className="rounded border border-slate-200 bg-slate-50 px-1.5 py-0.5 font-mono text-[10px] text-slate-500 shadow-sm">{k}</kbd>
      <span>{t}</span>
    </span>
  );
}

function Segmented<T extends string>({ value, options, onChange }: { value: T; options: { value: T; label: string; disabled?: boolean; title?: string }[]; onChange: (v: T) => void }) {
  return (
    <div className="flex overflow-hidden rounded-lg border border-slate-200">
      {options.map((opt) => {
        const sel = value === opt.value;
        return (
          <button key={opt.value} type="button" onClick={() => onChange(opt.value)} disabled={opt.disabled && !sel} title={opt.disabled ? opt.title : undefined}
            className={`flex-1 py-1.5 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:text-slate-300 [@media(pointer:coarse)]:min-h-11 ${sel ? "text-white" : "bg-white text-slate-600 hover:bg-slate-50"}`}
            style={sel ? { backgroundColor: TEAL } : undefined}>
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}

/** − cantidad + de la línea. `grande`: botones de 44 px para el dedo (carrito angosto). */
function Stepper({ l, updateCant, grande = false }: { l: CartLine; updateCant: (id: string, n: number) => void; grande?: boolean }) {
  const btn = grande
    ? "flex h-11 w-11 items-center justify-center text-xl font-medium leading-none text-slate-500 transition-colors active:bg-[var(--brand-100)] disabled:opacity-30"
    : "flex h-8 w-9 items-center justify-center text-lg font-medium leading-none text-slate-400 transition-colors hover:bg-[var(--brand-50)] hover:text-[var(--brand)] active:bg-[var(--brand-100)] disabled:opacity-30 disabled:hover:bg-transparent";
  return (
    // Stepper unificado: un solo borde, divisores internos y hover turquesa.
    <div className={`inline-flex shrink-0 items-center overflow-hidden border border-slate-200 bg-white shadow-sm ${grande ? "rounded-xl" : "rounded-lg"}`}>
      <button type="button" onClick={() => updateCant(l.cart_line_id, l.cantidad - 1)} disabled={(grande && l.cantidad <= 1) || (!!l.mesa_min && l.cantidad <= l.mesa_min)} className={btn} aria-label="Quitar una unidad">−</button>
      <QtyInput value={l.cantidad} onChange={(n) => updateCant(l.cart_line_id, n)} decimals={0}
        className={`border-x border-slate-200 bg-white text-center font-semibold tabular-nums text-slate-900 outline-none focus:bg-slate-50 ${grande ? "h-11 w-12 text-base" : "h-8 w-10 text-sm"}`} />
      <button type="button" onClick={() => updateCant(l.cart_line_id, l.cantidad + 1)} className={btn} aria-label="Agregar una unidad">+</button>
    </div>
  );
}

function ProdThumb({ url, nombre, className = "", contain, big }: { url?: string | null; nombre: string; className?: string; contain?: boolean; big?: boolean }) {
  return (
    <div className={`shrink-0 overflow-hidden rounded-lg border border-slate-200 bg-white ${className}`}>
      {url ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={url} alt={nombre} loading="lazy" decoding="async" className={`h-full w-full ${contain ? "object-contain p-1" : "object-cover"}`} />
      ) : (
        <div className="flex h-full w-full items-center justify-center text-slate-300">
          <Package className={big ? "h-24 w-24" : "h-5 w-5"} />
        </div>
      )}
    </div>
  );
}
