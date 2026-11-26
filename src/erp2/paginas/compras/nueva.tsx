"use client";

/**
 * /compras/nueva — UNA sola carga para todo lo que se compra o se paga (receta 59):
 * mercadería, gastos o las dos cosas en el mismo comprobante, eligiendo el tipo POR LÍNEA.
 *   · "Esta compra es: Mercadería / Gasto / Mixta" (1 toque) pone el tipo de las líneas nuevas;
 *     al cambiarlo ofrece convertir las existentes (confirma si se pierde algo). En Mixta cada
 *     línea tiene su conmutador. ?tipo=gasto|mixta abre directo en ese modo.
 *   · Comprobante: con comprobante fiscal (tipo, número, timbrado, fecha) o SIN comprobante
 *     (sueldo, propina, peaje…: proveedor opcional al contado, sin IVA, no deducible).
 *   · Condición: contado (medio de pago; el efectivo sale de la caja abierta; transferencia /
 *     cheque / tarjeta con la cuenta propia de origen) o crédito (plazo → Pagos a proveedores).
 *   · Moneda Gs./USD, sucursal (centro de costo) y depósito al que entra la mercadería.
 *   · Mercadería: producto (buscar / escanear / crear en un modal y queda elegido), cantidad,
 *     costo (con la última compra), precio de venta nuevo, lote y vencimiento si lo maneja.
 *     Suma stock y actualiza el costo como siempre.
 *   · Gasto: subcategoría de gasto, descripción, monto IVA incluido, IVA, deducible y, en las de
 *     personal, el empleado. No toca stock; va al resumen de gastos por categoría y sucursal.
 *   · Totales con IVA por tasa (exentas / 5 % / 10 %) y crédito fiscal sobre todas las líneas.
 * Recibiendo una orden (?oc=ID): sus productos como mercadería (no deja pasar de lo pendiente
 * sin confirmar) y se le pueden sumar gastos (ej. flete) pasando a Mixta.
 * Un doble clic no duplica la compra (idempotency_key).
 */
import Link from "next/link";
import { Suspense, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { ArrowLeft, CheckCircle2, ClipboardList, Info, Layers, Loader2, Package, Plus, Receipt, Trash2 } from "lucide-react";
import { apiFetch } from "@/erp2/lib/api/client-fetch";
import { apiFetchCache } from "@/erp2/lib/api/cache-cliente";
import { clienteConfig } from "@/erp2/cliente.config";
import { ALTO_MAX_MODAL, CapaModal } from "@/erp2/components/CapaModal";
import { Select } from "@/erp2/components/Select";
import MontoInput from "@/erp2/components/ui/MontoInput";
import { METODOS_PAGO_PROV, hrefCompra, type MetodoPagoProv } from "@/erp2/modules/compras/pagos";
import { hoyPY } from "@/erp2/lib/fecha/paraguay";
import { SelectorProveedor } from "@/erp2/modules/proveedores/SelectorProveedor";
import { Variacion, type HistorialCostosData } from "@/erp2/modules/inventario/HistorialCostos";
import { traerProductosLote } from "@/erp2/modules/inventario/lote";
import type { ProductoInventario } from "@/erp2/modules/inventario/tipos";
import type { ProveedorMin } from "@/erp2/modules/proveedores/tipos";
import { cargarProveedores } from "@/erp2/modules/proveedores/cache";
import type { OrdenCompra } from "@/erp2/modules/compras/ordenes";
import { AdjuntosPendientes, subirComprobantes } from "@/erp2/modules/compras/Comprobantes";
import { ProductoForm } from "@/erp2/modules/inventario/ProductoForm";
import { BuscadorProductos, ET, Fila, gs, INPUT, ivaDe, Segmentado, sumarDias, Tarjeta, usd } from "@/erp2/modules/compras/partes";
import { loteAutomatico } from "@/erp2/modules/inventario/vencimientos";
import { depositosPlanos, invalidarDepositos, opcionesDepositos, useDepositos } from "@/erp2/modules/inventario/depositos";
import { SelectorFecha } from "@/erp2/components/SelectorFecha";
import {
  TIPOS_COMPROBANTE, URL_CATALOGOS, indiceCategorias, nombreCuenta, requiereTimbrado, usaCuentaBancaria,
  type Catalogos, type IvaTipo,
} from "@/erp2/modules/gastos/tipos";

const TEAL = clienteConfig.color;
type Modo = "mercaderia" | "gasto" | "mixta";
type LineaMerc = {
  key: string;
  tipo: "mercaderia";
  /** null: viene de convertir un gasto; falta elegir el producto */
  prod: ProductoInventario | null;
  cantidad: string;
  costo: number;          // en la moneda de la factura, IVA incluido
  precioNuevo: number;    // 0 = no cambia
  ultima: { costo: number; fecha: string; proveedor: string | null } | null;
  /** productos con lotes: N° de lote (vacío → L-YYMMDD) y vencimiento YYYY-MM-DD */
  lote: string;
  vencimiento: string;
  /** línea de la orden que se está recibiendo */
  ocItemId?: string;
  pedido?: number;
  recibidoAntes?: number;
  /** gasto convertido: su descripción (para buscar el producto) */
  textoOrigen?: string;
};
type LineaGasto = {
  key: string;
  tipo: "gasto";
  categoria_id: string | null;
  descripcion: string;
  monto: number;          // en la moneda de la factura, IVA incluido
  iva_tipo: IvaTipo;
  empleado_id: string | null;
  deducible: boolean;
};
type Linea = LineaMerc | LineaGasto;
type Confirmar = { destino: Modo | "linea"; linea?: string; aTipo: "mercaderia" | "gasto"; n: number };

let seq = 0;
const nuevaKey = () => `l${Date.now()}-${++seq}`;
const gastoVacio = (): LineaGasto => ({ key: nuevaKey(), tipo: "gasto", categoria_id: null, descripcion: "", monto: 0, iva_tipo: "10%", empleado_id: null, deducible: true });
const gastoEsVacio = (l: Linea) => l.tipo === "gasto" && !l.categoria_id && !l.descripcion.trim() && !(l.monto > 0);
const ivaProducto = (t: string | null | undefined): IvaTipo => (t === "10%" ? "10%" : t === "5%" ? "5%" : "exenta");
const cantidadDe = (l: LineaMerc) => Number(l.cantidad.replace(",", ".")) || 0;
const MODOS: { v: Modo; l: string; d: string; icono: React.ReactNode }[] = [
  { v: "mercaderia", l: "Mercadería", d: "Suma stock", icono: <Package className="h-4 w-4" /> },
  { v: "gasto", l: "Gasto", d: "Alquiler, luz, sueldos…", icono: <Receipt className="h-4 w-4" /> },
  { v: "mixta", l: "Mixta", d: "Productos + gastos", icono: <Layers className="h-4 w-4" /> },
];

// useSearchParams necesita un Suspense alrededor (si no, el build de Next falla).
export default function NuevaCompraPage() {
  return (
    <Suspense>
      <NuevaCompra />
    </Suspense>
  );
}

function NuevaCompra() {
  const sp = useSearchParams();
  const ocId = sp.get("oc");
  const tipoUrl = sp.get("tipo");
  const modoInicial: Modo = !ocId && (tipoUrl === "gasto" || tipoUrl === "mixta") ? tipoUrl : "mercaderia";
  const [modo, setModo] = useState<Modo>(modoInicial);
  const [orden, setOrden] = useState<OrdenCompra | null>(null);
  const [proveedores, setProveedores] = useState<ProveedorMin[]>([]);
  const [cat, setCat] = useState<Catalogos | null>(null);
  const [proveedorId, setProveedorId] = useState<string | null>(null);
  const [conComprobante, setConComprobante] = useState(true);
  const [tipoComprobante, setTipoComprobante] = useState("Factura");
  const [factura, setFactura] = useState("");
  const [timbrado, setTimbrado] = useState("");
  const [fechaFactura, setFechaFactura] = useState(hoyPY());
  const [tipoPago, setTipoPago] = useState<"contado" | "credito">("contado");
  const [plazo, setPlazo] = useState("30");
  const [moneda, setMoneda] = useState<"GS" | "USD">("GS");
  const [cambio, setCambio] = useState(0);
  const [observacion, setObservacion] = useState("");
  const [creandoProd, setCreandoProd] = useState<{ texto: string; linea: string | null } | null>(null);
  const [lineas, setLineas] = useState<Linea[]>(() => (modoInicial === "gasto" ? [gastoVacio()] : []));
  const [confirmar, setConfirmar] = useState<Confirmar | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hecha, setHecha] = useState<{ id: string; numero: string; total: number; tipo: Modo; adjuntos: number; fallidos: string[] } | null>(null);
  // Sucursal (centro de costo) y depósito al que entra la mercadería.
  const deps = useDepositos();
  const [sucursal, setSucursal] = useState("");
  const [deposito, setDeposito] = useState("");
  const planos = depositosPlanos(deps.datos);
  const depDeSucursal = (sid: string) =>
    planos.find((d) => d.sucursal_id === sid && d.activo && d.es_principal)?.id ?? planos.find((d) => d.sucursal_id === sid && d.activo)?.id ?? "";
  const depositoEf = deposito || (sucursal ? depDeSucursal(sucursal) : "") || deps.datos?.mi_deposito_id || "";
  const opcDepositos = opcionesDepositos(deps.datos);
  const [adjuntos, setAdjuntos] = useState<File[]>([]);
  const [subiendoAdjuntos, setSubiendoAdjuntos] = useState(false);
  // Contado: cómo se pagó. El efectivo sale de la caja abierta (solo en Gs.).
  const [medioPago, setMedioPago] = useState<MetodoPagoProv | "">("");
  const [referenciaPago, setReferenciaPago] = useState("");
  const [cuentaBancaria, setCuentaBancaria] = useState("");
  const [cajaAbierta, setCajaAbierta] = useState<boolean | null>(null);
  // Neura: cada compra genera su asiento; la mercadería va a la cuenta contable que se elige acá.
  const [cuentasMerc, setCuentasMerc] = useState<{ id: string; codigo: string; nombre: string }[]>([]);
  const [cuentaMerc, setCuentaMerc] = useState("");
  // Recepción de una orden: llegó más de lo pendiente y el usuario lo confirma.
  const [excedenteOk, setExcedenteOk] = useState(false);
  // Un doble clic o un reintento devuelve la misma compra (no dos). Nueva por cada compra.
  const [idem, setIdem] = useState(() => crypto.randomUUID());

  useEffect(() => {
    // Misma lista (y misma llamada) que usa el SelectorProveedor.
    void cargarProveedores().then(setProveedores);
    apiFetchCache<Catalogos>(URL_CATALOGOS).then(setCat).catch(() => setCat(null));
    apiFetch<{ caja: { id: string } | null }>("/api/caja").then((r) => setCajaAbierta(!!r.caja)).catch(() => setCajaAbierta(false));
    apiFetchCache<{ cuentas: { id: string; codigo: string; nombre: string }[] }>("/api/compras/cuentas")
      .then((r) => { setCuentasMerc(r.cuentas); setCuentaMerc((c) => c || r.cuentas[0]?.id || ""); })
      .catch(() => setCuentasMerc([]));
  }, []);

  // Recibir una orden de compra: proveedor, condición y moneda de la orden, y sus
  // productos con lo que falta recibir (se ajusta a lo que llegó de verdad).
  useEffect(() => {
    if (!ocId) return;
    let vivo = true;
    (async () => {
      try {
        const o = await apiFetch<OrdenCompra>(`/api/ordenes-compra/${ocId}`);
        if (!vivo) return;
        setOrden(o);
        setProveedorId(o.proveedor_id);
        setTipoPago(o.tipo_pago);
        if (o.plazo_dias) setPlazo(String(o.plazo_dias));
        setMoneda(o.moneda);
        if (o.moneda === "USD") setCambio(Number(o.tipo_cambio) || 0);
        const pendientes = (o.items ?? []).filter((i) => Number(i.cantidad) > Number(i.cantidad_recibida));
        // Los productos y la última compra de cada uno en un solo request.
        const { productos: prods, costos: historiales } = await traerProductosLote<ProductoInventario>(
          pendientes.map((i) => i.producto_id),
          { costos: true, costosLimite: 1 },
        );
        if (!vivo) return;
        setLineas(pendientes.flatMap((i): Linea[] => {
          const prod = prods.get(i.producto_id);
          if (!prod) return [];
          const u = historiales.get(i.producto_id)?.compras[0];
          return [{
            key: i.id,
            tipo: "mercaderia",
            prod,
            cantidad: String(Number(i.cantidad) - Number(i.cantidad_recibida)),
            costo: Number(i.costo_unitario_original) || 0,
            precioNuevo: 0,
            ultima: u ? { costo: Number(u.costo), fecha: u.fecha, proveedor: u.proveedor } : null,
            lote: loteAutomatico(hoyPY()),
            vencimiento: "",
            ocItemId: i.id,
            pedido: Number(i.cantidad),
            recibidoAntes: Number(i.cantidad_recibida),
          }];
        }));
      } catch (e) {
        if (vivo) setError((e as Error).message);
      }
    })();
    return () => { vivo = false; };
  }, [ocId]);

  const indice = useMemo(() => indiceCategorias(cat?.rubros ?? []), [cat]);
  const empleados = (cat?.empleados ?? []).filter((e) => e.activo);
  const cuentas = (cat?.cuentas_bancarias ?? []).filter((c) => c.activa);
  const sucursales = cat?.sucursales ?? [];
  const merc = lineas.filter((l): l is LineaMerc => l.tipo === "mercaderia");
  const gastos = lineas.filter((l): l is LineaGasto => l.tipo === "gasto");
  const sucursalDeDeposito = planos.find((d) => d.id === depositoEf)?.sucursal_id ?? "";
  const sucursalEf = sucursal || (merc.length ? sucursalDeDeposito : "") || cat?.mi_sucursal_id || "";

  // Al elegir el proveedor se proponen su condición, plazo y moneda habituales (y, en un gasto,
  // la subcategoría que se usó la última vez con él).
  function elegirProveedor(id: string | null) {
    setProveedorId(id);
    const p = proveedores.find((x) => x.id === id);
    if (!p) {
      // recién creado desde el selector: él ya recargó la lista compartida (sale del cache)
      if (id) void cargarProveedores().then(setProveedores);
      return;
    }
    setTipoPago(p.condicion_pago);
    if (p.plazo_pago_dias) setPlazo(String(p.plazo_pago_dias));
    setMoneda(p.moneda);
    const u = id ? cat?.ultimos[id] : undefined;
    if (u) {
      if (u.medio_pago && !medioPago) setMedioPago(u.medio_pago);
      if (u.tipo_comprobante && TIPOS_COMPROBANTE.includes(u.tipo_comprobante)) setTipoComprobante(u.tipo_comprobante);
      if (u.categoria_id && indice.has(u.categoria_id)) {
        setLineas((ls) => {
          const i = ls.findIndex((l) => l.tipo === "gasto" && !l.categoria_id);
          if (i < 0) return ls;
          const l = ls[i] as LineaGasto;
          const c = indice.get(u.categoria_id!);
          const n: LineaGasto = { ...l, categoria_id: u.categoria_id, iva_tipo: u.iva_tipo ?? l.iva_tipo, descripcion: l.descripcion || u.descripcion || "", deducible: c?.deducible_iva ?? true };
          return ls.map((x, j) => (j === i ? n : x));
        });
      }
    }
  }

  const conLotes = (p: ProductoInventario | null) => !!(p?.controla_stock && p?.controla_lotes);

  async function ultimaCompra(key: string, prod: ProductoInventario) {
    // Última compra: se muestra al lado del costo y se propone el mismo costo.
    try {
      const h = await apiFetch<HistorialCostosData>(`/api/productos/${prod.id}/costos`);
      const u = h.compras[0];
      const base = u ? Number(u.costo) : Number(prod.costo_promedio) || 0;
      setLineas((ls) => ls.map((l) => (l.key === key && l.tipo === "mercaderia" ? {
        ...l,
        ultima: u ? { costo: Number(u.costo), fecha: u.fecha, proveedor: u.proveedor } : null,
        costo: l.costo || (moneda === "GS" ? Math.round(base) : 0),
      } : l)));
    } catch {
      /* sin historial */
    }
  }

  async function agregar(prod: ProductoInventario) {
    // Con lotes, cada vez que se agrega es otra línea (otro lote); sin lotes, suma 1.
    const existente = conLotes(prod) ? null : merc.find((l) => l.prod?.id === prod.id);
    if (existente) {
      setLineas((ls) => ls.map((l) => (l.key === existente.key && l.tipo === "mercaderia" ? { ...l, cantidad: String(cantidadDe(l) + 1) } : l)));
      return;
    }
    const key = nuevaKey();
    // Recibiendo una orden: si el producto está en la orden (p. ej. otro lote del mismo
    // producto), la línea nueva también cuenta como recibido de esa orden.
    const oi = orden?.items?.find((i) => i.producto_id === prod.id);
    const deOrden = oi ? { ocItemId: oi.id, pedido: Number(oi.cantidad), recibidoAntes: Number(oi.cantidad_recibida) } : {};
    const costoOrden = oi ? Number(oi.costo_unitario_original) || 0 : 0;
    setLineas((ls) => [...ls, { key, tipo: "mercaderia", prod, cantidad: "1", costo: costoOrden, precioNuevo: 0, ultima: null, lote: loteAutomatico(hoyPY()), vencimiento: "", ...deOrden }]);
    void ultimaCompra(key, prod);
  }

  /** Línea de mercadería sin producto (venía de un gasto): se elige el producto. */
  function asignarProducto(key: string, prod: ProductoInventario) {
    setLineas((ls) => ls.map((l) => (l.key === key && l.tipo === "mercaderia" ? { ...l, prod, textoOrigen: undefined } : l)));
    void ultimaCompra(key, prod);
  }

  const cambiar = (key: string, patch: Partial<LineaMerc> | Partial<LineaGasto>) =>
    setLineas((ls) => ls.map((l) => (l.key === key ? ({ ...l, ...patch } as Linea) : l)));
  const quitar = (key: string) => setLineas((ls) => ls.filter((x) => x.key !== key));
  const agregarGasto = () => setLineas((ls) => [...ls, gastoVacio()]);

  // ── Conversión entre tipos ────────────────────────────────────────────────
  const aGasto = (l: LineaMerc): LineaGasto => {
    const cant = cantidadDe(l) || 1;
    const nombre = l.prod?.nombre ?? l.textoOrigen ?? "";
    return {
      key: l.key, tipo: "gasto", categoria_id: null,
      descripcion: `${nombre}${cant !== 1 ? ` × ${cant.toLocaleString("es-PY")}` : ""}`.slice(0, 300),
      monto: moneda === "USD" ? Math.round(cant * l.costo * 100) / 100 : Math.round(cant * l.costo),
      iva_tipo: ivaProducto(l.prod?.tipo_iva), empleado_id: null, deducible: true,
    };
  };
  const aMercaderia = (l: LineaGasto): LineaMerc => ({
    key: l.key, tipo: "mercaderia", prod: null, cantidad: "1", costo: l.monto, precioNuevo: 0, ultima: null,
    lote: loteAutomatico(hoyPY()), vencimiento: "", textoOrigen: l.descripcion || (l.categoria_id ? indice.get(l.categoria_id)?.nombre : "") || "",
  });
  /** ¿Convertir esta línea pierde algo? (producto, lote, precio, categoría…) */
  const pierde = (l: Linea) => (l.tipo === "mercaderia" ? !!l.prod || l.costo > 0 : !gastoEsVacio(l));

  function convertirTodas(aTipo: "mercaderia" | "gasto") {
    setLineas((ls) => {
      const sinVacias = ls.filter((l) => !gastoEsVacio(l));
      const conv = sinVacias.map((l) => (l.tipo === aTipo ? l : l.tipo === "mercaderia" ? aGasto(l) : aMercaderia(l)));
      return aTipo === "gasto" && conv.length === 0 ? [gastoVacio()] : conv;
    });
  }

  function elegirModo(nuevo: Modo) {
    if (nuevo === modo) return;
    if (nuevo === "mixta") { setModo("mixta"); return; }
    const aTipo = nuevo;
    const otras = lineas.filter((l) => l.tipo !== aTipo && !gastoEsVacio(l));
    if (aTipo === "gasto" && orden && merc.length) {
      // Una orden de compra se recibe como mercadería: para sumarle gastos, Mixta.
      setModo("mixta");
      return;
    }
    if (otras.length === 0) {
      setLineas((ls) => {
        const sin = ls.filter((l) => !gastoEsVacio(l));
        return aTipo === "gasto" && !sin.some((l) => l.tipo === "gasto") ? [...sin, gastoVacio()] : sin;
      });
      setModo(nuevo);
      return;
    }
    if (!otras.some(pierde)) { convertirTodas(aTipo); setModo(nuevo); return; }
    setConfirmar({ destino: nuevo, aTipo, n: otras.length });
  }

  function conmutarLinea(l: Linea, aTipo: "mercaderia" | "gasto") {
    if (l.tipo === aTipo) return;
    if (l.tipo === "mercaderia" && l.ocItemId) { setError("Los productos de la orden de compra se reciben como mercadería."); return; }
    if (pierde(l)) { setConfirmar({ destino: "linea", linea: l.key, aTipo, n: 1 }); return; }
    setLineas((ls) => ls.map((x) => (x.key !== l.key ? x : x.tipo === "mercaderia" ? aGasto(x) : aMercaderia(x))));
  }

  function aceptarConversion(c: Confirmar) {
    if (c.destino === "linea") {
      setLineas((ls) => ls.map((x) => (x.key !== c.linea ? x : x.tipo === "mercaderia" ? aGasto(x) : aMercaderia(x))));
    } else {
      convertirTodas(c.aTipo);
      setModo(c.destino);
    }
    setConfirmar(null);
  }

  const factor = moneda === "USD" ? cambio : 1;
  const ivaGasto = (l: LineaGasto): IvaTipo => (conComprobante ? l.iva_tipo : "exenta");
  const dedGasto = (l: LineaGasto) => {
    const c = l.categoria_id ? indice.get(l.categoria_id) : undefined;
    return conComprobante && ivaGasto(l) !== "exenta" && (c?.deducible_iva ?? true) && l.deducible;
  };

  const calc = useMemo(() => {
    let total = 0, t10 = 0, i10 = 0, t5 = 0, i5 = 0, ex = 0, unidades = 0, totalOrig = 0, totMerc = 0, totGastos = 0, credito = 0;
    for (const l of lineas) {
      let linea: number, iva: IvaTipo;
      if (l.tipo === "mercaderia") {
        const cant = cantidadDe(l);
        linea = Math.round(cant * l.costo * factor);
        totalOrig += cant * l.costo;
        unidades += cant;
        iva = ivaProducto(l.prod?.tipo_iva);
        totMerc += linea;
      } else {
        linea = Math.round((Number(l.monto) || 0) * factor);
        totalOrig += Number(l.monto) || 0;
        iva = ivaGasto(l);
        totGastos += linea;
      }
      total += linea;
      const i = iva === "exenta" ? 0 : ivaDe(linea, iva);
      if (iva === "10%") { t10 += linea; i10 += i; } else if (iva === "5%") { t5 += linea; i5 += i; } else ex += linea;
      if (conComprobante && (l.tipo === "mercaderia" || dedGasto(l))) credito += i;
    }
    return { total, t10, i10, t5, i5, ex, subtotal: total - i10 - i5, unidades, totalOrig, totMerc, totGastos, credito };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lineas, factor, conComprobante, indice]);

  // Recibiendo una orden: lo que llega de cada línea (puede venir en varias, una por lote)
  // contra lo que quedaba pendiente. Pasarse pide confirmación explícita.
  const excedidas = useMemo(() => {
    const suma = new Map<string, { recibe: number; pendiente: number }>();
    for (const l of lineas) {
      if (l.tipo !== "mercaderia" || !l.ocItemId || l.pedido == null) continue;
      const x = suma.get(l.ocItemId) ?? { recibe: 0, pendiente: Math.max(l.pedido - (l.recibidoAntes ?? 0), 0) };
      x.recibe += cantidadDe(l);
      suma.set(l.ocItemId, x);
    }
    return new Set([...suma].filter(([, x]) => x.recibe > x.pendiente).map(([k]) => k));
  }, [lineas]);
  const hayExcedente = excedidas.size > 0;
  const efectivo = tipoPago === "contado" && medioPago === "efectivo";
  const hayEmpleados = empleados.length > 0;
  const esPersonal = (l: LineaGasto) => !!(l.categoria_id && indice.get(l.categoria_id)?.es_personal);

  const ordenCerrada = !!orden && orden.estado !== "pendiente" && orden.estado !== "recibida_parcial";
  const faltan = [
    ordenCerrada && `una orden abierta (la ${orden?.numero_oc} ${orden?.estado === "cancelada" ? "está cancelada" : "ya se recibió completa"})`,
    !proveedorId && conComprobante && "el proveedor",
    !proveedorId && !conComprobante && tipoPago === "credito" && "el proveedor (a crédito se le debe a alguien)",
    conComprobante && !factura.trim() && "el número de comprobante",
    fechaFactura > hoyPY() && "una fecha que no sea futura",
    tipoPago === "contado" && !medioPago && "el medio de pago",
    efectivo && moneda === "USD" && "otro medio de pago (el efectivo de la caja es en guaraníes)",
    efectivo && moneda === "GS" && cajaAbierta === false && "abrir la caja (el efectivo sale de la caja)",
    hayExcedente && !excedenteOk && "confirmar que llegó más de lo pedido",
    moneda === "USD" && !(cambio > 0) && "la cotización del dólar",
    lineas.length === 0 && (modo === "gasto" ? "al menos un gasto" : modo === "mixta" ? "al menos un producto o un gasto" : "al menos un producto"),
    merc.length > 0 && !cuentaMerc && "la cuenta contable de la mercadería",
    merc.some((l) => !l.prod) && "el producto de alguna línea",
    merc.some((l) => !(cantidadDe(l) > 0)) && "la cantidad de algún producto",
    merc.some((l) => !(l.costo > 0)) && "el costo de algún producto",
    merc.some((l) => conLotes(l.prod) && !l.vencimiento) && "el vencimiento de algún producto con lotes",
    gastos.some((l) => !l.categoria_id) && "la categoría de algún gasto",
    gastos.some((l) => !(Number(l.monto) > 0)) && "el monto de algún gasto",
    hayEmpleados && gastos.some((l) => esPersonal(l) && !l.empleado_id) && "el empleado de alguna línea de personal",
  ].filter(Boolean) as string[];

  const sustantivo = merc.length && gastos.length ? "compra" : gastos.length || modo === "gasto" ? "gasto" : "compra";
  const etiquetaRegistrar = subiendoAdjuntos ? "Subiendo comprobantes…" : busy ? "Registrando…" : `Registrar ${sustantivo}`;

  async function registrar() {
    if (faltan.length || busy) return;
    setBusy(true);
    setError(null);
    try {
      const r = await apiFetch<{ id: string; numero_control: string; total: number; tipo: Modo }>("/api/compras", {
        method: "POST",
        body: JSON.stringify({
          proveedor_id: proveedorId,
          con_comprobante: conComprobante,
          tipo_comprobante: conComprobante ? tipoComprobante : null,
          numero_factura: factura.trim() || null,
          nro_timbrado: conComprobante ? timbrado.trim() || null : null,
          fecha_factura: fechaFactura || null,
          tipo_pago: tipoPago,
          plazo_dias: tipoPago === "credito" ? Number(plazo) || null : null,
          medio_pago: tipoPago === "contado" && medioPago ? medioPago : null,
          referencia_pago: tipoPago === "contado" && medioPago !== "efectivo" ? referenciaPago.trim() || null : null,
          cuenta_bancaria_id: tipoPago === "contado" && usaCuentaBancaria(medioPago) ? cuentaBancaria || null : null,
          moneda,
          tipo_cambio: moneda === "USD" ? cambio : null,
          observacion: observacion.trim() || null,
          sucursal_id: sucursal || null,
          orden_compra_id: orden?.id ?? null,
          permitir_excedente: hayExcedente && excedenteOk,
          idempotency_key: idem,
          deposito_id: merc.length ? depositoEf || null : null,
          items: merc.map((l) => ({
            producto_id: l.prod!.id,
            cantidad: cantidadDe(l),
            costo_unitario: l.costo,
            precio_venta_nuevo: l.precioNuevo > 0 ? l.precioNuevo : null,
            oc_item_id: l.ocItemId ?? null,
            cuenta_contable_id: cuentaMerc || null,
            lote: conLotes(l.prod) ? l.lote.trim() || null : null,
            vencimiento: conLotes(l.prod) ? l.vencimiento : null,
          })),
          gastos: gastos.map((l) => ({
            categoria_id: l.categoria_id,
            // vacía = el nombre de la categoría (se muestra como sugerencia en el campo)
            monto: Number(l.monto) || 0,
            iva_tipo: ivaGasto(l),
            deducible: dedGasto(l),
            empleado_id: esPersonal(l) ? l.empleado_id : null,
          })),
        }),
      });
      // Los comprobantes se suben recién con la compra creada. Si alguno falla, la compra
      // queda igual (ya está registrada) y se avisa para adjuntarlo desde el detalle.
      let fallidos: string[] = [];
      if (adjuntos.length) {
        setSubiendoAdjuntos(true);
        fallidos = await subirComprobantes(r.id, adjuntos);
        setSubiendoAdjuntos(false);
      }
      setHecha({ id: r.id, numero: r.numero_control, total: r.total, tipo: r.tipo ?? (merc.length ? (gastos.length ? "mixta" : "mercaderia") : "gasto"), adjuntos: adjuntos.length - fallidos.length, fallidos });
      if (merc.length) invalidarDepositos(); // cambió el stock de un depósito
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  function otra() {
    setHecha(null);
    setFactura("");
    setTimbrado("");
    setObservacion("");
    setLineas(modo === "gasto" ? [gastoVacio()] : []);
    setAdjuntos([]);
    setFechaFactura(hoyPY());
    setReferenciaPago("");
    setExcedenteOk(false);
    setIdem(crypto.randomUUID());
  }

  if (hecha) {
    const esGasto = hecha.tipo === "gasto";
    return (
      <div className="mx-auto max-w-lg py-16 text-center">
        <CheckCircle2 className="mx-auto h-14 w-14 text-emerald-500" />
        <h1 className="mt-4 text-2xl font-semibold text-slate-900">{esGasto ? "Gasto registrado" : "Compra registrada"}</h1>
        <p className="mt-1 text-sm text-slate-500">
          <strong className="font-semibold text-slate-700">{hecha.numero}</strong> por <strong className="font-semibold text-slate-700">{gs(hecha.total)}</strong>.
          {hecha.tipo === "mercaderia" ? " El stock, los costos y el kardex ya quedaron actualizados."
            : hecha.tipo === "mixta" ? " La mercadería ya sumó stock y los gastos quedaron en el resumen de gastos."
            : " Ya cuenta en el resumen de gastos (no toca el stock)."}
          {tipoPago === "credito" ? " Quedó como deuda en Pagos a proveedores." : ""}
          {hecha.adjuntos ? ` Se ${hecha.adjuntos === 1 ? "adjuntó 1 comprobante" : `adjuntaron ${hecha.adjuntos} comprobantes`}.` : ""}
        </p>
        {hecha.fallidos.length ? (
          <div className="mx-auto mt-4 max-w-md rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-left text-xs text-amber-800">
            <p className="font-semibold">Quedó registrada, pero no se pudo subir {hecha.fallidos.length === 1 ? "un comprobante" : `${hecha.fallidos.length} comprobantes`}:</p>
            <ul className="mt-1 list-disc space-y-0.5 pl-4">{hecha.fallidos.map((f, i) => <li key={i}>{f}</li>)}</ul>
            <p className="mt-1">Podés adjuntarlo después desde el detalle (Compras y gastos → tocá el documento → Adjuntar comprobante).</p>
          </div>
        ) : null}
        <div className="mt-6 flex flex-col-reverse justify-center gap-2 sm:flex-row">
          <Link href={hrefCompra(hecha.id)} className="inline-flex min-h-11 items-center justify-center rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-medium text-slate-600 hover:bg-slate-50 sm:min-h-0">Ver {esGasto ? "el gasto" : "la compra"}</Link>
          {orden ? (
            <Link href={`/compras/ordenes?ver=${orden.id}`} className="inline-flex min-h-11 items-center justify-center rounded-xl px-4 py-2.5 text-sm font-semibold text-white sm:min-h-0" style={{ backgroundColor: TEAL }}>Ver la orden {orden.numero_oc}</Link>
          ) : (
            <button onClick={otra} className="inline-flex min-h-11 items-center justify-center rounded-xl px-4 py-2.5 text-sm font-semibold text-white sm:min-h-0" style={{ backgroundColor: TEAL }}>Cargar otr{esGasto ? "o gasto" : "a compra"}</button>
          )}
        </div>
      </div>
    );
  }

  const tituloLineas = modo === "gasto" ? "Gastos" : modo === "mixta" ? "Productos y gastos" : "Productos";
  const muestraBuscador = modo !== "gasto";
  const muestraAgregarGasto = modo !== "mercaderia";

  return (
    <div className="space-y-5 pb-10 max-lg:pb-28 sm:space-y-6">
      <header className="flex items-start gap-3">
        <Link href="/compras" aria-label="Volver a compras y gastos" className="mt-1 flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-500 hover:bg-slate-50 sm:h-9 sm:w-9">
          <ArrowLeft className="h-4 w-4" />
        </Link>
        <div className="min-w-0">
          <p className="text-[10px] font-semibold uppercase tracking-[0.18em]" style={{ color: TEAL }}>Gastos empresariales · Compras y gastos</p>
          <h1 className="mt-1 text-xl font-semibold tracking-tight text-slate-900 [overflow-wrap:anywhere] sm:text-2xl">{orden ? `Recibir ${orden.numero_oc}` : modo === "gasto" ? "Nuevo gasto" : "Nueva compra"}</h1>
          <p className="mt-1 text-[13px] text-slate-500 sm:text-sm">
            {orden
              ? "Cargá la factura y ajustá las cantidades a lo que llegó de verdad. Lo que no llegó queda pendiente en la orden. Si vino con flete, pasala a Mixta y sumalo como gasto."
              : modo === "gasto" ? "Alquiler, servicios, sueldos, impuestos… Va al resumen de gastos por categoría y sucursal (no toca el stock)."
              : modo === "mixta" ? "Productos que suman stock y gastos (flete, servicios…) en el mismo comprobante."
              : "Cargá la factura del proveedor: suma el stock y actualiza los costos solo."}
          </p>
        </div>
      </header>

      {/* ── Esta compra es: (1 toque) ─────────────────────────────────────── */}
      <div>
        <p className="mb-1.5 text-xs font-medium text-slate-600">Esta compra es:</p>
        <div className="grid grid-cols-3 gap-1 rounded-2xl bg-slate-100 p-1 sm:max-w-xl" role="radiogroup" aria-label="Tipo de compra">
          {MODOS.map((m) => {
            const on = modo === m.v;
            const bloqueado = !!orden && m.v === "gasto";
            return (
              <button key={m.v} type="button" role="radio" aria-checked={on} disabled={bloqueado} onClick={() => elegirModo(m.v)}
                title={bloqueado ? "Una orden de compra se recibe como mercadería (para sumar gastos, Mixta)" : undefined}
                className={`flex min-h-12 flex-col items-center justify-center rounded-xl px-1.5 py-1.5 text-center transition disabled:opacity-40 sm:flex-row sm:gap-2 sm:px-3 ${on ? "bg-white shadow-sm" : "text-slate-500 hover:text-slate-700"}`}
                style={on ? { color: TEAL } : undefined}>
                <span className="flex items-center gap-1.5 text-sm font-semibold">{m.icono}{m.l}</span>
                <span className={`text-[10px] leading-tight sm:text-[11px] ${on ? "text-slate-500" : "text-slate-400"} max-[379px]:hidden`}>{m.d}</span>
              </button>
            );
          })}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-5 sm:gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="min-w-0 space-y-5 sm:space-y-6">
          {/* ── 1. Comprobante ────────────────────────────────────────────── */}
          <Tarjeta numero={1} titulo="Comprobante y pago">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="sm:col-span-2">
                <Segmentado valor={conComprobante ? "si" : "no"} onChange={(v) => setConComprobante(v === "si")}
                  opciones={[["si", "Con comprobante fiscal"], ["no", "Sin comprobante"]]} />
                {!conComprobante ? (
                  <p className="mt-1.5 flex items-start gap-1.5 text-[11px] text-slate-500"><Info className="mt-px h-3.5 w-3.5 shrink-0" /> Sueldo, propina, peaje, viático… Sin IVA discriminado y no deducible. Al contado el proveedor es opcional.</p>
                ) : null}
              </div>
              <div className="sm:col-span-2">
                <span className={ET}>Proveedor {conComprobante || tipoPago === "credito" ? "*" : <span className="font-normal text-slate-400">(opcional)</span>}</span>
                {orden ? (
                  <p className="flex flex-wrap items-center gap-x-2 gap-y-0.5 rounded-xl border border-slate-200 bg-slate-50/60 px-3 py-2.5 text-sm font-semibold text-slate-800">
                    <ClipboardList className="h-4 w-4 shrink-0 text-slate-400" /> <span className="min-w-0 [overflow-wrap:anywhere]">{orden.proveedor_nombre}</span>
                    <span className="ml-auto text-xs font-normal text-slate-500">de la {orden.numero_oc}</span>
                  </p>
                ) : (
                  <SelectorProveedor value={proveedorId} onChange={(id) => elegirProveedor(id)} />
                )}
              </div>
              {conComprobante ? (
                <>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="min-w-0">
                      <span className={ET}>Tipo</span>
                      <Select value={tipoComprobante} onChange={setTipoComprobante} block etiqueta="Tipo de comprobante" options={TIPOS_COMPROBANTE.map((t): [string, string] => [t, t])} />
                    </div>
                    <label className="block min-w-0">
                      <span className={ET}>Número *</span>
                      <input value={factura} onChange={(e) => setFactura(e.target.value)} maxLength={40} placeholder="001-001-0000123" enterKeyHint="next" autoComplete="off" className={`${INPUT} tabular-nums`} />
                    </label>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <label className="block min-w-0">
                      <span className={ET}>Timbrado <span className="font-normal text-slate-400">{requiereTimbrado(tipoComprobante) ? "(opcional)" : "(no lleva)"}</span></span>
                      <input value={timbrado} onChange={(e) => setTimbrado(e.target.value.replace(/\D/g, "").slice(0, 12))} inputMode="numeric" enterKeyHint="next" placeholder="12345678" className={`${INPUT} tabular-nums`} />
                    </label>
                    <div className="block min-w-0">
                      <span className={ET}>Fecha</span>
                      <SelectorFecha block etiqueta="Fecha del comprobante" value={fechaFactura} max={hoyPY()} onChange={setFechaFactura} />
                    </div>
                  </div>
                </>
              ) : (
                <>
                  <label className="block min-w-0">
                    <span className={ET}>Referencia <span className="font-normal text-slate-400">(opcional)</span></span>
                    <input value={factura} onChange={(e) => setFactura(e.target.value)} maxLength={40} placeholder="Ticket, recibo interno…" enterKeyHint="next" autoComplete="off" className={INPUT} />
                  </label>
                  <div className="block min-w-0">
                    <span className={ET}>Fecha</span>
                    <SelectorFecha block etiqueta="Fecha" value={fechaFactura} max={hoyPY()} onChange={setFechaFactura} />
                  </div>
                </>
              )}
              <div>
                <span className={ET}>Condición</span>
                <Segmentado valor={tipoPago} onChange={(v) => setTipoPago(v as "contado" | "credito")} opciones={[["contado", "Contado"], ["credito", "Crédito"]]} />
                {tipoPago === "credito" ? (
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <input inputMode="numeric" enterKeyHint="done" aria-label="Plazo en días" value={plazo} onChange={(e) => setPlazo(e.target.value.replace(/\D/g, "").slice(0, 4))} className={`${INPUT} w-20 py-2 text-right tabular-nums`} />
                    <span className="text-sm text-slate-500">días</span>
                    {fechaFactura && Number(plazo) > 0 ? (
                      <span className="ml-auto rounded-full bg-amber-50 px-2.5 py-1 text-xs font-semibold text-amber-700">Vence el {sumarDias(fechaFactura, Number(plazo))}</span>
                    ) : null}
                  </div>
                ) : (
                  <div className="mt-2 space-y-2">
                    <Select value={medioPago} onChange={(v) => setMedioPago(v as MetodoPagoProv)} block etiqueta="Medio de pago"
                      options={[["", "¿Cómo le pagaste?"], ...METODOS_PAGO_PROV.map((m): [string, string] => [m.v, m.l])]} />
                    {usaCuentaBancaria(medioPago) && cuentas.length ? (
                      <Select value={cuentaBancaria} onChange={setCuentaBancaria} block etiqueta="Cuenta de origen"
                        options={[["", "Cuenta de origen (opcional)"], ...cuentas.map((c): [string, string] => [c.id, nombreCuenta(c)])]} />
                    ) : null}
                    {medioPago && medioPago !== "efectivo" ? (
                      <input value={referenciaPago} onChange={(e) => setReferenciaPago(e.target.value.slice(0, 120))} enterKeyHint="done" placeholder="N° de operación o de cheque (opcional)" className={`${INPUT} py-2`} />
                    ) : null}
                    {medioPago === "efectivo" ? (
                      <p className={`text-[11px] ${moneda === "USD" || cajaAbierta === false ? "font-semibold text-rose-600" : "text-slate-500"}`}>
                        {moneda === "USD" ? "El efectivo de la caja es en guaraníes: en dólares va por transferencia u otro medio."
                          : cajaAbierta === false ? "No hay caja abierta: el efectivo sale de la caja, abrila primero."
                          : "El total sale de la caja abierta como egreso."}
                      </p>
                    ) : null}
                  </div>
                )}
              </div>
              <div className="space-y-3">
                <div>
                  <span className={ET}>Moneda</span>
                  <Segmentado valor={moneda} onChange={(v) => setMoneda(v as "GS" | "USD")} opciones={[["GS", "Guaraníes"], ["USD", "Dólares"]]} />
                  {moneda === "USD" ? (
                    <div className="mt-2 flex flex-wrap items-center gap-2">
                      <span className="text-sm text-slate-500">1 US$ =</span>
                      <MontoInput value={cambio} onChange={setCambio} decimals={false} placeholder="7.300" aria-label="Cotización del dólar" className={`${INPUT} w-28 py-2 text-right tabular-nums`} />
                      <span className="text-sm text-slate-500">Gs.</span>
                    </div>
                  ) : null}
                </div>
                {sucursales.length > 1 ? (
                  <div>
                    <span className={ET}>Sucursal (centro de costo)</span>
                    <Select value={sucursalEf} onChange={(v) => { setSucursal(v); setDeposito(""); }} block etiqueta="Sucursal"
                      options={sucursales.map((s): [string, string] => [s.id, s.nombre])} />
                  </div>
                ) : null}
              </div>
            </div>
          </Tarjeta>

          {/* ── 2. Líneas ─────────────────────────────────────────────────── */}
          <Tarjeta numero={2} titulo={tituloLineas} extra={lineas.length ? (
            <span className="text-xs text-slate-500">
              {[merc.length ? `${merc.length} ${merc.length === 1 ? "producto" : "productos"}` : null, gastos.length ? `${gastos.length} ${gastos.length === 1 ? "gasto" : "gastos"}` : null].filter(Boolean).join(" · ")}
            </span>
          ) : null}>
            {muestraBuscador ? <BuscadorProductos onElegir={agregar} onCrear={(t) => setCreandoProd({ texto: t, linea: null })} /> : null}
            {creandoProd !== null ? (
              <ProductoForm modal inicial={{ nombre: creandoProd.texto, proveedor_principal_id: proveedorId }}
                onClose={() => setCreandoProd(null)}
                onSaved={async (c) => {
                  const destino = creandoProd.linea;
                  setCreandoProd(null);
                  // El producto recién creado queda elegido (en su línea o como línea nueva).
                  if (c?.id) {
                    try {
                      const p = await apiFetch<ProductoInventario>(`/api/productos/${c.id}`);
                      if (destino) asignarProducto(destino, p); else void agregar(p);
                    } catch { /* lo busca a mano */ }
                  }
                }} />
            ) : null}
            {lineas.length === 0 ? (
              <div className="mt-4 rounded-xl border border-dashed border-slate-200 px-4 py-8 text-center">
                {modo === "gasto" ? <Receipt className="mx-auto h-7 w-7 text-slate-300" /> : <Package className="mx-auto h-7 w-7 text-slate-300" />}
                <p className="mt-2 text-sm text-slate-500">
                  {modo === "gasto" ? "Agregá los gastos del comprobante." : modo === "mixta" ? "Buscá los productos y agregá los gastos del comprobante." : "Buscá o escaneá los productos de la factura."}
                </p>
              </div>
            ) : (
              <ul className={`${muestraBuscador ? "mt-4" : ""} space-y-3`}>
                {lineas.map((l, i) => {
                  const conmutador = modo === "mixta" ? (
                    <ConmutadorTipo valor={l.tipo} onChange={(t) => conmutarLinea(l, t)} bloqueado={l.tipo === "mercaderia" && !!l.ocItemId} />
                  ) : null;
                  if (l.tipo === "gasto") {
                    return (
                      <LineaGastoCard key={l.key} l={l} n={i + 1} moneda={moneda} factor={factor} conComprobante={conComprobante}
                        cat={cat} indice={indice} empleados={empleados} conmutador={conmutador} deducible={dedGasto(l)}
                        onCambiar={(p) => cambiar(l.key, p)} onQuitar={() => quitar(l.key)} />
                    );
                  }
                  if (!l.prod) {
                    return (
                      <li key={l.key} className="rounded-xl border border-amber-200 bg-amber-50/40 p-3">
                        <div className="mb-2 flex flex-wrap items-center gap-2">
                          {conmutador}
                          <p className="min-w-0 flex-1 text-xs text-amber-800">Elegí el producto{l.textoOrigen ? <> de <b className="[overflow-wrap:anywhere]">“{l.textoOrigen}”</b></> : null} (costo {moneda === "USD" ? usd(l.costo) : gs(l.costo)}).</p>
                          <button type="button" onClick={() => quitar(l.key)} aria-label="Quitar la línea" className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-slate-400 hover:bg-rose-50 hover:text-rose-600 sm:h-8 sm:w-8"><Trash2 className="h-4 w-4" /></button>
                        </div>
                        <BuscadorProductos onElegir={(p) => asignarProducto(l.key, p)} onCrear={(t) => setCreandoProd({ texto: t || l.textoOrigen || "", linea: l.key })} />
                      </li>
                    );
                  }
                  return (
                    <LineaCompra key={l.key} l={l} prod={l.prod} moneda={moneda} factor={factor} conmutador={conmutador}
                      excede={!!l.ocItemId && excedidas.has(l.ocItemId)} onCambiar={(p) => cambiar(l.key, p)} onQuitar={() => quitar(l.key)} />
                  );
                })}
              </ul>
            )}
            {muestraAgregarGasto ? (
              <button type="button" onClick={agregarGasto}
                className="mt-3 flex min-h-11 w-full items-center justify-center gap-1.5 rounded-xl border border-dashed border-slate-300 text-sm font-semibold transition hover:border-[var(--brand)] hover:bg-[var(--brand)]/5 sm:min-h-10"
                style={{ color: TEAL }}>
                <Plus className="h-4 w-4" /> Agregar {gastos.length ? "otro gasto" : "un gasto"}
              </button>
            ) : null}
          </Tarjeta>
        </div>

        {/* ── 3. Resumen ─────────────────────────────────────────────────── */}
        <aside className="lg:sticky lg:top-4 lg:self-start">
          <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">Resumen</p>
            <dl className="mt-3 space-y-1.5 text-sm">
              {merc.length ? <Fila l={`Mercadería · ${calc.unidades.toLocaleString("es-PY", { maximumFractionDigits: 3 })} u.`} v={gs(calc.totMerc)} /> : null}
              {gastos.length ? <Fila l={`Gastos · ${gastos.length} ${gastos.length === 1 ? "línea" : "líneas"}`} v={gs(calc.totGastos)} /> : null}
              {calc.t10 ? <Fila l={`Gravado 10 % (IVA ${gs(calc.i10)})`} v={gs(calc.t10)} /> : null}
              {calc.t5 ? <Fila l={`Gravado 5 % (IVA ${gs(calc.i5)})`} v={gs(calc.t5)} /> : null}
              {calc.ex ? <Fila l="Exentas" v={gs(calc.ex)} /> : null}
            </dl>
            <div className="mt-3 flex items-baseline justify-between border-t border-slate-100 pt-3">
              <span className="text-sm font-semibold text-slate-800">Total</span>
              <span className="text-2xl font-extrabold tabular-nums text-slate-900">{gs(calc.total)}</span>
            </div>
            {moneda === "USD" ? <p className="text-right text-xs text-slate-500">{usd(calc.totalOrig)} a {gs(cambio)}</p> : null}
            <p className="mt-1 text-right text-xs text-slate-500">
              {conComprobante ? `Crédito fiscal (IVA deducible): ${gs(calc.credito)}` : "Sin comprobante fiscal: no genera crédito fiscal"}
            </p>
            <p className="mt-1 text-right text-xs text-slate-500">
              {tipoPago === "credito"
                ? `A crédito${Number(plazo) > 0 && fechaFactura ? ` · vence el ${sumarDias(fechaFactura, Number(plazo))}` : ""} · queda en Pagos a proveedores`
                : `Al contado${medioPago ? ` · ${METODOS_PAGO_PROV.find((m) => m.v === medioPago)?.l.toLowerCase()}` : ""}${efectivo ? " (sale de la caja)" : ""}`}
            </p>

            {merc.length ? (
              <div className="mt-4">
                <span className={ET}>Cuenta contable de la mercadería</span>
                <Select value={cuentaMerc} onChange={setCuentaMerc} block etiqueta="Cuenta contable"
                  options={cuentasMerc.map((c): [string, string] => [c.id, `${c.codigo} · ${c.nombre}`])} />
              </div>
            ) : null}

            {merc.length && opcDepositos.length > 1 ? (
              <div className="mt-4">
                <span className={ET}>La mercadería entra al depósito</span>
                <Select value={depositoEf} onChange={setDeposito} block etiqueta="Entra al depósito" options={opcDepositos} />
              </div>
            ) : null}

            <label className="mt-4 block">
              <span className={ET}>Observación <span className="font-normal text-slate-400">(opcional)</span></span>
              <textarea value={observacion} onChange={(e) => setObservacion(e.target.value)} rows={2} maxLength={2000} placeholder="Ej: faltó 1 caja, la traen el lunes" className={INPUT} />
            </label>

            <div className="mt-4">
              <AdjuntosPendientes files={adjuntos} onChange={setAdjuntos} disabled={busy} />
            </div>

            {hayExcedente ? (
              <label className="mt-3 flex cursor-pointer items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800 max-sm:py-3 max-sm:text-[13px]">
                <input type="checkbox" checked={excedenteOk} onChange={(e) => setExcedenteOk(e.target.checked)} className="mt-0.5 h-4 w-4 shrink-0 accent-[var(--brand)] max-sm:h-5 max-sm:w-5" />
                <span>Estás recibiendo <strong>más de lo que falta</strong> de {excedidas.size === 1 ? "un producto" : `${excedidas.size} productos`} de la orden. Confirmo que llegó de más y lo quiero ingresar.</span>
              </label>
            ) : null}
            {faltan.length ? (
              <p className="mt-3 rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-500">Falta: {faltan.join(", ")}.</p>
            ) : null}
            {error ? <p className="mt-3 rounded-lg bg-rose-50 px-3 py-2 text-xs text-rose-700">{error}</p> : null}
            {/* En celular / tablet el botón va en el pie fijo (abajo). */}
            <button onClick={registrar} disabled={!!faltan.length || busy}
              className="mt-4 hidden w-full items-center justify-center gap-2 rounded-xl py-3 text-sm font-semibold text-white transition hover:brightness-95 disabled:opacity-40 lg:inline-flex" style={{ backgroundColor: TEAL }}>
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
              {etiquetaRegistrar}
            </button>
            <p className="mt-2 text-center text-[11px] text-slate-400">
              {merc.length ? `La mercadería suma stock${opcDepositos.length > 1 ? ` en ${opcDepositos.find(([id]) => id === depositoEf)?.[1] ?? "el depósito elegido"}` : ""} con el costo de esta compra (las ventas usan primero lo más viejo). ` : ""}
              {gastos.length ? "Los gastos van al resumen de gastos por categoría y sucursal (no tocan stock)." : ""}
            </p>
          </div>
        </aside>
      </div>

      {/* Celular / tablet: total y "Registrar" en un pie fijo (safe-area) */}
      <div className="fixed inset-x-0 bottom-0 z-30 border-t border-slate-200 bg-white/95 shadow-[0_-10px_30px_-12px_rgba(15,23,42,0.28)] backdrop-blur pb-safe lg:hidden">
        <div className="mx-auto flex max-w-3xl items-center gap-3 px-3 py-2.5 sm:px-4">
          <div className="min-w-0 flex-1">
            <p className={`truncate text-[11px] ${error ? "font-semibold text-rose-600" : "text-slate-500"}`}>
              {error ? error : faltan.length ? `Falta: ${faltan[0]}${faltan.length > 1 ? ` y ${faltan.length - 1} más` : ""}` : `Total · ${lineas.length} ${lineas.length === 1 ? "línea" : "líneas"}`}
            </p>
            <p className="truncate text-xl font-bold leading-tight tabular-nums text-slate-900">{gs(calc.total)}</p>
          </div>
          <button type="button" onClick={() => void registrar()} disabled={!!faltan.length || busy}
            className="inline-flex h-12 max-w-[60%] shrink-0 items-center justify-center gap-2 rounded-xl px-5 text-sm font-semibold text-white transition active:scale-[0.98] disabled:opacity-40" style={{ backgroundColor: TEAL }}>
            {busy ? <Loader2 className="h-4 w-4 shrink-0 animate-spin" /> : <CheckCircle2 className="h-4 w-4 shrink-0" />}
            <span className="truncate">{etiquetaRegistrar}</span>
          </button>
        </div>
      </div>

      {confirmar ? (
        <CapaModal onClose={() => setConfirmar(null)}>
          <div className={`flex w-full max-w-md flex-col overflow-hidden rounded-2xl bg-white shadow-2xl ${ALTO_MAX_MODAL}`} style={{ animation: "modal-pop 0.18s cubic-bezier(0.16,1,0.3,1)" }}>
            <div className="shrink-0 border-b border-slate-100 px-4 py-3 sm:px-6 sm:py-4">
              <h2 className="text-base font-semibold text-slate-800">
                {confirmar.aTipo === "gasto"
                  ? `¿Pasar ${confirmar.n === 1 ? "el producto" : `los ${confirmar.n} productos`} a gasto?`
                  : `¿Pasar ${confirmar.n === 1 ? "el gasto" : `los ${confirmar.n} gastos`} a mercadería?`}
              </h2>
            </div>
            <div className="min-h-0 flex-1 space-y-2 overflow-y-auto px-4 py-4 text-sm text-slate-600 sm:px-6">
              {confirmar.aTipo === "gasto" ? (
                <p>Se conservan la descripción, el monto y el IVA, pero <b>se pierde el producto</b> (no va a sumar stock), el lote y el precio de venta nuevo. Después elegís la categoría de cada gasto.</p>
              ) : (
                <p>Se conserva el monto como costo, pero <b>se pierde la categoría</b> del gasto. Después elegís el producto de cada línea (o lo creás).</p>
              )}
              {confirmar.destino !== "linea" ? <p className="text-xs text-slate-500">Si querés dejar las líneas como están y sumar las nuevas del otro tipo, elegí <b>Dejarla mixta</b>.</p> : null}
            </div>
            <div className="flex shrink-0 flex-wrap justify-end gap-2 border-t border-slate-100 px-4 py-3 sm:px-6 sm:py-4">
              <button onClick={() => setConfirmar(null)} className="rounded-xl border border-slate-200 px-4 py-2 text-sm text-slate-600 hover:bg-slate-50 max-sm:flex-1">Cancelar</button>
              {confirmar.destino !== "linea" ? (
                <button onClick={() => { setModo("mixta"); setConfirmar(null); }} className="rounded-xl border border-[var(--brand)]/50 px-4 py-2 text-sm font-semibold text-[var(--brand)] hover:bg-[var(--brand)]/5 max-sm:flex-1">Dejarla mixta</button>
              ) : null}
              <button onClick={() => aceptarConversion(confirmar)} className="rounded-xl px-4 py-2 text-sm font-semibold text-white hover:brightness-95 max-sm:w-full" style={{ backgroundColor: TEAL }}>
                Convertir a {confirmar.aTipo === "gasto" ? "gasto" : "mercadería"}
              </button>
            </div>
          </div>
        </CapaModal>
      ) : null}
    </div>
  );
}

/** Conmutador Mercadería / Gasto de una línea (compra mixta). 44 px al dedo en celular. */
function ConmutadorTipo({ valor, onChange, bloqueado }: { valor: "mercaderia" | "gasto"; onChange: (v: "mercaderia" | "gasto") => void; bloqueado?: boolean }) {
  return (
    <div className="inline-flex shrink-0 rounded-xl bg-slate-100 p-0.5" role="radiogroup" aria-label="Tipo de línea">
      {([["mercaderia", "Mercadería", Package], ["gasto", "Gasto", Receipt]] as const).map(([v, l, Icono]) => {
        const on = valor === v;
        return (
          <button key={v} type="button" role="radio" aria-checked={on} disabled={bloqueado && !on} onClick={() => onChange(v)}
            title={bloqueado && !on ? "Viene de la orden de compra: es mercadería" : undefined}
            className={`inline-flex min-h-11 items-center gap-1 rounded-[10px] px-3 text-xs font-semibold transition disabled:opacity-40 sm:min-h-8 sm:px-2.5 ${on ? "bg-white shadow-sm" : "text-slate-500 hover:text-slate-700"}`}
            style={on ? { color: TEAL } : undefined}>
            <Icono className="h-3.5 w-3.5" /> {l}
          </button>
        );
      })}
    </div>
  );
}

/** Una línea de GASTO: subcategoría, descripción, monto (IVA incluido), IVA, deducible y empleado. */
function LineaGastoCard({ l, n, moneda, factor, conComprobante, cat, indice, empleados, conmutador, deducible, onCambiar, onQuitar }: {
  l: LineaGasto; n: number; moneda: "GS" | "USD"; factor: number; conComprobante: boolean;
  cat: Catalogos | null; indice: ReturnType<typeof indiceCategorias>; empleados: Catalogos["empleados"];
  conmutador: React.ReactNode; deducible: boolean;
  onCambiar: (p: Partial<LineaGasto>) => void; onQuitar: () => void;
}) {
  const c = l.categoria_id ? indice.get(l.categoria_id) : undefined;
  const opciones = useMemo<[string, string][]>(() => [
    ["", "(Elegir categoría)"],
    ...(cat?.rubros ?? []).flatMap((r) => r.subcategorias.map((s): [string, string] => [s.id, `${r.nombre} › ${s.nombre}`])),
  ], [cat]);
  const montoGs = Math.round((Number(l.monto) || 0) * factor);
  const iva: IvaTipo = conComprobante ? l.iva_tipo : "exenta";
  function elegirCategoria(id: string) {
    const x = indice.get(id);
    onCambiar({
      categoria_id: id || null,
      iva_tipo: x && !x.deducible_iva && x.es_personal && l.iva_tipo === "10%" ? "exenta" : l.iva_tipo,
      empleado_id: x?.es_personal ? l.empleado_id : null,
      deducible: x?.deducible_iva ?? true,
    });
  }
  return (
    <li className="rounded-xl border border-slate-200 border-l-4 p-3" style={{ borderLeftColor: "#8b5cf6" }}>
      <div className="mb-2 flex flex-wrap items-center gap-2">
        {conmutador ?? <span className="inline-flex items-center gap-1 rounded-full bg-violet-50 px-2 py-0.5 text-[11px] font-semibold text-violet-700"><Receipt className="h-3 w-3" /> Gasto {n}</span>}
        <span className="ml-auto text-sm font-bold tabular-nums text-slate-900">{gs(montoGs)}</span>
        <button type="button" onClick={onQuitar} aria-label={`Quitar el gasto ${n}`} className="-mr-1.5 inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-slate-400 hover:bg-rose-50 hover:text-rose-600 sm:mr-0 sm:h-8 sm:w-8"><Trash2 className="h-4 w-4" /></button>
      </div>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-12">
        <div className="min-w-0 sm:col-span-5">
          <span className={ET}>Categoría *</span>
          <Select value={l.categoria_id ?? ""} onChange={elegirCategoria} options={opciones} block etiqueta="Categoría del gasto" />
        </div>
        <label className="block min-w-0 sm:col-span-7">
          <span className={ET}>Descripción</span>
          <input value={l.descripcion} onChange={(e) => onCambiar({ descripcion: e.target.value.slice(0, 300) })} maxLength={300} enterKeyHint="next" placeholder={c?.nombre ?? "Detalle del gasto"} className={`${INPUT} py-2`} />
        </label>
      </div>
      <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-12">
        <label className={`flex min-w-0 flex-col justify-end ${conComprobante ? "sm:col-span-4" : "col-span-2 sm:col-span-4"}`}>
          <span className={ET}>Monto {moneda === "USD" ? "(US$)" : ""} {conComprobante ? <span className="font-normal text-slate-400">IVA incl.</span> : null} *</span>
          <MontoInput value={l.monto || ""} onChange={(v) => onCambiar({ monto: v })} decimals={moneda === "USD"} placeholder="0" enterKeyHint="done"
            aria-label={`Monto del gasto ${n}`} className={`${INPUT} py-2 text-right tabular-nums`} />
        </label>
        {conComprobante ? (
          <div className="flex min-w-0 flex-col justify-end sm:col-span-3">
            <span className={ET}>IVA</span>
            <Select value={l.iva_tipo} onChange={(v) => onCambiar({ iva_tipo: v as IvaTipo })} block etiqueta="IVA del gasto" options={[["10%", "10 %"], ["5%", "5 %"], ["exenta", "Exenta"]]} />
          </div>
        ) : null}
        {c?.es_personal ? (
          <div className="col-span-2 flex min-w-0 flex-col justify-end sm:col-span-5">
            <span className={ET}>Empleado{empleados.length ? " *" : ""}</span>
            {empleados.length ? (
              <Select value={l.empleado_id ?? ""} onChange={(v) => onCambiar({ empleado_id: v || null })} block etiqueta="Empleado"
                options={[["", "(Empleado)"], ...empleados.map((e): [string, string] => [e.id, `${e.nombre}${e.cargo ? ` · ${e.cargo}` : ""}`])]} />
            ) : <p className="pb-2 text-xs text-slate-500">Cargá empleados en Catálogos.</p>}
          </div>
        ) : null}
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[11px]">
        {c ? <span className={`rounded px-1.5 py-0.5 font-semibold ${c.tipo_costo === "fijo" ? "bg-violet-50 text-violet-700" : "bg-slate-100 text-slate-500"}`}>{c.tipo_costo === "fijo" ? "Fijo" : "Variable"}</span> : null}
        {iva !== "exenta" ? <span className="text-slate-500">IVA {iva}: <b className="text-slate-700">{gs(ivaDe(montoGs, iva))}</b></span> : <span className="text-slate-400">Sin IVA</span>}
        {conComprobante && iva !== "exenta" && (c?.deducible_iva ?? true) ? (
          <button type="button" onClick={() => onCambiar({ deducible: !l.deducible })} aria-pressed={deducible}
            className={`ml-auto inline-flex min-h-11 items-center rounded-lg px-2.5 font-semibold sm:min-h-7 ${deducible ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-700"}`}>
            {deducible ? "IVA deducible ✓" : "No deducible"}
          </button>
        ) : conComprobante && c && !c.deducible_iva ? <span className="ml-auto rounded bg-amber-50 px-1.5 py-0.5 font-semibold text-amber-700">No deducible</span> : null}
      </div>
    </li>
  );
}

/** Una línea de MERCADERÍA: cantidad, costo (con la última compra) y precio de venta nuevo. */
function LineaCompra({ l, prod, moneda, factor, excede, conmutador, onCambiar, onQuitar }: {
  l: LineaMerc; prod: ProductoInventario; moneda: "GS" | "USD"; factor: number;
  /** recibiendo una orden: entre todas sus líneas se pasa de lo pendiente */
  excede: boolean;
  conmutador: React.ReactNode;
  onCambiar: (p: Partial<LineaMerc>) => void; onQuitar: () => void;
}) {
  const cant = cantidadDe(l);
  const costoGs = l.costo * factor;
  const totalLinea = Math.round(cant * costoGs);
  const variacion = l.ultima && l.ultima.costo > 0 && costoGs > 0 ? Math.round(((costoGs - l.ultima.costo) / l.ultima.costo) * 1000) / 10 : null;
  const precio = l.precioNuevo > 0 ? l.precioNuevo : Number(prod.precio_venta) || 0;
  const margen = precio > 0 && costoGs > 0 ? Math.round(((precio - costoGs) / precio) * 1000) / 10 : null;
  const unidad = prod.unidad_medida === "Unidad" ? "u." : prod.unidad_medida;

  return (
    <li className="rounded-xl border border-slate-200 border-l-4 p-3" style={{ borderLeftColor: "#0ea5e9" }}>
      {conmutador ? <div className="mb-2">{conmutador}</div> : null}
      <div className="flex items-start gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-slate-100 text-xs font-semibold text-slate-500">
          {prod.imagen_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={prod.imagen_url} alt="" className="h-full w-full object-contain" />
          ) : prod.nombre.charAt(0).toUpperCase()}
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-slate-900 max-sm:line-clamp-2 max-sm:[overflow-wrap:anywhere] sm:truncate">{prod.nombre}</p>
          <p className="text-[11px] text-slate-500"><span className="font-mono">{prod.sku}</span> · stock {Number(prod.stock_actual).toLocaleString("es-PY")} {unidad} · IVA {prod.tipo_iva}</p>
          {l.pedido != null ? (
            <p className="mt-0.5 text-[11px] font-medium text-sky-700">
              Pedido {l.pedido.toLocaleString("es-PY")}{l.recibidoAntes ? ` · ya llegaron ${l.recibidoAntes.toLocaleString("es-PY")}` : ""}
              {` · faltan ${Math.max(l.pedido - (l.recibidoAntes ?? 0), 0).toLocaleString("es-PY")}`}
              {excede ? <span className="text-amber-600"> · estás recibiendo más de lo que falta</span> : null}
            </p>
          ) : null}
        </div>
        <p className="text-right text-sm font-bold tabular-nums text-slate-900 max-sm:hidden">{gs(totalLinea)}</p>
        <button type="button" onClick={onQuitar} aria-label={`Quitar ${prod.nombre}`} className="-mr-1.5 -mt-1.5 inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-slate-400 hover:bg-rose-50 hover:text-rose-600 sm:mr-0 sm:mt-0 sm:h-auto sm:w-auto sm:p-1.5"><Trash2 className="h-4 w-4" /></button>
      </div>

      <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
        <label className="flex flex-col justify-end">
          <span className={ET}>Cantidad</span>
          <input inputMode="decimal" enterKeyHint="next" aria-label={`Cantidad de ${prod.nombre}`} value={l.cantidad} onChange={(e) => onCambiar({ cantidad: e.target.value.replace(/[^\d.,]/g, "") })} className={`${INPUT} py-2 text-right tabular-nums`} />
        </label>
        <label className="flex flex-col justify-end">
          <span className={ET}>Costo c/u {moneda === "USD" ? "(US$)" : ""} <span className="font-normal text-slate-400">IVA incl.</span></span>
          <MontoInput value={l.costo} onChange={(v) => onCambiar({ costo: v })} decimals={moneda === "USD"} placeholder="0" className={`${INPUT} py-2 text-right tabular-nums`} />
        </label>
        <label className="col-span-2 flex flex-col justify-end sm:col-span-1">
          <span className={ET}>Nuevo precio de venta <span className="font-normal text-slate-400">(opcional)</span></span>
          <MontoInput value={l.precioNuevo || ""} onChange={(v) => onCambiar({ precioNuevo: v })} decimals={false} placeholder={Number(prod.precio_venta).toLocaleString("es-PY")} className={`${INPUT} py-2 text-right tabular-nums`} />
        </label>
      </div>

      {prod.controla_stock && prod.controla_lotes ? (
        <div className="mt-2 grid grid-cols-1 gap-2 rounded-lg bg-slate-50/70 p-2 min-[420px]:grid-cols-2 sm:grid-cols-3">
          <label className="flex flex-col justify-end">
            <span className={ET}>Lote <span className="font-normal text-slate-400">(editable)</span></span>
            <input value={l.lote} enterKeyHint="next" autoComplete="off" autoCapitalize="characters" onChange={(e) => onCambiar({ lote: e.target.value.slice(0, 40) })} placeholder={loteAutomatico(hoyPY())} className={`${INPUT} bg-white py-2 uppercase tabular-nums`} />
          </label>
          <div className="flex min-w-0 flex-col justify-end">
            <span className={ET}>Vencimiento *</span>
            <SelectorFecha block etiqueta="Vencimiento del lote" min={hoyPY()} value={l.vencimiento} onChange={(v) => onCambiar({ vencimiento: v })} alerta={!l.vencimiento} claseBoton="rounded-xl px-3 py-2 text-slate-800" />
          </div>
          <p className="self-end text-[11px] text-slate-500 min-[420px]:col-span-2 sm:col-span-1 sm:pb-2">
            {!l.vencimiento ? "Cargá el vencimiento de este lote."
              : l.vencimiento < hoyPY() ? <span className="font-semibold text-rose-600">Esa fecha ya pasó: el lote entra vencido.</span>
              : "Para otro lote del mismo producto, agregalo de nuevo."}
          </p>
        </div>
      ) : null}

      <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-[11px] text-slate-500">
        <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
          {l.ultima ? (
            <>Última compra: <strong className="font-semibold text-slate-700">{gs(l.ultima.costo)}</strong>{l.ultima.proveedor ? ` · ${l.ultima.proveedor}` : ""}{variacion != null ? <Variacion pct={variacion} /> : null}</>
          ) : <>Primera compra de este producto.</>}
        </span>
        {margen != null ? (
          <span className={margen < 0 ? "font-semibold text-rose-600" : margen < 15 ? "font-semibold text-amber-600" : "text-slate-500"}>
            {l.precioNuevo > 0 ? "Margen con el precio nuevo" : `Margen a ${gs(precio)}`}: {margen.toLocaleString("es-PY")} %{margen < 0 ? " · vendés a pérdida" : ""}
          </span>
        ) : null}
      </div>

      {/* Celular: el total de la línea abajo (arriba no entra junto al nombre). */}
      <div className="mt-2 flex items-baseline justify-between gap-3 border-t border-slate-100 pt-2 sm:hidden">
        <span className="text-xs text-slate-500">Total de la línea</span>
        <span className="text-base font-bold tabular-nums text-slate-900">{gs(totalLinea)}</span>
      </div>
    </li>
  );
}
