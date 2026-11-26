/**
 * Foto, color y encuadre de cada tarjeta de las portadas (`/panel/<familia>`),
 * por ruta de la pantalla. Las fotos son las del ERP 2.0 (public/portadas).
 * El color es HSL sin envolver y oscuro (L ≤ ~30 %) para que el título blanco se lea.
 */
export type Portada = { imagen: string; color: string; posicion?: string };

const T = "182 39% 28%", A = "214 40% 24%", M = "26 50% 24%", V = "152 34% 22%";
const P = "258 28% 30%", C = "196 45% 20%", R = "352 38% 27%", G = "168 38% 22%";

const PORTADAS: Record<string, Portada> = {
  // Comercial
  "/clientes": { imagen: "/portadas/comercial/clientes-fichero-contactos.webp", color: T, posicion: "60% 25%" },
  "/crm": { imagen: "/portadas/comercial/crm-pizarra-notas-reunion.webp", color: A, posicion: "40% 30%" },
  "/gestion-clientes": { imagen: "/portadas/comercial/gestion-lista-llamadas-libreta.webp", color: V, posicion: "70% 40%" },
  "/propuestas": { imagen: "/portadas/comercial/presupuestos-calculadora-notas.webp", color: M, posicion: "35% 72%" },
  "/comisiones": { imagen: "/portadas/comercial/presupuestos-calculadora-notas.webp", color: G, posicion: "60% 45%" },
  "/planes": { imagen: "/portadas/comercial/planes-calendario-mensual.webp", color: P, posicion: "50% 70%" },
  "/dashboard/agenda": { imagen: "/portadas/comercial/agenda-planificador-escribiendo.webp", color: C, posicion: "50% 40%" },
  "/dashboard/proyectos": { imagen: "/portadas/comercial/proyectos-tablero-kanban.webp", color: R, posicion: "50% 20%" },
  "/dashboard/tableros": { imagen: "/portadas/comercial/proyectos-tablero-kanban.webp", color: A, posicion: "50% 60%" },
  // Finanzas
  "/ventas": { imagen: "/portadas/finanzas/caja-teclas-registradora.webp", color: T },
  "/cobranzas": { imagen: "/portadas/finanzas/cobranzas-agenda-vencimientos.webp", color: A, posicion: "50% 40%" },
  "/pagos": { imagen: "/portadas/finanzas/pagos-tarjeta-terminal.webp", color: P },
  "/gastos": { imagen: "/portadas/finanzas/gastos-calculadora-teclas.webp", color: M },
  "/compras": { imagen: "/portadas/finanzas/compras-canasto-supermercado.webp", color: V },
  "/compras/ordenes": { imagen: "/portadas/finanzas/ordenes-compra-caja-pedido.webp", color: C },
  "/compras/recepciones": { imagen: "/portadas/finanzas/ordenes-venta-ticket-impreso.webp", color: G },
  "/proveedores": { imagen: "/portadas/finanzas/proveedores-apreton-manos.webp", color: R, posicion: "50% 40%" },
  "/notas-credito": { imagen: "/portadas/finanzas/credito-libro-cuentas.webp", color: M },
  "/reportes": { imagen: "/portadas/finanzas/reportes-graficos-pantalla.webp", color: A },
  // Operaciones
  "/inventario": { imagen: "/portadas/inventario/productos-gondola.webp", color: T },
  "/inventario/movimientos": { imagen: "/portadas/inventario/movimientos-escaner.webp", color: A },
  "/inventario/categorias": { imagen: "/portadas/inventario/categorias-cajas.webp", color: M },
  "/inventario/ubicaciones": { imagen: "/portadas/inventario/depositos-racks.webp", color: V },
  "/inventario/depositos": { imagen: "/portadas/inventario/depositos-racks.webp", color: V },
  "/inventario/ajustes": { imagen: "/portadas/inventario/ajustes-cajas-danadas.webp", color: R },
  "/inventario/traslados": { imagen: "/portadas/inventario/traslados-autoelevador.webp", color: P },
  "/dashboard/produccion": { imagen: "/portadas/inventario/traslados-autoelevador.webp", color: P },
  // Omnicanal
  "/dashboard/conversaciones": { imagen: "/portadas/omnicanal/conversaciones-chat-dueno.webp", color: T },
  "/dashboard/conversaciones-finalizadas": { imagen: "/portadas/omnicanal/finalizadas-checklist-dueno.webp", color: V },
  "/dashboard/monitoreo": { imagen: "/portadas/omnicanal/monitoreo-pantallas-dueno.webp", color: A },
  "/dashboard/historial-omnicanal": { imagen: "/portadas/omnicanal/historial-archivo-dueno.webp", color: M },
  "/dashboard/campanas": { imagen: "/portadas/comercial/crm-pizarra-notas-reunion.webp", color: R, posicion: "40% 30%" },
  "/dashboard/etiquetas": { imagen: "/portadas/inventario/categorias-cajas.webp", color: P },
  "/dashboard/chat-interno": { imagen: "/portadas/omnicanal/conversaciones-chat-dueno.webp", color: C },
  // Soporte
  "/dashboard/soporte": { imagen: "/portadas/soporte/dashboard-metricas-pantalla.webp", color: T },
  "/dashboard/soporte/tickets": { imagen: "/portadas/soporte/tickets-mesa-ayuda.webp", color: A },
  "/dashboard/soporte/neurita": { imagen: "/portadas/soporte/mis-tickets-lista-pendientes.webp", color: P },
  "/dashboard/soporte/configuracion": { imagen: "/portadas/soporte/configuracion-engranajes.webp", color: C },
  // RRHH
  "/personal": { imagen: "/portadas/configuracion/usuarios-equipo.webp", color: T },
  "/usuarios": { imagen: "/portadas/comercial/clientes-fichero-contactos.webp", color: A, posicion: "60% 25%" },
  "/dashboard/guardias": { imagen: "/portadas/comercial/agenda-planificador-escribiendo.webp", color: V, posicion: "50% 40%" },
  "/organigrama": { imagen: "/portadas/configuracion/empresa-edificios.webp", color: M },
  // Administración
  "/configuracion": { imagen: "/portadas/soporte/configuracion-engranajes.webp", color: T },
  "/configuracion/facturacion": { imagen: "/portadas/configuracion/facturacion-calculadora.webp", color: M },
  "/configuracion/omnicanal-equipos": { imagen: "/portadas/configuracion/usuarios-equipo.webp", color: V },
  "/dashboard/panel-control": { imagen: "/portadas/omnicanal/monitoreo-pantallas-dueno.webp", color: A },
  // Marketing
  "/marketing": { imagen: "/portadas/finanzas/reportes-graficos-pantalla.webp", color: R },
  "/dashboard/marketing-ops": { imagen: "/portadas/finanzas/ventas-periodo-dashboard-dueno.webp", color: A },
  "/sorteos": { imagen: "/portadas/finanzas/ordenes-venta-ticket-impreso.webp", color: P },
  "/sorteos/tickets": { imagen: "/portadas/finanzas/ordenes-venta-ticket-impreso.webp", color: C },
};

const POR_DEFECTO: Portada = { imagen: "/portadas/finanzas/reportes-graficos-pantalla.webp", color: T };

export function portadaDe(href: string): Portada {
  return PORTADAS[href] ?? POR_DEFECTO;
}

/** Bajada de cada portada. */
export const BAJADA_FAMILIA: Record<string, { kicker: string; bajada: string }> = {
  comercial: { kicker: "Comercial", bajada: "Clientes y prospectos, planes, comisiones, la agenda y los proyectos." },
  finanzas: { kicker: "Finanzas", bajada: "Caja, cobranzas, pagos, compras y reportes." },
  operaciones: { kicker: "Operaciones", bajada: "Productos, stock, depósitos y producción." },
  rrhh: { kicker: "Equipo", bajada: "El personal, sus accesos al sistema, las guardias y el organigrama." },
  omnicanal: { kicker: "Atención al cliente", bajada: "Chats de todos los canales, su seguimiento, el historial y las campañas." },
  soporte: { kicker: "Soporte", bajada: "Los tickets de los clientes: el estado general, la cola de trabajo y Neurita." },
  marketing: { kicker: "Marketing", bajada: "Marketing, automatización y sorteos." },
  administracion: { kicker: "Ajustes", bajada: "La configuración del sistema, la facturación, los equipos y el estado de los servidores." },
  otros: { kicker: "Otros", bajada: "Otras pantallas habilitadas." },
};
